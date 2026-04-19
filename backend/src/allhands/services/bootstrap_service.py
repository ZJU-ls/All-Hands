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
from typing import TYPE_CHECKING

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
from allhands.services.employee_service import DEFAULT_SKILL_IDS

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


def default_lead_tool_ids() -> list[str]:
    """The Lead Agent's baseline tool surface.

    Covers every agent-managed resource's CRUD + runtime actions. Exposed as
    a function (not a module constant) so callers outside bootstrap — e.g.
    seed_service, or a future `upgrade-lead-tools` admin op — can reuse the
    same list without risking import cycles or stale caching.
    """
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
    """Create the Lead Agent if it doesn't exist yet. Idempotent."""
    existing = await repo.get_lead()
    if existing is not None:
        return existing

    tool_ids = default_lead_tool_ids()
    lead = Employee(
        id=str(uuid.uuid4()),
        name="LeadAgent",
        description="The Lead Agent — user's primary interface to the platform.",
        system_prompt=load_lead_prompt(),
        model_ref="openai/gpt-4o-mini",
        tool_ids=tool_ids,
        skill_ids=list(DEFAULT_SKILL_IDS),
        max_iterations=20,
        is_lead_agent=True,
        created_by="system",
        created_at=datetime.now(UTC),
    )
    return await repo.upsert(lead)


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
    """
    existing = await provider_repo.list_all()
    if existing:
        return False

    for preset in GATEWAY_SEED_PRESETS:
        provider = LLMProvider(
            id=str(uuid.uuid4()),
            name=preset.name,
            kind=preset.kind,  # type: ignore[arg-type]
            base_url=preset.base_url,
            api_key="",
            default_model=preset.default_model,
            is_default=False,
        )
        saved = await provider_repo.upsert(provider)
        for m in preset.models:
            await model_repo.upsert(
                LLMModel(
                    id=str(uuid.uuid4()),
                    provider_id=saved.id,
                    name=m.name,
                    display_name=m.display_name,
                    context_window=m.context_window,
                )
            )
    return True
