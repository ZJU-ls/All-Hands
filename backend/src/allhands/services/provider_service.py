"""LLMProviderService — CRUD for LLM providers."""

from __future__ import annotations

import uuid

from allhands.core.provider import LLMProvider
from allhands.persistence.repositories import LLMProviderRepo


class LLMProviderService:
    def __init__(self, repo: LLMProviderRepo) -> None:
        self._repo = repo

    async def create(
        self,
        name: str,
        base_url: str,
        api_key: str = "",
        default_model: str = "gpt-4o-mini",
        set_as_default: bool = False,
    ) -> LLMProvider:
        provider = LLMProvider(
            id=str(uuid.uuid4()),
            name=name,
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

    async def delete(self, provider_id: str) -> None:
        await self._repo.delete(provider_id)
