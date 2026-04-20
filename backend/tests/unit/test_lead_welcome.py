"""Regression for I-0013 · Lead Agent welcome message contract.

The Lead Agent's system prompt is the single source of truth for what the
user sees on an empty conversation. `product/03-visual-design.md §9.1` says
that first-turn must give *three* concrete starter prompts. If the prompt
loses that contract silently, new users land on a blank screen — the issue
that motivated I-0013.
"""

from __future__ import annotations

import re
from pathlib import Path

PROMPT = (
    Path(__file__).resolve().parents[2]
    / "src"
    / "allhands"
    / "execution"
    / "prompts"
    / "lead_agent.md"
)


def _text() -> str:
    return PROMPT.read_text(encoding="utf-8")


def test_lead_prompt_has_welcome_section() -> None:
    """The prompt must name the welcome-message contract explicitly so the
    model doesn't skip it on refactor."""
    body = _text()
    assert "Welcome message" in body, (
        "lead_agent.md missing 'Welcome message' section heading — "
        "see product/03-visual-design.md §9.1 and I-0013."
    )


def test_lead_welcome_mentions_empty_first_turn() -> None:
    """Welcome only fires when the user's history is empty; the prompt has
    to spell that out so the model doesn't greet mid-conversation."""
    body = _text().lower()
    assert "empty" in body, "lead prompt must gate welcome on empty history"
    assert ("first turn" in body) or ("first user message" in body), (
        "lead prompt must identify which turn triggers the welcome"
    )


def test_lead_welcome_has_three_concrete_prompt_examples() -> None:
    """I-0013 contract: 3 clickable starter prompts. Count lines that look
    like `- "..."` inside a block-quoted welcome template."""
    body = _text()
    # Pull the welcome example block — any sequence of `> - "..."` bullets.
    bullets = re.findall(r'>\s*-\s*"[^"]+"', body)
    assert len(bullets) >= 3, (
        f"lead_agent.md must contain at least 3 bullet-style example prompts "
        f"in the welcome template (found {len(bullets)}); see I-0013."
    )


def test_lead_welcome_greeting_is_chinese() -> None:
    """Product copy in welcome is Chinese (per 03-visual-design.md §9.1)."""
    body = _text()
    assert "欢迎" in body, "lead welcome must use Chinese greeting '欢迎' — see §9.1 Voice & Tone."


def test_lead_prompt_voice_tone_rules_present() -> None:
    """Style section must mirror the hard rules from 03-visual-design.md §9.1
    so the agent's tone stays in lockstep with the UI contract."""
    body = _text()
    # No emoji / no ! / 我 你 (not 咱们 / 我们).
    assert "No emoji" in body or "no emoji" in body.lower()
    assert "exclamation" in body.lower() or "!" in body  # mentions the rule
    assert "我" in body and "你" in body
    assert "咱们" in body or "我们" in body  # mentioned as forbidden


def test_lead_prompt_has_no_emoji() -> None:
    """The prompt itself must follow its own rule — no decorative emoji in
    the template text."""
    body = _text()
    # Strip code-fence content to avoid false hits on e.g. ⌘ ↵.
    # Common decorative emoji ranges:
    emoji_re = re.compile(
        "["
        "\U0001f300-\U0001f6ff"  # Misc symbols, pictographs, transport
        "\U0001f900-\U0001f9ff"  # Supplemental symbols
        "\U0001fa00-\U0001faff"  # Symbols extended
        "\U00002700-\U000027bf"  # Dingbats
        "]",
        flags=re.UNICODE,
    )
    leaks = emoji_re.findall(body)
    assert not leaks, (
        f"lead_agent.md contains emoji {leaks!r}; Voice & Tone forbids "
        f"decorative emoji (see §9.1 / I-0013)."
    )
