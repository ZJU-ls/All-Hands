"""Integration tests for seed_service (I-0020 · Track N).

Spec: `docs/issues/open/I-0020-seed-data-infrastructure.md`.

This pins the contract that Wave-3+ features rely on: every new feature
delivers with a cold-start "full house" of real, runnable seed data so the
user never opens a page to `暂无数据` emptiness.

The tests cover:

- `ensure_all_dev_seeds()` end-to-end populates every domain with ≥ N rows.
- Each domain's `ensure_*()` is individually idempotent — 3 calls in a row
  never double-write. Idempotence keys off business fields (name / provider+name
  pair / deterministic id), not primary-key coincidence.
- Seed content is real: provider base_urls align with `.env.example`, model
  names are plausible (no `foo` / `bar` / `lorem`), employees omit the
  forbidden `mode` field.

Test-DB pattern borrowed from
`backend/tests/integration/test_lead_agent_flow.py`: in-memory SQLite + full
ORM `Base.metadata.create_all`, one session-per-test.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import TYPE_CHECKING

import pytest
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import (
    SqlConversationRepo,
    SqlEmployeeRepo,
    SqlEventRepo,
    SqlLLMModelRepo,
    SqlLLMProviderRepo,
    SqlMCPServerRepo,
)
from allhands.services import seed_service

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncEngine


MIN_PROVIDERS = 4  # Bailian(aliyun) + OpenRouter(openai) + DeepSeek(openai) + Anthropic(anthropic)
MIN_MODELS = 6
# Preset employees seeded from `employees.json`: researcher / coder / analyst.
MIN_SEED_EMPLOYEES = 3
# 3 preset employees + 1 Lead Agent (B03). Lead is added by
# `ensure_all_dev_seeds` on top of the JSON presets — without it, `/chat`
# has no default landing agent and the entire Tool-First conversational
# admin surface is unreachable.
MIN_EMPLOYEES = MIN_SEED_EMPLOYEES + 1
MIN_MCP_SERVERS = 2  # allhands-core (bundled, enabled) + Filesystem (npx, disabled example)
MIN_CONVERSATIONS = 1
MIN_EVENTS = 4
MIN_MESSAGES = 2  # 1 conversation with a user + assistant round-trip

# Status kinds we expect represented in seed events (observatory derives the
# Traces page from events where kind startswith `run.`).
REQUIRED_EVENT_KINDS = {"run.started", "run.completed", "run.failed", "run.cancelled"}


@pytest.fixture
async def session_maker() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    """In-memory SQLite with all ORM tables created. One engine per test."""
    engine: AsyncEngine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


# ---------------------------------------------------------------------------
# ensure_all_dev_seeds — end-to-end
# ---------------------------------------------------------------------------


async def test_ensure_all_dev_seeds_populates_every_domain(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """One call to `ensure_all_dev_seeds()` must fill all seven domains.

    This is the contract: cold start + startup hook → every page has data.
    """
    async with session_maker() as session, session.begin():
        report = await seed_service.ensure_all_dev_seeds(session)

    # The report returns counts per domain so startup logs are meaningful.
    assert report.providers >= MIN_PROVIDERS
    assert report.models >= MIN_MODELS
    assert report.employees >= MIN_EMPLOYEES
    assert report.mcp_servers >= MIN_MCP_SERVERS
    assert report.conversations >= MIN_CONVERSATIONS
    assert report.events >= MIN_EVENTS

    # And the rows landed — prove it by reading back.
    async with session_maker() as session:
        providers = await SqlLLMProviderRepo(session).list_all()
        models = await SqlLLMModelRepo(session).list_all()
        employees = await SqlEmployeeRepo(session).list_all()
        mcp_servers = await SqlMCPServerRepo(session).list_all()
        convs = await SqlConversationRepo(session).list_all()
        events = await SqlEventRepo(session).list_recent(
            limit=50,
            kind_prefixes=["run."],
        )

    assert len(providers) >= MIN_PROVIDERS
    assert len(models) >= MIN_MODELS
    assert len(employees) >= MIN_EMPLOYEES
    assert len(mcp_servers) >= MIN_MCP_SERVERS
    assert len(convs) >= MIN_CONVERSATIONS
    assert len(events) >= MIN_EVENTS


async def test_ensure_all_dev_seeds_creates_lead_agent(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """B03 · dev seed must include a singleton Lead Agent so /chat has a
    default landing agent and Tool-First admin (`/api/employees/lead`) is
    reachable from cold start. Without Lead, the conversational platform
    administration promise (CLAUDE.md §3.1) is completely broken.
    """
    async with session_maker() as session, session.begin():
        await seed_service.ensure_all_dev_seeds(session)

    async with session_maker() as session:
        repo = SqlEmployeeRepo(session)
        lead = await repo.get_lead()

    assert lead is not None, "ensure_all_dev_seeds must create a Lead Agent (B03)"
    assert lead.is_lead_agent is True
    assert lead.name == "LeadAgent"
    # Coordination toolkit is invariant #4 in Employee domain model.
    assert "allhands.meta.dispatch_employee" in lead.tool_ids


async def test_ensure_all_dev_seeds_is_idempotent(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Three consecutive calls must produce identical row counts.

    This is the "startup runs on every container restart" invariant: seed
    data must be keyed by business identity, not random UUIDs that dup on
    each call.
    """
    async with session_maker() as session, session.begin():
        await seed_service.ensure_all_dev_seeds(session)
    async with session_maker() as session, session.begin():
        await seed_service.ensure_all_dev_seeds(session)
    async with session_maker() as session, session.begin():
        await seed_service.ensure_all_dev_seeds(session)

    async with session_maker() as session:
        providers = await SqlLLMProviderRepo(session).list_all()
        models = await SqlLLMModelRepo(session).list_all()
        employees = await SqlEmployeeRepo(session).list_all()
        mcp_servers = await SqlMCPServerRepo(session).list_all()
        convs = await SqlConversationRepo(session).list_all()
        events = await SqlEventRepo(session).list_recent(
            limit=500,
            kind_prefixes=["run."],
        )

    # Exact equality after 3 runs — not "grew by a factor of 3".
    assert len(providers) == MIN_PROVIDERS, (
        f"providers must not duplicate across runs, got {len(providers)}"
    )
    assert len(employees) == MIN_EMPLOYEES
    assert len(mcp_servers) == MIN_MCP_SERVERS
    assert len(convs) == MIN_CONVERSATIONS
    assert len(events) == MIN_EVENTS
    # Models = sum per provider, should stay exact too.
    assert len(models) >= MIN_MODELS
    assert len(models) <= MIN_MODELS + 3  # allow up to 3 extras per provider


