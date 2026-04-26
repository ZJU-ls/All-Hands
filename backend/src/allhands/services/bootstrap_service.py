"""BootstrapService — ensure Lead Agent exists on startup.

The Lead Agent gets the **full L01 admin surface** so the user can run every
platform operation via conversation alone (CLAUDE.md §3.1 扩展):

- Employee CRUD + dispatch (`employee_tools`)
- Plan family (`plan_tools`) — Lead plans its own delegation flow
- Skill management (`skill_tools`) — install / update / remove
- MCP server management (`mcp_server_tools`) — add / test / enable / remove
- Provider & Model management (`provider_tools`, `model_tools`)
- Cockpit workspace summary + emergency pause (`cockpit_tools`)
- Default `skill_ids` (render + artifacts) so the Lead can output visible
  work without extra wiring

Dropping any admin tool above silently breaks the "对话驱动全平台" promise —
pinned by `tests/unit/test_bootstrap.py::test_ensure_lead_agent_ships_full_admin_surface`.

System prompt is loaded from `execution/prompts/lead_agent.md` so we can
iterate on wording without a code deploy.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from allhands.core import Employee
from allhands.core.model import LLMModel
from allhands.core.provider import LLMProvider
from allhands.execution.tools.meta.cockpit_tools import ALL_COCKPIT_META_TOOLS
from allhands.execution.tools.meta.employee_tools import ALL_META_TOOLS
from allhands.execution.tools.meta.mcp_server_tools import ALL_MCP_SERVER_META_TOOLS
from allhands.execution.tools.meta.model_tools import ALL_MODEL_META_TOOLS
from allhands.execution.tools.meta.plan_tools import ALL_PLAN_TOOLS
from allhands.execution.tools.meta.provider_tools import ALL_PROVIDER_META_TOOLS
from allhands.execution.tools.meta.skill_tools import ALL_SKILL_META_TOOLS
from allhands.services.employee_service import DEFAULT_SKILL_IDS, LEAD_SKILL_IDS

if TYPE_CHECKING:
    from allhands.persistence.repositories import (
        EmployeeRepo,
        LLMModelRepo,
        LLMProviderRepo,
    )


PROMPT_PATH = Path(__file__).resolve().parents[1] / "execution" / "prompts" / "lead_agent.md"

FALLBACK_PROMPT = (
    "You are the Lead Agent of the allhands platform. Coordinate employees "
    "via list_employees / get_employee_detail / dispatch_employee. Plan with "
    "plan_create before non-trivial work."
)


def load_lead_prompt() -> str:
    try:
        return PROMPT_PATH.read_text(encoding="utf-8")
    except OSError:
        return FALLBACK_PROMPT


# L16 · Render tools are **output channel**, not a capability pack. Keeping
# them skill-gated means when the user says "画一下 / 展示 / 对比",
# Lead has no chart tool in toolset and the LLM silently hallucinates
# emoji-heavy markdown pretending it rendered (E20). The skill-gate was
# designed for WRITE-tool context-bloat (pre-E22 Lead had 45 write tools
# and picked the wrong-shaped ones); render is 100% READ-scope, same as
# ``list_*``, and should be always-hot for the same reason.
LEAD_ALWAYS_HOT_RENDER_TOOL_IDS: list[str] = [
    "allhands.render.markdown_card",
    "allhands.render.table",
    "allhands.render.kv",
    "allhands.render.cards",
    "allhands.render.timeline",
    "allhands.render.steps",
    "allhands.render.code",
    "allhands.render.diff",
    "allhands.render.callout",
    "allhands.render.link_card",
    "allhands.render.stat",
    "allhands.render.line_chart",
    "allhands.render.bar_chart",
    "allhands.render.pie_chart",
]


# Captures the `default_lead_tool_ids()` baseline **before** render was
# promoted to always-hot (L16 · 2026-04-22). Used only by the on-boot
# migration guard to detect Leads bootstrapped pre-L16 so they auto-upgrade.
# Do NOT reuse this for anything else — new invariants belong in
# ``default_lead_tool_ids``. **Historical frozen snapshot — must not grow.**
_LEAD_BASELINE_PRE_RENDER_HOT: frozenset[str] = frozenset(
    [
        "allhands.meta.list_providers",
        "allhands.meta.get_provider",
        "allhands.meta.list_models",
        "allhands.meta.get_model",
        "allhands.meta.list_skills",
        "allhands.meta.get_skill_detail",
        "allhands.meta.list_mcp_servers",
        "allhands.meta.get_mcp_server",
        "allhands.meta.list_employees",
        "allhands.meta.get_employee_detail",
        "allhands.meta.resolve_skill",
        "allhands.meta.dispatch_employee",
        "allhands.meta.spawn_subagent",
        "allhands.meta.plan_create",
        "allhands.meta.plan_update_step",
        "allhands.meta.plan_complete_step",
        "allhands.meta.plan_view",
        "allhands.meta.cockpit.get_workspace_summary",
    ]
)


# Captures the post-L16 pre-ADR-0015 baseline — Lead had render hot but no
# `allhands.meta.read_skill_file` yet. Leads bootstrapped between 2026-04-22
# and 2026-04-23 are in this state and must auto-upgrade on next boot so
# progressive skill loading (ADR 0015) works for them too.
# **Historical frozen snapshot — must not grow.** New baselines need a new constant.
_LEAD_BASELINE_POST_L16_PRE_ADR_0015: frozenset[str] = frozenset(
    _LEAD_BASELINE_PRE_RENDER_HOT | set(LEAD_ALWAYS_HOT_RENDER_TOOL_IDS)
)


def default_lead_tool_ids() -> list[str]:
    """The Lead Agent's baseline **always-hot** tool set.

    Two slices:

    1. **Discovery + orchestration** (17 tools · E22 refresh)
       After E22 admin CRUD moved into skill packs, Lead only keeps the
       tools it needs every turn:

        - READ ``list_*`` / ``get_*`` on every agent-managed resource
          (providers / models / skills / mcp / employees) — needed so Lead
          can answer "what's configured?" without activating a skill
        - ``resolve_skill`` — the unlock mechanism for admin skill packs
        - ``dispatch_employee`` + ``spawn_subagent`` — core orchestration
        - ``plan_*`` 4-tuple — working memo, lightweight
        - ``cockpit.get_workspace_summary`` — state-of-the-world

       Pre-E22 the Lead had 45 write tools hot at once and would pick the
       wrong-shaped one; the skill-pack gate fixed that.

    2. **Render** (14 tools · L16 · 2026-04-22)
       Chart / table / kv / callout — these are how Lead communicates
       visually to the user. Gating them behind ``resolve_skill`` meant
       the LLM would hallucinate emoji markdown pretending to have drawn
       something (E20). Render is READ-scope and output-channel, not a
       CRUD pack — always-hot is the right default, same tier as
       ``list_*``.
    """
    # Hand-picked · NOT bundle-based (admin CRUD bundles stay skill-gated).
    # Keep this list short and reviewable.
    return [
        # Discovery (L06 protocol — always fresh, always hot)
        "allhands.meta.list_providers",
        "allhands.meta.get_provider",
        "allhands.meta.list_models",
        "allhands.meta.get_model",
        "allhands.meta.list_skills",
        "allhands.meta.get_skill_detail",
        "allhands.meta.list_mcp_servers",
        "allhands.meta.get_mcp_server",
        "allhands.meta.list_employees",
        "allhands.meta.get_employee_detail",
        # Orchestration
        "allhands.meta.resolve_skill",
        "allhands.meta.read_skill_file",
        "allhands.meta.dispatch_employee",
        "allhands.meta.spawn_subagent",
        # Working memo (Plan · 4 small tools · cheap to always have)
        "allhands.meta.plan_create",
        "allhands.meta.plan_update_step",
        "allhands.meta.plan_complete_step",
        "allhands.meta.plan_view",
        # State snapshot (single tool, compact output)
        "allhands.meta.cockpit.get_workspace_summary",
        # Output channel (L16 · render as how-the-LLM-visualises-reply,
        # not a capability pack). See module-level constant for rationale.
        *LEAD_ALWAYS_HOT_RENDER_TOOL_IDS,
    ]


# Legacy: some seed / backfill paths want the pre-E22 bundle dump to clone
# the full write surface onto an ad-hoc employee. Kept for those callers.
def legacy_lead_tool_ids_flat() -> list[str]:
    bundles = [
        ALL_META_TOOLS,
        ALL_PLAN_TOOLS,
        ALL_SKILL_META_TOOLS,
        ALL_MCP_SERVER_META_TOOLS,
        ALL_PROVIDER_META_TOOLS,
        ALL_MODEL_META_TOOLS,
        ALL_COCKPIT_META_TOOLS,
    ]
    seen: set[str] = set()
    out: list[str] = []
    for bundle in bundles:
        for tool in bundle:
            if tool.id in seen:
                continue
            seen.add(tool.id)
            out.append(tool.id)
    return out


async def ensure_lead_agent(repo: EmployeeRepo) -> Employee:
    """Create the Lead Agent if it doesn't exist yet; sync its system prompt
    from disk on every boot if it does.

    The prompt file (`execution/prompts/lead_agent.md`) is the single source
    of truth for Lead behaviour. Without the re-sync, a prompt edit would
    never reach the already-bootstrapped record, so regression tests like
    `TestL06CapabilityDiscovery` could stay green while the live LLM kept
    running with the stale text — the exact gap that let L06 happen.

    We only touch `system_prompt`; the user's customized tool_ids /
    skill_ids / model_ref are preserved.
    """
    existing = await repo.get_lead()
    canonical_prompt = load_lead_prompt()
    canonical_tools = set(default_lead_tool_ids())
    canonical_skills = set(LEAD_SKILL_IDS)
    legacy_tools = set(legacy_lead_tool_ids_flat())
    if existing is not None:
        updates: dict[str, object] = {}
        if existing.system_prompt != canonical_prompt:
            updates["system_prompt"] = canonical_prompt

        # E22 auto-upgrade: if the Lead still has the pre-refactor flat bundle
        # (was bootstrapped before the skill-pack split), migrate to the new
        # slim core + skill packs. We detect "pre-refactor Lead" by:
        #   (a) tool set is a subset of the legacy 45-tool bundle (no foreign
        #       tools the user manually added)
        #   (b) tool set contains multiple write-scope admin tools at once
        #       (create_employee AND create_provider AND create_model) — a
        #       signature only the old bundled bootstrap produced. This
        #       excludes test fixtures and user-trimmed Leads that keep only
        #       a subset of reads.
        legacy_signature = {
            "allhands.meta.create_employee",
            "allhands.meta.create_provider",
            "allhands.meta.create_model",
        }
        existing_tools = set(existing.tool_ids)
        looks_like_legacy_lead = (
            existing_tools.issubset(legacy_tools)
            and existing_tools != canonical_tools
            and len(legacy_signature & existing_tools) >= 2
        )
        if (
            looks_like_legacy_lead
            or existing_tools == set(_LEAD_BASELINE_PRE_RENDER_HOT)
            or existing_tools == set(_LEAD_BASELINE_POST_L16_PRE_ADR_0015)
        ):
            updates["tool_ids"] = list(default_lead_tool_ids())

        existing_skills = set(existing.skill_ids)
        if (
            looks_like_legacy_lead
            and existing_skills == set(DEFAULT_SKILL_IDS)
            and canonical_skills != existing_skills
        ):
            # Same guard: only migrate skill_ids when we already decided
            # this is a legacy-style Lead. Keeps user customizations intact.
            updates["skill_ids"] = list(LEAD_SKILL_IDS)

        if updates:
            return await repo.upsert(existing.model_copy(update=updates))
        return existing

    tool_ids = default_lead_tool_ids()
    now = datetime.now(UTC)
    lead = Employee(
        id=str(uuid.uuid4()),
        name="LeadAgent",
        description="The Lead Agent — user's primary interface to the platform.",
        system_prompt=canonical_prompt,
        model_ref="openai/gpt-4o-mini",
        tool_ids=tool_ids,
        skill_ids=list(LEAD_SKILL_IDS),
        max_iterations=20,
        is_lead_agent=True,
        status="published",
        created_by="system",
        created_at=now,
        published_at=now,
    )
    return await repo.upsert(lead)


async def scan_for_dropped_skill_references(session: object, *, dropped_id: str) -> int:
    """Count rows still referencing a removed skill id.

    P3 of artifacts unification (2026-04-26): the alembic 0029 migration
    rewrites stale 'allhands.drawio-creator' → 'allhands.artifacts'. This is
    a startup-time second line of defence: if the migration didn't run (mis-
    deploy) we want a loud warning, not a silent "skill not found" later.

    Returns the count of stale rows across employees + skill_runtimes. 0 means
    everything is clean.
    """
    from sqlalchemy import text

    s: Any = session  # AsyncSession-shaped; runtime check instead of typed
    n = 0
    rows = (await s.execute(text("SELECT skill_ids FROM employees"))).fetchall()
    for (raw,) in rows:
        if raw is None:
            continue
        # SQLAlchemy returns either parsed JSON (dict/list) or raw text. Cover
        # both shapes by string-searching the JSON form.
        haystack = raw if isinstance(raw, str) else _json_dumps(raw)
        if dropped_id in haystack:
            n += 1
    rows = (await s.execute(text("SELECT body FROM skill_runtimes"))).fetchall()
    for (raw,) in rows:
        if raw is None:
            continue
        haystack = raw if isinstance(raw, str) else _json_dumps(raw)
        if dropped_id in haystack:
            n += 1
    return n


def _json_dumps(value: object) -> str:
    import json

    try:
        return json.dumps(value, ensure_ascii=False)
    except (TypeError, ValueError):
        return str(value)


@dataclass(frozen=True)
class GatewayModelPreset:
    name: str
    display_name: str = ""
    context_window: int = 0


@dataclass(frozen=True)
class GatewayProviderPreset:
    name: str
    kind: str
    base_url: str
    default_model: str
    models: list[GatewayModelPreset] = field(default_factory=list)


# One provider per supported format so a pristine install immediately shows
# all three wire formats (openai / anthropic / aliyun). All start with
# api_key="" so the user sees the 401/auth failure state cleanly in ping —
# filling a real key is a single inline edit.
GATEWAY_SEED_PRESETS: list[GatewayProviderPreset] = [
    GatewayProviderPreset(
        name="OpenAI",
        kind="openai",
        base_url="https://api.openai.com/v1",
        default_model="gpt-4o-mini",
        models=[
            GatewayModelPreset(
                name="gpt-4o-mini", display_name="GPT-4o Mini", context_window=128_000
            ),
            GatewayModelPreset(name="gpt-4o", display_name="GPT-4o", context_window=128_000),
        ],
    ),
    GatewayProviderPreset(
        name="Anthropic",
        kind="anthropic",
        base_url="https://api.anthropic.com",
        default_model="claude-3-5-sonnet-latest",
        models=[
            GatewayModelPreset(
                name="claude-3-5-sonnet-latest",
                display_name="Claude 3.5 Sonnet",
                context_window=200_000,
            ),
            GatewayModelPreset(
                name="claude-3-5-haiku-latest",
                display_name="Claude 3.5 Haiku",
                context_window=200_000,
            ),
        ],
    ),
    GatewayProviderPreset(
        name="阿里云 百炼",
        kind="aliyun",
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        default_model="qwen-plus",
        models=[
            GatewayModelPreset(name="qwen-turbo", display_name="Qwen Turbo", context_window=8_192),
            GatewayModelPreset(name="qwen-plus", display_name="Qwen Plus", context_window=32_768),
            GatewayModelPreset(name="qwen-max", display_name="Qwen Max", context_window=32_768),
        ],
    ),
]


async def ensure_gateway_demo_seeds(
    provider_repo: LLMProviderRepo,
    model_repo: LLMModelRepo,
) -> bool:
    """Seed demo providers + models on a pristine install (I-0019 phase 4).

    Idempotent: fires only when the provider table is empty. Once the user
    has added *any* provider (or deleted all seeded rows), subsequent calls
    are no-ops. Returns True if seeds were written, False otherwise.

    The first preset's canonical model (preset.default_model) is also marked
    as the workspace default via `model_repo.set_default()`. The preset's
    `default_model` field is kept here as a static "what's this kind's
    canonical model" hint — it is NOT persisted to a provider row anymore
    (the provider has no default_model column post-2026-04-25).
    """
    existing = await provider_repo.list_all()
    if existing:
        return False

    canonical_default_id: str | None = None
    for preset_idx, preset in enumerate(GATEWAY_SEED_PRESETS):
        provider = LLMProvider(
            id=str(uuid.uuid4()),
            name=preset.name,
            kind=preset.kind,  # type: ignore[arg-type]
            base_url=preset.base_url,
            api_key="",
        )
        saved = await provider_repo.upsert(provider)
        for m in preset.models:
            model_id = str(uuid.uuid4())
            await model_repo.upsert(
                LLMModel(
                    id=model_id,
                    provider_id=saved.id,
                    name=m.name,
                    display_name=m.display_name,
                    context_window=m.context_window,
                )
            )
            if preset_idx == 0 and m.name == preset.default_model and canonical_default_id is None:
                canonical_default_id = model_id

    if canonical_default_id is not None:
        await model_repo.set_default(canonical_default_id)
    return True
