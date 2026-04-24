"""ADR 0017 · P3.C — Anthropic prompt caching helper.

Anthropic's API supports attaching ``cache_control: {"type": "ephemeral"}``
to a message block; any prefix of the messages ending at or before that
block becomes eligible for prompt-cache hits on subsequent calls.
Claude Code uses this aggressively to keep repeated context cheap
(ref-src-claude/V08 § 4.1).

Our approach (keeping it provider-agnostic):

1. ``annotate_cache_breakpoints`` takes the messages list from
   ``build_llm_context`` and returns a list where the last assistant
   message before the final user turn gets a ``_cache_control`` marker.
   Everything up to and including that point is the "stable prefix" —
   replays of the same conversation will hit the cache.
2. The runner (P3.C follow-up) translates ``_cache_control`` into the
   provider-specific shape when the provider is Anthropic. Non-Anthropic
   providers ignore the marker (OpenAI does automatic prefix caching
   server-side, so this is a no-op there).

For now this module is the plan-level stub — it ships the annotation
function + test coverage so when the provider wiring lands it snaps in
without schema changes.
"""

from __future__ import annotations

from typing import Any

_MARKER_KEY = "_cache_control"


def annotate_cache_breakpoints(
    messages: list[dict[str, Any]],
    *,
    max_breakpoints: int = 4,
) -> list[dict[str, Any]]:
    """Mark the stable-prefix boundary so the runner can attach
    ``cache_control`` blocks when talking to Anthropic.

    Heuristic:
    - If there are ≥ 2 assistant turns, mark the SECOND-TO-LAST assistant
      message. That's the point past which the prefix is 'stable' across
      turns within this conversation.
    - If there are 0 or 1 assistant turns, return the input unchanged
      (nothing to cache meaningfully).
    - The input list is not mutated; a copy with the marker added to the
      relevant message is returned.

    ``max_breakpoints`` is forward-looking — Anthropic allows up to 4
    cache_control markers and we reserve room for the runner to add more
    (system prompt, tool manifest).
    """
    out = [dict(m) for m in messages]
    assistant_idxs = [i for i, m in enumerate(out) if m.get("role") == "assistant"]
    if len(assistant_idxs) < 2:
        return out
    # The last assistant turn corresponds to the just-produced reply; we
    # want the prefix BEFORE that, so pick the second-to-last assistant.
    target_idx = assistant_idxs[-2]
    out[target_idx] = {**out[target_idx], _MARKER_KEY: "ephemeral"}
    # Reserve — callers can add additional markers, but never exceed 4.
    current = sum(1 for m in out if m.get(_MARKER_KEY))
    if current > max_breakpoints:
        # Keep the most recent markers (they're the most impactful).
        keep = max_breakpoints
        for i, m in enumerate(out):
            if m.get(_MARKER_KEY):
                if keep > 0:
                    keep -= 1
                else:
                    out[i] = {k: v for k, v in m.items() if k != _MARKER_KEY}
    return out


def strip_cache_markers(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Remove the internal marker before handing messages to providers
    that don't support cache_control (default for non-Anthropic)."""
    return [{k: v for k, v in m.items() if k != _MARKER_KEY} for m in messages]
