"""Regression: gateway model + provider write meta tools must hit DB.

Pre-2026-05-05 these tools were declared in
``execution/tools/meta/{model,provider}_tools.py`` but had NO executor —
``discover_builtin_tools`` fell through to ``_async_noop`` and returned
``{}``. Symptom: Lead Agent's ``create_model`` traced as "ok" forever
while ``list_models`` stayed empty.

This test pins the wiring so that drift would fail loudly.
"""

from __future__ import annotations

import os

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from allhands.api.gateway_executors import build_gateway_executors
from allhands.persistence.orm.base import Base


@pytest.fixture
async def maker() -> async_sessionmaker:
    os.environ.setdefault("ALLHANDS_DB_URL", "sqlite+aiosqlite:///:memory:")
    eng = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return async_sessionmaker(eng, expire_on_commit=False)


@pytest.mark.asyncio
async def test_create_provider_then_create_model_round_trip(maker) -> None:
    execs = build_gateway_executors(maker)
    p = await execs["allhands.meta.create_provider"](
        name="Acme", base_url="https://x.example", kind="openai", api_key="sk-1"
    )
    assert "provider" in p, p
    pid = p["provider"]["id"]

    m = await execs["allhands.meta.create_model"](
        provider_id=pid, name="acme-1", display_name="Acme 1", context_window=4096
    )
    assert "model" in m, m
    assert m["model"]["name"] == "acme-1"

    sd = await execs["allhands.meta.set_default_model"](model_id=m["model"]["id"])
    assert sd["provider_id"] == pid


@pytest.mark.asyncio
async def test_create_model_unknown_provider_returns_envelope(maker) -> None:
    execs = build_gateway_executors(maker)
    out = await execs["allhands.meta.create_model"](provider_id="missing", name="x")
    assert out["error"]
    assert out["field"] == "provider_id"
    assert "list_providers" in out["hint"]


@pytest.mark.asyncio
async def test_create_provider_unknown_kind_returns_envelope(maker) -> None:
    execs = build_gateway_executors(maker)
    out = await execs["allhands.meta.create_provider"](name="X", base_url="https://x", kind="bogus")
    assert out["error"]
    assert out["field"] == "kind"
    assert out["received"] == "bogus"


@pytest.mark.asyncio
async def test_list_provider_presets_returns_seeded_kinds(maker) -> None:
    execs = build_gateway_executors(maker)
    out = await execs["allhands.meta.list_provider_presets"]()
    kinds = {p["kind"] for p in out["presets"]}
    assert kinds == {"openai", "anthropic", "aliyun"}


@pytest.mark.asyncio
async def test_registry_wires_executors_not_noop() -> None:
    """End-to-end: ToolRegistry hands back our real closures, not _async_noop.

    The bug was at this layer — declarations existed without executors,
    discover_builtin_tools defaulted them to a no-op stub. Pin it.
    """
    from allhands.api.deps import get_tool_registry

    reg = get_tool_registry()
    for tid in (
        "allhands.meta.create_model",
        "allhands.meta.update_model",
        "allhands.meta.delete_model",
        "allhands.meta.set_default_model",
        "allhands.meta.create_provider",
        "allhands.meta.update_provider",
        "allhands.meta.delete_provider",
        "allhands.meta.list_provider_presets",
        "allhands.meta.test_provider_connection",
    ):
        _tool, ex = reg.get(tid)
        qual = getattr(ex, "__qualname__", "")
        assert "build_gateway_executors" in qual, (tid, qual)
