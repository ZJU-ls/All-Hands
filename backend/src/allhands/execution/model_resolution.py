"""Effective (provider, model) resolution.

Three-stage priority chain decided at chat-turn dispatch time:

  1. ``conversation.model_ref_override`` — user picked a model for this thread.
  2. ``employee.model_ref`` — employee's pinned default.
  3. **Workspace default** — the provider with ``is_default=True`` and its
     ``default_model``. Single source of truth for "what runs when nothing
     else is specified."

For (1) and (2) we don't blindly trust the ref string. The user can leave
``employee.model_ref = "openai/gpt-4o-mini"`` while the only configured
provider is ``CODINGPLAN`` (kind=aliyun). The previous code path silently
fell back to CODINGPLAN's ``default_model`` inside ``llm_factory`` while
the UI kept showing ``openai/gpt-4o-mini`` — chip lying to the user. We
validate the ref against the registered provider+model registry and only
accept it when there's a real binding; otherwise we drop straight to the
workspace default and the caller can surface the truthful name to the UI.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from allhands.core.errors import DomainError
from allhands.core.model import LLMModel
from allhands.core.provider import LLMProvider

ModelSource = Literal["override", "employee", "global_default"]


@dataclass(frozen=True)
class ResolvedModel:
    provider: LLMProvider
    model_name: str
    source: ModelSource

    @property
    def ref(self) -> str:
        return f"{self.provider.name}/{self.model_name}"


def _try_resolve(
    ref: str | None,
    providers: list[LLMProvider],
    models: list[LLMModel],
    default_provider: LLMProvider | None,
) -> tuple[LLMProvider, str] | None:
    if not ref:
        return None
    if "/" not in ref:
        # Bare name — treat as a model on the workspace default provider.
        if default_provider is None:
            return None
        registered = [m for m in models if m.provider_id == default_provider.id and m.enabled]
        if any(m.name == ref for m in registered) or not registered:
            return (default_provider, ref)
        return None

    prefix, name = ref.split("/", 1)
    pl = prefix.lower()
    candidate = next(
        (p for p in providers if p.enabled and (p.name.lower() == pl or p.kind == pl)),
        None,
    )
    if candidate is None:
        return None
    registered = [m for m in models if m.provider_id == candidate.id and m.enabled]
    if any(m.name == name for m in registered):
        return (candidate, name)
    # Provider exists but model isn't registered. Two compat paths:
    #   - openai-kind aggregators (OpenRouter etc.) accept slash-routed names
    #     they don't enumerate; pass-through is the right call.
    #   - empty registry (user hasn't registered any models for this provider
    #     yet) — also pass-through, otherwise day-1 setup is unusable.
    if candidate.kind == "openai" or not registered:
        return (candidate, name)
    return None


def resolve_effective_model(
    *,
    conv_override: str | None,
    employee_ref: str | None,
    providers: list[LLMProvider],
    models: list[LLMModel],
) -> ResolvedModel:
    """Pick the (provider, model) pair that should actually run this turn.

    Falls back through override → employee → workspace default in order.
    Each candidate is validated against the provider+model registry; an
    unresolvable entry falls through to the next stage (not silently
    rewritten in place). Raises ``DomainError`` when no enabled provider
    is configured at all.
    """
    enabled = [p for p in providers if p.enabled]
    default_provider = next((p for p in enabled if p.is_default), None) or (
        enabled[0] if enabled else None
    )

    for ref, source in ((conv_override, "override"), (employee_ref, "employee")):
        result = _try_resolve(ref, providers, models, default_provider)
        if result is not None:
            provider, name = result
            return ResolvedModel(provider=provider, model_name=name, source=source)  # type: ignore[arg-type]

    if default_provider is None:
        raise DomainError(
            "No enabled LLM provider configured. Add one in Providers settings "
            "before sending messages."
        )
    return ResolvedModel(
        provider=default_provider,
        model_name=default_provider.default_model,
        source="global_default",
    )
