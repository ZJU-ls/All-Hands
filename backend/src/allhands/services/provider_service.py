"""LLMProviderService — CRUD for LLM providers.

Pre-2026-04-25 this service also owned `set_default(provider_id)` and
`set_default_model(provider_id, name)` for the legacy two-field default
representation. Both are gone — the workspace default is now a singleton
flag on `LLMModel`, owned by `LLMModelService.set_as_default(model_id)`.
The provider has no opinion on which of its models is "the default" any
more; it only knows it's an endpoint with credentials.
"""

from __future__ import annotations

import uuid

from allhands.core.provider import LLMProvider
from allhands.core.provider_presets import ProviderKind
from allhands.persistence.repositories import LLMProviderRepo


class ProviderConfigError(ValueError):
    """Raised when a provider payload is structurally valid but points nowhere."""


class LLMProviderService:
    def __init__(self, repo: LLMProviderRepo) -> None:
        self._repo = repo

    async def create(
        self,
        name: str,
        base_url: str,
        kind: ProviderKind = "openai",
        api_key: str = "",
    ) -> LLMProvider:
        provider = LLMProvider(
            id=str(uuid.uuid4()),
            name=name,
            kind=kind,
            base_url=base_url,
            api_key=api_key,
        )
        return await self._repo.upsert(provider)

    async def get(self, provider_id: str) -> LLMProvider | None:
        return await self._repo.get(provider_id)

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
                    "enabled": enabled,
                }.items()
                if v is not None
            }
        )
        return await self._repo.upsert(updated)

    async def delete(self, provider_id: str) -> None:
        await self._repo.delete(provider_id)
