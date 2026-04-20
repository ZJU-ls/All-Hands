"""Validation tests for LLMModelService + LLMProviderService (I-0002 · I-0003).

These services are the write-boundary for the Gateway: bad values must be
caught here, not silently persisted and re-surfaced through the UI.
"""

from __future__ import annotations

from typing import cast

import pytest

from allhands.core.model import LLMModel
from allhands.core.provider import LLMProvider
from allhands.persistence.repositories import LLMModelRepo, LLMProviderRepo
from allhands.services.model_service import LLMModelService, ModelConfigError
from allhands.services.provider_service import (
    LLMProviderService,
    ProviderConfigError,
)


class _ProviderRepo:
    def __init__(self, providers: list[LLMProvider] | None = None) -> None:
        self._items: dict[str, LLMProvider] = {p.id: p for p in (providers or [])}

    async def get(self, pid: str) -> LLMProvider | None:
        return self._items.get(pid)

    async def get_default(self) -> LLMProvider | None:
        for p in self._items.values():
            if p.is_default:
                return p
        return None

    async def list_all(self) -> list[LLMProvider]:
        return list(self._items.values())

    async def upsert(self, p: LLMProvider) -> LLMProvider:
        self._items[p.id] = p
        return p

    async def delete(self, pid: str) -> None:
        self._items.pop(pid, None)

    async def set_default(self, pid: str) -> None:
        for k, v in self._items.items():
            self._items[k] = v.model_copy(update={"is_default": k == pid})


class _ModelRepo:
    def __init__(self, models: list[LLMModel] | None = None) -> None:
        self._items: dict[str, LLMModel] = {m.id: m for m in (models or [])}

    async def get(self, mid: str) -> LLMModel | None:
        return self._items.get(mid)

    async def list_all(self) -> list[LLMModel]:
        return list(self._items.values())

    async def list_for_provider(self, pid: str) -> list[LLMModel]:
        return [m for m in self._items.values() if m.provider_id == pid]

    async def upsert(self, m: LLMModel) -> LLMModel:
        self._items[m.id] = m
        return m

    async def delete(self, mid: str) -> None:
        self._items.pop(mid, None)


def _provider(pid: str = "p1", name: str = "Bailian") -> LLMProvider:
    return LLMProvider(
        id=pid,
        name=name,
        base_url="https://example.com/v1",
        api_key="",
        default_model="qwen-plus",
    )


# ---------------------------------------------------------------------------
# I-0002 · context_window must be > 0 at the service boundary
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_model_create_rejects_zero_context_window() -> None:
    provider = _provider()
    svc = LLMModelService(
        cast("LLMModelRepo", _ModelRepo()),
        cast("LLMProviderRepo", _ProviderRepo([provider])),
    )
    with pytest.raises(ModelConfigError, match="context_window"):
        await svc.create(provider.id, name="qwen3.6-plus", context_window=0)


@pytest.mark.asyncio
async def test_model_create_rejects_negative_context_window() -> None:
    provider = _provider()
    svc = LLMModelService(
        cast("LLMModelRepo", _ModelRepo()),
        cast("LLMProviderRepo", _ProviderRepo([provider])),
    )
    with pytest.raises(ModelConfigError):
        await svc.create(provider.id, name="x", context_window=-1)


@pytest.mark.asyncio
async def test_model_create_accepts_positive_context_window() -> None:
    provider = _provider()
    svc = LLMModelService(
        cast("LLMModelRepo", _ModelRepo()),
        cast("LLMProviderRepo", _ProviderRepo([provider])),
    )
    model = await svc.create(provider.id, name="x", context_window=128_000)
    assert model is not None
    assert model.context_window == 128_000


@pytest.mark.asyncio
async def test_model_update_rejects_zero_context_window() -> None:
    model = LLMModel(
        id="m1",
        provider_id="p1",
        name="qwen",
        display_name="qwen",
        context_window=128_000,
    )
    svc = LLMModelService(
        cast("LLMModelRepo", _ModelRepo([model])),
        cast("LLMProviderRepo", _ProviderRepo([_provider()])),
    )
    with pytest.raises(ModelConfigError):
        await svc.update(model.id, context_window=0)


# ---------------------------------------------------------------------------
# I-0003 · set_default_model rejects dangling references
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_set_default_model_rejects_nonexistent_model() -> None:
    provider = _provider()
    model = LLMModel(
        id="m1",
        provider_id=provider.id,
        name="qwen3.6-plus",
        display_name="qwen3.6-plus",
        context_window=128_000,
    )
    svc = LLMProviderService(
        cast("LLMProviderRepo", _ProviderRepo([provider])),
        cast("LLMModelRepo", _ModelRepo([model])),
    )
    with pytest.raises(ProviderConfigError, match="glm-5"):
        await svc.set_default_model(provider.id, "glm-5")


@pytest.mark.asyncio
async def test_set_default_model_accepts_existing_model() -> None:
    provider = _provider()
    model = LLMModel(
        id="m1",
        provider_id=provider.id,
        name="qwen3.6-plus",
        display_name="qwen3.6-plus",
        context_window=128_000,
    )
    svc = LLMProviderService(
        cast("LLMProviderRepo", _ProviderRepo([provider])),
        cast("LLMModelRepo", _ModelRepo([model])),
    )
    updated = await svc.set_default_model(provider.id, "qwen3.6-plus")
    assert updated.default_model == "qwen3.6-plus"


@pytest.mark.asyncio
async def test_set_default_model_rejects_disabled_model() -> None:
    """Disabled models shouldn't satisfy default_model — AgentRunner will
    try to dispatch to them and fall over. Treat `enabled=False` as absent."""
    provider = _provider()
    model = LLMModel(
        id="m1",
        provider_id=provider.id,
        name="qwen3.6-plus",
        display_name="qwen3.6-plus",
        context_window=128_000,
        enabled=False,
    )
    svc = LLMProviderService(
        cast("LLMProviderRepo", _ProviderRepo([provider])),
        cast("LLMModelRepo", _ModelRepo([model])),
    )
    with pytest.raises(ProviderConfigError):
        await svc.set_default_model(provider.id, "qwen3.6-plus")


@pytest.mark.asyncio
async def test_set_default_model_rejects_missing_provider() -> None:
    svc = LLMProviderService(
        cast("LLMProviderRepo", _ProviderRepo()),
        cast("LLMModelRepo", _ModelRepo()),
    )
    with pytest.raises(ProviderConfigError, match="not found"):
        await svc.set_default_model("nope", "anything")
