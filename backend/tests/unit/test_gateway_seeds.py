"""Tests for gateway demo seeds (I-0019 phase 4).

The seed is only allowed to fire on a pristine install (zero providers).
Once the user edits anything (adds a provider, deletes a seed), we must
NOT re-introduce demo rows. Mirrors the Lead Agent idempotency contract.
"""

from __future__ import annotations

from typing import cast

import pytest

from allhands.core.model import LLMModel
from allhands.core.provider import LLMProvider
from allhands.persistence.repositories import LLMModelRepo, LLMProviderRepo
from allhands.services.bootstrap_service import (
    GATEWAY_SEED_PRESETS,
    ensure_gateway_demo_seeds,
)


class InMemoryProviderRepo:
    def __init__(self, providers: list[LLMProvider] | None = None) -> None:
        self._items: dict[str, LLMProvider] = {p.id: p for p in (providers or [])}

    async def get(self, provider_id: str) -> LLMProvider | None:
        return self._items.get(provider_id)

    async def get_default(self) -> LLMProvider | None:
        for p in self._items.values():
            if p.is_default:
                return p
        return None

    async def list_all(self) -> list[LLMProvider]:
        return list(self._items.values())

    async def upsert(self, provider: LLMProvider) -> LLMProvider:
        self._items[provider.id] = provider
        return provider

    async def delete(self, provider_id: str) -> None:
        self._items.pop(provider_id, None)

    async def set_default(self, provider_id: str) -> None:
        for pid, prov in self._items.items():
            self._items[pid] = prov.model_copy(update={"is_default": pid == provider_id})


class InMemoryModelRepo:
    def __init__(self) -> None:
        self._items: dict[str, LLMModel] = {}

    async def get(self, model_id: str) -> LLMModel | None:
        return self._items.get(model_id)

    async def list_all(self) -> list[LLMModel]:
        return list(self._items.values())

    async def list_for_provider(self, provider_id: str) -> list[LLMModel]:
        return [m for m in self._items.values() if m.provider_id == provider_id]

    async def upsert(self, model: LLMModel) -> LLMModel:
        self._items[model.id] = model
        return model

    async def delete(self, model_id: str) -> None:
        self._items.pop(model_id, None)


@pytest.mark.asyncio
async def test_gateway_seeds_on_empty_install() -> None:
    prov_repo = InMemoryProviderRepo()
    model_repo = InMemoryModelRepo()
    result = await ensure_gateway_demo_seeds(
        cast("LLMProviderRepo", prov_repo),
        cast("LLMModelRepo", model_repo),
    )
    assert result is True
    providers = await prov_repo.list_all()
    assert len(providers) >= 3
    models = await model_repo.list_all()
    assert len(models) >= 5


@pytest.mark.asyncio
async def test_gateway_seeds_noop_if_providers_exist() -> None:
    existing = LLMProvider(
        id="p1",
        name="MyCustom",
        base_url="https://example.com/v1",
        api_key="",
        default_model="x",
    )
    prov_repo = InMemoryProviderRepo([existing])
    model_repo = InMemoryModelRepo()
    result = await ensure_gateway_demo_seeds(
        cast("LLMProviderRepo", prov_repo),
        cast("LLMModelRepo", model_repo),
    )
    assert result is False
    providers = await prov_repo.list_all()
    assert len(providers) == 1
    assert providers[0].name == "MyCustom"
    assert await model_repo.list_all() == []


@pytest.mark.asyncio
async def test_gateway_seeds_idempotent_on_second_call() -> None:
    prov_repo = InMemoryProviderRepo()
    model_repo = InMemoryModelRepo()
    assert await ensure_gateway_demo_seeds(
        cast("LLMProviderRepo", prov_repo),
        cast("LLMModelRepo", model_repo),
    )
    first_count = len(await prov_repo.list_all())
    result2 = await ensure_gateway_demo_seeds(
        cast("LLMProviderRepo", prov_repo),
        cast("LLMModelRepo", model_repo),
    )
    assert result2 is False
    assert len(await prov_repo.list_all()) == first_count


def test_gateway_seed_presets_cover_all_three_supported_kinds() -> None:
    """Seeds must showcase every format we support — so a fresh install
    demonstrates the full matrix of providers the UI/Agent can drive.
    """
    kinds = {p.kind for p in GATEWAY_SEED_PRESETS}
    assert kinds == {"openai", "anthropic", "aliyun"}
    total_models = sum(len(p.models) for p in GATEWAY_SEED_PRESETS)
    assert total_models >= 5


def test_gateway_seed_presets_use_correct_base_url_shape_per_kind() -> None:
    """openai + aliyun (compat-mode) speak OpenAI wire → `/v1` style.
    Anthropic native uses the Messages API root (no `/v1` suffix needed —
    the factory appends it when probing). Verify the contract per-kind.
    """
    for preset in GATEWAY_SEED_PRESETS:
        assert preset.base_url.startswith("https://")
        if preset.kind == "anthropic":
            # Anthropic native root: no /v1 required.
            assert "anthropic" in preset.base_url
        else:
            assert preset.base_url.endswith(("/v1", "/v1/")) or "compatible" in preset.base_url


# ---------------------------------------------------------------------------
# I-0002 · every seeded model must have a positive context_window
# ---------------------------------------------------------------------------


def test_gateway_seed_every_model_has_positive_context_window() -> None:
    """Regression for I-0002: a zero context_window is a data bug — the
    Agent's token budget goes negative and the UI shows '0 tokens'. No seed
    preset may ship a non-positive window.
    """
    for preset in GATEWAY_SEED_PRESETS:
        for m in preset.models:
            assert m.context_window > 0, (
                f"{preset.name}/{m.name} has context_window={m.context_window}; "
                "seed values must be positive (see I-0002)."
            )


# ---------------------------------------------------------------------------
# I-0003 · every seeded provider.default_model must resolve to a seeded model
# ---------------------------------------------------------------------------


def test_gateway_seed_default_model_points_to_existing_model() -> None:
    """Regression for I-0003: provider.default_model must be one of the
    models seeded under the same provider. A dangling value cascades through
    AgentRunner / Meta Tools / the /settings UI as a silent 404.
    """
    for preset in GATEWAY_SEED_PRESETS:
        names = {m.name for m in preset.models}
        assert preset.default_model in names, (
            f"{preset.name}: default_model={preset.default_model!r} is not "
            f"in seeded models {sorted(names)} (see I-0003)."
        )
