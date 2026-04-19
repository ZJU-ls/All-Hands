"""SeedService — ensure every domain has a "full house" of real demo data.

Contract: `docs/issues/open/I-0020-seed-data-infrastructure.md`.

Every Wave-3+ feature ships with a cold-start state where opening the
corresponding page shows the functionality at its real, populated form —
never a `暂无数据` shell. This module is the single surface responsible for
that guarantee:

- One `ensure_all_dev_seeds(session)` entry point that startup + CLI call.
- Per-domain `ensure_*(session)` functions idempotent on business keys
  (provider.name, (model.provider_id, model.name), employee.name,
  mcp_server.name, deterministic conversation/event ids).
- Real values only. Seed JSON in `backend/data/seeds/` holds the full spec;
  this module resolves cross-references (e.g. model.provider_name → provider_id)
  and writes via repos — never raw SQL (issue § 硬约束).

Production safety: this module is side-effect-free on import. Wiring lives in
`main.py` behind an env check so prod never auto-seeds.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from allhands.core import (
    Conversation,
    Employee,
    EventEnvelope,
    LLMModel,
    LLMProvider,
    MCPServer,
    MCPTransport,
    Message,
)
from allhands.persistence.sql_repos import (
    SqlConversationRepo,
    SqlEmployeeRepo,
    SqlEventRepo,
    SqlLLMModelRepo,
    SqlLLMProviderRepo,
    SqlMCPServerRepo,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)

SEEDS_DIR = Path(__file__).resolve().parents[3] / "data" / "seeds"


@dataclass
class SeedReport:
    """Per-domain written/kept counts returned by `ensure_all_dev_seeds`.

    Startup logs this so operators see at a glance what the env bootstrapped.
    """

    providers: int = 0
    models: int = 0
    employees: int = 0
    skills_mount: int = 0
    mcp_servers: int = 0
    conversations: int = 0
    events: int = 0
    warnings: list[str] = field(default_factory=list)


def _load_seed_json(filename: str) -> list[dict[str, Any]] | dict[str, Any]:
    path = SEEDS_DIR / filename
    with path.open("r", encoding="utf-8") as f:
        data: list[dict[str, Any]] | dict[str, Any] = json.load(f)
    return data


def _parse_iso_utc(value: str) -> datetime:
    """Parse ISO-8601 with trailing Z as an aware UTC datetime."""
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    return datetime.fromisoformat(value)


# ---------------------------------------------------------------------------
# Providers
# ---------------------------------------------------------------------------


async def ensure_providers(session: AsyncSession) -> int:
    """Upsert all seed providers. Idempotent by `name`.

    Ensures exactly one `is_default=True` provider — the seed JSON flags one.
    """
    data = _load_seed_json("providers.json")
    assert isinstance(data, list)

    repo = SqlLLMProviderRepo(session)
    existing_by_name = {p.name: p for p in await repo.list_all()}

    for item in data:
        name = item["name"]
        # Preserve existing id if present so FK references (models) stay stable.
        existing = existing_by_name.get(name)
        provider_id = existing.id if existing else item["id"]

        kind_raw = item.get("kind", "openai")
        kind = kind_raw if kind_raw in ("openai", "anthropic", "aliyun") else "openai"
        provider = LLMProvider(
            id=provider_id,
            name=name,
            kind=kind,  # type: ignore[arg-type]
            base_url=item["base_url"],
            api_key=item.get("api_key", ""),
            default_model=item.get("default_model", "gpt-4o-mini"),
            is_default=bool(item.get("is_default", False)),
            enabled=bool(item.get("enabled", True)),
        )
        await repo.upsert(provider)

    return len(data)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


async def ensure_models(session: AsyncSession) -> int:
    """Upsert all seed models. Idempotent by `(provider_id, name)`.

    Resolves each seed's `provider_name` → concrete `provider_id` by looking
    up providers in the same session. If a referenced provider is missing
    (e.g. seed JSON drift), the model is skipped with a warning rather than
    silently corrupting the table.
    """
    data = _load_seed_json("models.json")
    assert isinstance(data, list)

    provider_repo = SqlLLMProviderRepo(session)
    model_repo = SqlLLMModelRepo(session)

    provider_by_name = {p.name: p for p in await provider_repo.list_all()}

    written = 0
    for item in data:
        provider_name = item["provider_name"]
        provider = provider_by_name.get(provider_name)
        if provider is None:
            log.warning(
                "seed.models.skip",
                extra={"reason": "provider_missing", "provider_name": provider_name},
            )
            continue

        # Idempotence key: (provider_id, name). If found, reuse its id.
        existing = [
            m for m in await model_repo.list_for_provider(provider.id) if m.name == item["name"]
        ]
        model_id = existing[0].id if existing else item["id"]

        model = LLMModel(
            id=model_id,
            provider_id=provider.id,
            name=item["name"],
            display_name=item.get("display_name", ""),
            context_window=int(item.get("context_window", 0)),
            enabled=bool(item.get("enabled", True)),
        )
        await model_repo.upsert(model)
        written += 1

    return written


# ---------------------------------------------------------------------------
# Employees
# ---------------------------------------------------------------------------


async def ensure_employees(session: AsyncSession) -> int:
    """Upsert all seed employees. Idempotent by `name`.

    Never writes a `mode` field (§3.2). Differentiation is entirely via
    `tool_ids` / `skill_ids` / `max_iterations` — the data file reflects this.
    """
    data = _load_seed_json("employees.json")
    assert isinstance(data, list)

    repo = SqlEmployeeRepo(session)
    existing_by_name = {e.name: e for e in await repo.list_all()}

    for item in data:
        name = item["name"]
        existing = existing_by_name.get(name)
        employee_id = existing.id if existing else item["id"]
        created_at = existing.created_at if existing else datetime.now(UTC)

        employee = Employee(
            id=employee_id,
            name=name,
            description=item["description"],
            system_prompt=item["system_prompt"],
            model_ref=item["model_ref"],
            tool_ids=list(item.get("tool_ids", [])),
            skill_ids=list(item.get("skill_ids", [])),
            max_iterations=int(item.get("max_iterations", 10)),
            is_lead_agent=bool(item.get("is_lead_agent", False)),
            created_by=item.get("created_by", "seed"),
            created_at=created_at,
            metadata=dict(item.get("metadata", {})),
        )
        await repo.upsert(employee)

    return len(data)


async def ensure_skill_mounts(session: AsyncSession) -> int:
    """Validate the skill mount spec. Skill-to-employee mapping is realised
    via `Employee.skill_ids`, which `ensure_employees` already writes. This
    function exists so the seed report surfaces the number of mounts for
    operators, and so that spec drift between `employees.json` and
    `skills_mount.json` fails noisily.
    """
    spec = _load_seed_json("skills_mount.json")
    assert isinstance(spec, dict)
    mounts: dict[str, list[str]] = spec.get("mounts", {})

    repo = SqlEmployeeRepo(session)
    employees = {e.name: e for e in await repo.list_all()}

    validated = 0
    for emp_name, skill_ids in mounts.items():
        emp = employees.get(emp_name)
        if emp is None:
            log.warning(
                "seed.skill_mount.skip",
                extra={"reason": "employee_missing", "employee_name": emp_name},
            )
            continue
        missing = [sid for sid in skill_ids if sid not in emp.skill_ids]
        if missing:
            log.warning(
                "seed.skill_mount.drift",
                extra={"employee": emp_name, "missing": missing},
            )
            continue
        validated += len(skill_ids)

    return validated


# ---------------------------------------------------------------------------
# MCP Servers
# ---------------------------------------------------------------------------


async def ensure_mcp_servers(session: AsyncSession) -> int:
    """Upsert all seed MCP servers. Idempotent by `name`."""
    data = _load_seed_json("mcp_servers.json")
    assert isinstance(data, list)

    repo = SqlMCPServerRepo(session)
    existing_by_name = {s.name: s for s in await repo.list_all()}

    for item in data:
        name = item["name"]
        existing = existing_by_name.get(name)
        server_id = existing.id if existing else item["id"]

        server = MCPServer(
            id=server_id,
            name=name,
            transport=MCPTransport(item["transport"]),
            config=dict(item["config"]),
            enabled=bool(item.get("enabled", True)),
            exposed_tool_ids=list(item.get("exposed_tool_ids", [])),
        )
        await repo.upsert(server)

    return len(data)


# ---------------------------------------------------------------------------
# Conversations + messages
# ---------------------------------------------------------------------------


async def ensure_conversations(session: AsyncSession) -> int:
    """Seed conversations + their message histories.

    Idempotent via deterministic conversation id. If the conversation already
    exists, messages are not re-appended — append_message has no upsert
    semantics and re-running would duplicate. We treat conversation id
    presence as the marker that its message history is already in place.
    """
    data = _load_seed_json("conversations.json")
    assert isinstance(data, list)

    conv_repo = SqlConversationRepo(session)
    emp_repo = SqlEmployeeRepo(session)
    emp_by_name = {e.name: e for e in await emp_repo.list_all()}

    written = 0
    for item in data:
        emp = emp_by_name.get(item["employee_name"])
        if emp is None:
            log.warning(
                "seed.conversation.skip",
                extra={
                    "reason": "employee_missing",
                    "conversation_id": item["id"],
                    "employee_name": item["employee_name"],
                },
            )
            continue

        existing = await conv_repo.get(item["id"])
        if existing is not None:
            written += 1  # preserved across runs; count it as seeded
            continue

        created_at = _parse_iso_utc(item["created_at"])
        conv = Conversation(
            id=item["id"],
            title=item.get("title"),
            employee_id=emp.id,
            created_at=created_at,
            metadata=dict(item.get("metadata", {})),
        )
        await conv_repo.create(conv)

        for raw_msg in item.get("messages", []):
            msg = Message(
                id=raw_msg["id"],
                conversation_id=conv.id,
                role=raw_msg["role"],
                content=raw_msg["content"],
                created_at=_parse_iso_utc(raw_msg["created_at"]),
            )
            await conv_repo.append_message(msg)

        written += 1

    return written


# ---------------------------------------------------------------------------
# Events (what the Traces page reads)
# ---------------------------------------------------------------------------


async def ensure_events(session: AsyncSession) -> int:
    """Seed `run.*` events so the Traces page has running/completed/failed/cancelled samples.

    Observatory.list_traces filters by `kind.startswith("run.")`; seed JSON
    lists the four canonical kinds. Idempotence uses deterministic event id:
    if an event with that id already exists we skip (EventRow has no upsert,
    but save is an INSERT, so re-save would violate PK — we check first).
    """
    data = _load_seed_json("events.json")
    assert isinstance(data, list)

    repo = SqlEventRepo(session)
    emp_repo = SqlEmployeeRepo(session)
    emp_by_name = {e.name: e for e in await emp_repo.list_all()}

    # Collect existing ids so we skip inserts that would collide.
    existing = await repo.list_recent(limit=1000, kind_prefixes=["run."])
    existing_ids = {e.id for e in existing}

    written = 0
    for item in data:
        event_id = item["id"]
        if event_id in existing_ids:
            written += 1
            continue

        payload = dict(item.get("payload", {}))
        emp_name = item.get("employee_name")
        if emp_name and emp_name in emp_by_name:
            payload.setdefault("employee_id", emp_by_name[emp_name].id)

        env = EventEnvelope(
            id=event_id,
            kind=item["kind"],
            payload=payload,
            published_at=_parse_iso_utc(item["published_at"]),
            actor=emp_by_name[emp_name].id if emp_name and emp_name in emp_by_name else None,
            subject=item.get("subject"),
            severity=item.get("severity", "info"),
        )
        await repo.save(env)
        written += 1

    return written


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


async def ensure_all_dev_seeds(session: AsyncSession) -> SeedReport:
    """Populate every domain in a single pass.

    Order matters because cross-references exist:
    providers → models → employees → skill mounts → conversations → events.
    MCP servers stand alone and can be seeded anywhere after providers.
    """
    report = SeedReport()
    report.providers = await ensure_providers(session)
    report.models = await ensure_models(session)
    report.employees = await ensure_employees(session)
    report.skills_mount = await ensure_skill_mounts(session)
    report.mcp_servers = await ensure_mcp_servers(session)
    report.conversations = await ensure_conversations(session)
    report.events = await ensure_events(session)
    return report


__all__ = [
    "SEEDS_DIR",
    "SeedReport",
    "ensure_all_dev_seeds",
    "ensure_conversations",
    "ensure_employees",
    "ensure_events",
    "ensure_mcp_servers",
    "ensure_models",
    "ensure_providers",
    "ensure_skill_mounts",
]
