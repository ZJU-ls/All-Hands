"""Validation tests for LLMModelService (I-0002 · default-pointer refactor).

These services are the write-boundary for the Gateway: bad values must be
caught here, not silently persisted and re-surfaced through the UI.

Post-2026-04-25: `LLMProviderService.set_default_model` is gone. The
"default" concept has moved to `LLMModelService.set_as_default(model_id)`
— a singleton flag on a real model row, validated by the FK chain itself.
The previous validation tests for "the model name must exist on this
provider" are obviated: there is no name string to validate against
because the model is identified by id.
"""

from __future__ import annotations

from typing import cast

import pytest

from allhands.core.model import LLMModel
from allhands.core.provider import LLMProvider
from allhands.persistence.repositories import LLMModelRepo, LLMProviderRepo
from allhands.services.model_service import LLMModelService, ModelConfigError


class _ProviderRepo:
    def __init__(self, providers: list[LLMProvider] | None = None) -> None:
        self._items: dict[str, LLMProvider] = {p.id: p for p in (providers or [])}

    async def get(self, pid: str) -> LLMProvider | None:
        return self._items.get(pid)

    async def list_all(self) -> list[LLMProvider]:
        return list(self._items.values())

    async def upsert(self, p: LLMProvider) -> LLMProvider:
        self._items[p.id] = p
        return p

    async def delete(self, pid: str) -> None:
        self._items.pop(pid, None)


class _ModelRepo:
    def __init__(self, models: list[LLMModel] | None = None) -> None:
        self._items: dict[str, LLMModel] = {m.id: m for m in (models or [])}

    async def get(self, mid: str) -> LLMModel | None:
        return self._items.get(mid)

    async def get_default(self) -> LLMModel | None:
        for m in self._items.values():
            if m.is_default and m.enabled:
                return m
        return None

    async def list_all(self) -> list[LLMModel]:
        return list(self._items.values())

    async def list_for_provider(self, pid: str) -> list[LLMModel]:
        return [m for m in self._items.values() if m.provider_id == pid]

    async def upsert(self, m: LLMModel) -> LLMModel:
        self._items[m.id] = m
        return m

    async def delete(self, mid: str) -> None:
        self._items.pop(mid, None)

    async def set_default(self, mid: str) -> LLMModel | None:
        target = self._items.get(mid)
        if target is None:
            return None
        # Singleton invariant — clear all, set this one.
        for k, v in self._items.items():
            self._items[k] = v.model_copy(update={"is_default": k == mid})
        return self._items[mid]


def _provider(pid: str = "p1", name: str = "Bailian") -> LLMProvider:
    return LLMProvider(
        id=pid,
        name=name,
        base_url="https://example.com/v1",
        api_key="",
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
# Default singleton invariant — at most one model has is_default=True
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_set_as_default_promotes_target_and_clears_others() -> None:
    """The singleton invariant: after `set_as_default(target)`, exactly
    one row has `is_default=True`, and it's `target`.
    """
    provider = _provider()
    a = LLMModel(
        id="ma",
        provider_id=provider.id,
        name="qwen3.6-plus",
        context_window=128_000,
        is_default=True,
    )
    b = LLMModel(
        id="mb",
        provider_id=provider.id,
        name="qwen3-omni",
        context_window=128_000,
        is_default=False,
    )
    repo = _ModelRepo([a, b])
    svc = LLMModelService(
        cast("LLMModelRepo", repo),
        cast("LLMProviderRepo", _ProviderRepo([provider])),
    )

    pair = await svc.set_as_default("mb")
    assert pair is not None
    promoted, attached_provider = pair
    assert promoted.id == "mb"
    assert promoted.is_default is True
    assert attached_provider.id == provider.id
    # Singleton invariant — the previous default no longer carries the flag.
    refreshed_a = await repo.get("ma")
    assert refreshed_a is not None
    assert refreshed_a.is_default is False


@pytest.mark.asyncio
async def test_set_as_default_returns_none_for_missing_model() -> None:
    """Missing model id surfaces as None — caller (route) translates to 404."""
    svc = LLMModelService(
        cast("LLMModelRepo", _ModelRepo()),
        cast("LLMProviderRepo", _ProviderRepo([_provider()])),
    )
    pair = await svc.set_as_default("does-not-exist")
    assert pair is None


@pytest.mark.asyncio
async def test_get_default_returns_promoted_pair() -> None:
    """`get_default` joins (model, provider) so callers don't need to
    do a second lookup. None when no default is set."""
    provider = _provider()
    model = LLMModel(
        id="m1",
        provider_id=provider.id,
        name="qwen3.6-plus",
        context_window=128_000,
        is_default=True,
    )
    svc = LLMModelService(
        cast("LLMModelRepo", _ModelRepo([model])),
        cast("LLMProviderRepo", _ProviderRepo([provider])),
    )
    pair = await svc.get_default()
    assert pair is not None
    m, p = pair
    assert m.id == "m1"
    assert p.id == provider.id


@pytest.mark.asyncio
async def test_get_default_returns_none_when_no_flag_set() -> None:
    provider = _provider()
    model = LLMModel(
        id="m1",
        provider_id=provider.id,
        name="qwen3.6-plus",
        context_window=128_000,
    )
    svc = LLMModelService(
        cast("LLMModelRepo", _ModelRepo([model])),
        cast("LLMProviderRepo", _ProviderRepo([provider])),
    )
    assert await svc.get_default() is None
