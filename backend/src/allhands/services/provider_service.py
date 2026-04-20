"""LLMProviderService — CRUD for LLM providers."""

from __future__ import annotations

import uuid

from allhands.core.provider import LLMProvider
from allhands.core.provider_presets import ProviderKind
from allhands.persistence.repositories import LLMModelRepo, LLMProviderRepo


class ProviderConfigError(ValueError):
    """Raised when a provider payload is structurally valid but points nowhere."""


class LLMProviderService:
    def __init__(
        self,
        repo: LLMProviderRepo,
        model_repo: LLMModelRepo | None = None,
    ) -> None:
        self._repo = repo
        # Optional — set_default_model cross-checks models only when we know
        # where to look. Existing call sites that don't need that feature can
        # keep passing a single repo.
        self._models = model_repo

    async def create(
        self,
        name: str,
        base_url: str,
        kind: ProviderKind = "openai",
        api_key: str = "",
        default_model: str = "gpt-4o-mini",
        set_as_default: bool = False,
    ) -> LLMProvider:
        provider = LLMProvider(
            id=str(uuid.uuid4()),
            name=name,
            kind=kind,
            base_url=base_url,
            api_key=api_key,
            default_model=default_model,
            is_default=False,
        )
        saved = await self._repo.upsert(provider)
        if set_as_default:
            await self._repo.set_default(saved.id)
            saved = LLMProvider(**{**saved.model_dump(), "is_default": True})
        return saved

    async def get(self, provider_id: str) -> LLMProvider | None:
        return await self._repo.get(provider_id)

    async def get_default(self) -> LLMProvider | None:
        return await self._repo.get_default()

    async def list_all(self) -> list[LLMProvider]:
        return await self._repo.list_all()

    async def update(
        self,
        provider_id: str,
        *,
        name: str | None = None,
        kind: ProviderKind | None = None,
        base_url: str | None = None,
        api_key: str | None = None,
        default_model: str | None = None,
        enabled: bool | None = None,
    ) -> LLMProvider | None:
        provider = await self._repo.get(provider_id)
        if provider is None:
            return None
        updated = provider.model_copy(
            update={
                k: v
                for k, v in {
                    "name": name,
                    "kind": kind,
                    "base_url": base_url,
                    "api_key": api_key,
                    "default_model": default_model,
                    "enabled": enabled,
                }.items()
                if v is not None
            }
        )
        return await self._repo.upsert(updated)

    async def set_default(self, provider_id: str) -> None:
        await self._repo.set_default(provider_id)

    async def set_default_model(self, provider_id: str, model_name: str) -> LLMProvider:
        """Set ``provider.default_model`` · reject dangling references (I-0003).

        A provider's ``default_model`` is read by :class:`AgentRunner` / the
        ``/settings`` UI / the Meta Tool ``providers_get_default_model``. If
        it doesn't resolve to a real model under this provider, every one of
        those surfaces fails silently or falls back to platform defaults.
        Cross-check at the write boundary so bad values never reach the DB.
        """
        provider = await self._repo.get(provider_id)
        if provider is None:
            raise ProviderConfigError(f"provider {provider_id!r} not found")
        if self._models is None:
            # Degraded mode: cross-check skipped when the repo pair wasn't
            # wired up. Callers that need the guarantee pass `model_repo=`.
            updated = provider.model_copy(update={"default_model": model_name})
            return await self._repo.upsert(updated)
        models = await self._models.list_for_provider(provider_id)
        available = {m.name for m in models if m.enabled}
        if model_name not in available:
            available_list = ", ".join(sorted(available)) or "<none>"
            raise ProviderConfigError(
                f"default_model {model_name!r} is not a registered model under "
                f"provider {provider.name!r}. Available: {available_list}"
            )
        updated = provider.model_copy(update={"default_model": model_name})
        return await self._repo.upsert(updated)

    async def delete(self, provider_id: str) -> None:
        await self._repo.delete(provider_id)
