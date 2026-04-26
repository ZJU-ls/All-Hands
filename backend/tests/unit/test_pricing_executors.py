"""End-to-end test of the 3 pricing meta-tool executors against in-memory SQLite."""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine

from allhands.execution.tools.meta.executors import (
    make_delete_model_price_override_executor,
    make_list_model_prices_executor,
    make_upsert_model_price_executor,
)
from allhands.persistence.orm.base import Base


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    eng = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    await eng.dispose()


@pytest.fixture
def maker(engine: AsyncEngine) -> async_sessionmaker:
    return async_sessionmaker(engine, expire_on_commit=False)


async def test_list_returns_code_seed_when_no_overrides(maker: async_sessionmaker) -> None:
    out = await make_list_model_prices_executor(maker)()
    assert out["db_count"] == 0
    assert out["code_count"] > 10  # 20-ish code-seeded models
    refs = {r["model_ref"] for r in out["prices"]}
    assert "claude-opus-4-7" in refs


async def test_upsert_creates_db_row_and_overrides_seed(maker: async_sessionmaker) -> None:
    await make_upsert_model_price_executor(maker)(
        model_ref="gpt-4o-mini",
        input_per_million_usd=0.05,
        output_per_million_usd=0.25,
        source_url="https://openai.com/pricing",
        note="promo",
    )
    out = await make_list_model_prices_executor(maker)()
    assert out["db_count"] == 1
    row = next(r for r in out["prices"] if r["model_ref"] == "gpt-4o-mini")
    assert row["source"] == "db"
    assert row["input_per_million_usd"] == 0.05
    assert row["source_url"] == "https://openai.com/pricing"
    assert row["note"] == "promo"


async def test_delete_falls_back_to_seed(maker: async_sessionmaker) -> None:
    await make_upsert_model_price_executor(maker)(
        model_ref="gpt-4o-mini",
        input_per_million_usd=0.05,
        output_per_million_usd=0.25,
        source_url="https://openai.com/pricing",
    )
    res = await make_delete_model_price_override_executor(maker)(model_ref="gpt-4o-mini")
    assert res["removed"] is True

    out = await make_list_model_prices_executor(maker)()
    assert out["db_count"] == 0
    row = next(r for r in out["prices"] if r["model_ref"] == "gpt-4o-mini")
    assert row["source"] == "code"
    # Code seed value is 0.15 / 0.60
    assert row["input_per_million_usd"] == 0.15


async def test_delete_missing_is_noop(maker: async_sessionmaker) -> None:
    res = await make_delete_model_price_override_executor(maker)(model_ref="acme/unknown")
    assert res["removed"] is False
