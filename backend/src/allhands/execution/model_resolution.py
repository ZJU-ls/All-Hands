"""Effective (provider, model) resolution.

Three-stage priority chain decided at chat-turn dispatch time:

  1. ``conversation.model_ref_override`` — user picked a model for this thread.
  2. ``employee.model_ref`` — employee's pinned default.
  3. **Workspace default** — the unique ``LLMModel`` row with
     ``is_default=True``. Its ``provider_id`` gives us the provider. This is
     the singleton "what runs when nothing else is specified" pointer.

For (1) and (2) we don't blindly trust the ref string. The user can leave
``employee.model_ref = "openai/gpt-4o-mini"`` while the only configured
provider is ``CODINGPLAN`` (kind=aliyun). The previous code path silently
fell back to a hardcoded model name string inside ``llm_factory`` while
the UI kept showing ``openai/gpt-4o-mini`` — chip lying to the user. We
validate the ref against the registered provider+model registry and only
accept it when there's a real binding; otherwise we drop straight to the
workspace default and the caller can surface the truthful name to the UI.

Pre-2026-04-25 the default was stored as ``provider.is_default`` plus a
``provider.default_model: str``. The pair could desync. The current shape
(``LLMModel.is_default`` singleton) makes the default a real FK chain.
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


def _workspace_default(
    providers: list[LLMProvider], models: list[LLMModel]
) -> tuple[LLMProvider, str] | None:
    """Resolve "the workspace default" as a (provider, model_name) pair.

    Priority:
      1. The unique enabled ``LLMModel`` with ``is_default=True``,
         and its provider must also be enabled. This is the user's
         explicit choice — set via the Gateway "设为默认" button on a
         specific model row.
      2. Fallback for fresh installs / first-run: the first enabled model
         under the first enabled provider. Lets the system bootstrap
         before the user has explicitly picked a default.
    """
    enabled_providers = {p.id: p for p in providers if p.enabled}
    enabled_models = [m for m in models if m.enabled and m.provider_id in enabled_providers]
    explicit = next((m for m in enabled_models if m.is_default), None)
    if explicit is not None:
        return enabled_providers[explicit.provider_id], explicit.name
    if not enabled_providers:
        return None
    # No explicit default — pick the first enabled (provider, model) pair.
    # Provider order is whatever the repo returns (creation order on most
    # backends); model order likewise. Stable enough for bootstrap UX.
    for provider in providers:
        if not provider.enabled:
            continue
        for model in enabled_models:
            if model.provider_id == provider.id:
                return provider, model.name
        # Provider exists but has no models registered yet — caller's
        # _try_resolve still has a chance for openai-kind pass-through.
        return provider, ""
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
    workspace = _workspace_default(providers, models)
    default_provider = workspace[0] if workspace else None

    for ref, source in ((conv_override, "override"), (employee_ref, "employee")):
        result = _try_resolve(ref, providers, models, default_provider)
        if result is not None:
            provider, name = result
            return ResolvedModel(provider=provider, model_name=name, source=source)  # type: ignore[arg-type]

    if workspace is None:
        raise DomainError(
            "No enabled LLM provider configured. Add one in Providers settings "
            "before sending messages."
        )
    provider, name = workspace
    return ResolvedModel(provider=provider, model_name=name, source="global_default")