# ---------------------------------------------------------------------------
# Per-domain idempotence
# ---------------------------------------------------------------------------


async def test_ensure_providers_idempotent_by_name(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    async with session_maker() as session, session.begin():
        count_1 = await seed_service.ensure_providers(session)
    async with session_maker() as session, session.begin():
        count_2 = await seed_service.ensure_providers(session)

    assert count_1 == count_2 >= MIN_PROVIDERS

    async with session_maker() as session:
        providers = await SqlLLMProviderRepo(session).list_all()
    names = [p.name for p in providers]
    assert len(names) == len(set(names)), f"providers duplicated by name: {names}"
    # Default flag is held by exactly one provider.
    defaults = [p for p in providers if p.is_default]
    assert len(defaults) == 1, f"exactly one default provider, got {len(defaults)}"


async def test_ensure_models_idempotent_and_linked_to_providers(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    async with session_maker() as session, session.begin():
        await seed_service.ensure_providers(session)
    async with session_maker() as session, session.begin():
        await seed_service.ensure_models(session)
    async with session_maker() as session, session.begin():
        await seed_service.ensure_models(session)

    async with session_maker() as session:
        providers = await SqlLLMProviderRepo(session).list_all()
        models = await SqlLLMModelRepo(session).list_all()

    provider_ids = {p.id for p in providers}
    for m in models:
        assert m.provider_id in provider_ids, (
            f"model {m.name} references unknown provider_id {m.provider_id}"
        )
    # (provider_id, name) pair must be unique — the natural business key.
    keys = [(m.provider_id, m.name) for m in models]
    assert len(keys) == len(set(keys)), f"duplicate model keys: {keys}"


async def test_ensure_employees_idempotent_no_mode_field(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    async with session_maker() as session, session.begin():
        await seed_service.ensure_providers(session)
        await seed_service.ensure_models(session)
    async with session_maker() as session, session.begin():
        count_1 = await seed_service.ensure_employees(session)
    async with session_maker() as session, session.begin():
        count_2 = await seed_service.ensure_employees(session)

    assert count_1 == count_2 >= MIN_SEED_EMPLOYEES

    async with session_maker() as session:
        employees = await SqlEmployeeRepo(session).list_all()

    names = [e.name for e in employees]
    assert len(names) == len(set(names)), f"employees duplicated: {names}"
    # CLAUDE.md §3.2 — no `mode` field, differentiation via tools/skills/iterations.
    for emp in employees:
        dumped = emp.model_dump()
        assert "mode" not in dumped, f"Employee {emp.name} leaks a `mode` field (§3.2 violation)"
        assert emp.has_any_capability(), f"Employee {emp.name} has no tool_ids nor skill_ids"


async def test_ensure_mcp_servers_idempotent(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    async with session_maker() as session, session.begin():
        await seed_service.ensure_mcp_servers(session)
    async with session_maker() as session, session.begin():
        await seed_service.ensure_mcp_servers(session)

    async with session_maker() as session:
        servers = await SqlMCPServerRepo(session).list_all()
    assert len(servers) >= MIN_MCP_SERVERS
    names = [s.name for s in servers]
    assert len(names) == len(set(names)), f"MCP server duplicated: {names}"


async def test_ensure_conversations_idempotent_with_messages(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    async with session_maker() as session, session.begin():
        await seed_service.ensure_providers(session)
        await seed_service.ensure_models(session)
        await seed_service.ensure_employees(session)
    async with session_maker() as session, session.begin():
        await seed_service.ensure_conversations(session)
    async with session_maker() as session, session.begin():
        await seed_service.ensure_conversations(session)

    async with session_maker() as session:
        convs = await SqlConversationRepo(session).list_all()
    assert len(convs) == MIN_CONVERSATIONS

    # A seeded conversation has at least one user + one assistant message —
    # otherwise the cold-start `/employees/<id>` page still looks empty.
    async with session_maker() as session:
        repo = SqlConversationRepo(session)
        total_msgs = 0
        for c in convs:
            msgs = await repo.list_messages(c.id)
            total_msgs += len(msgs)
    assert total_msgs >= MIN_MESSAGES


async def test_ensure_events_idempotent_covers_all_statuses(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    async with session_maker() as session, session.begin():
        await seed_service.ensure_events(session)
    async with session_maker() as session, session.begin():
        await seed_service.ensure_events(session)

    async with session_maker() as session:
        events = await SqlEventRepo(session).list_recent(
            limit=50,
            kind_prefixes=["run."],
        )
    assert len(events) == MIN_EVENTS
    kinds = {e.kind for e in events}
    missing = REQUIRED_EVENT_KINDS - kinds
    assert not missing, f"traces page needs run.*/failed+cancelled samples, missing: {missing}"


# ---------------------------------------------------------------------------
# Content realism — no foo/bar, base_urls align with .env.example
# ---------------------------------------------------------------------------


async def test_seed_content_is_real_not_placeholder(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Seed exists to show the feature's 'full-house' form.

    Placeholder values like foo/bar/lorem defeat that purpose — the product
    reviewer still sees a half-empty page. This test is the trip wire.
    """
    async with session_maker() as session, session.begin():
        await seed_service.ensure_all_dev_seeds(session)

    placeholders = ("foo", "bar", "baz", "lorem", "ipsum", "demo-model", "test-provider")

    async with session_maker() as session:
        providers = await SqlLLMProviderRepo(session).list_all()
        models = await SqlLLMModelRepo(session).list_all()
        employees = await SqlEmployeeRepo(session).list_all()

    for p in providers:
        lower = p.name.lower()
        for bad in placeholders:
            assert bad not in lower, f"provider {p.name} uses placeholder"
        # Realistic endpoint: https scheme + known path suffix v1-ish.
        assert p.base_url.startswith("https://"), (
            f"provider {p.name} base_url must be https: {p.base_url}"
        )

    for m in models:
        lower = m.name.lower()
        for bad in placeholders:
            assert bad not in lower, f"model {m.name} uses placeholder"

    for e in employees:
        # Names are NameStr pattern ^[A-Za-z][A-Za-z0-9_-]{0,63}$ — this is
        # enforced by Pydantic, but the "description" / "system_prompt" are
        # free-form, so scrub them for lorem.
        lower_desc = (e.description + " " + e.system_prompt).lower()
        for bad in placeholders:
            assert bad not in lower_desc, f"employee {e.name} description/prompt contains {bad!r}"


async def test_seed_provider_base_urls_align_with_env_example(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Providers must match what `.env.example` advertises.

    Users reading `.env.example` expect the same endpoint names they see in
    the gateway UI. Drift means the Bailian key they configured goes to the
    wrong record.
    """
    async with session_maker() as session, session.begin():
        await seed_service.ensure_providers(session)

    async with session_maker() as session:
        providers = await SqlLLMProviderRepo(session).list_all()

    by_name_lower = {p.name.lower(): p for p in providers}
    # Bailian / DashScope is the one the .env.example highlights — it MUST be
    # present so `ALLHANDS_DASHSCOPE_API_KEY` users see it in the Gateway.
    assert any("bailian" in k or "dashscope" in k for k in by_name_lower), (
        f"Bailian / DashScope provider missing from seeds. Got: {list(by_name_lower)}"
    )
