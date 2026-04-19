"""BootstrapService — ensure Lead Agent exists on startup.

The Lead Agent gets:

- All employee meta tools (list/get_detail/create/update/delete/dispatch)
- All Plan family tools — Lead should plan its own delegation flow
- Default `skill_ids` (render + artifacts) so the Lead can output visible
  work without extra wiring

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
from allhands.execution.tools.meta.employee_tools import ALL_META_TOOLS
from allhands.execution.tools.meta.plan_tools import ALL_PLAN_TOOLS
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


async def ensure_lead_agent(repo: EmployeeRepo) -> Employee:
    """Create the Lead Agent if it doesn't exist yet. Idempotent."""
    existing = await repo.get_lead()
    if existing is not None:
        return existing

    tool_ids = [t.id for t in ALL_META_TOOLS] + [t.id for t in ALL_PLAN_TOOLS]
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
    base_url: str
    default_model: str
    models: list[GatewayModelPreset] = field(default_factory=list)


# Three popular OpenAI-compatible endpoints. Seeded with api_key="" so the
# user sees them immediately but must fill a key before a ping succeeds —
# PingIndicator's "auth" failure state then demos cleanly (I-0019 §PingIndicator).
GATEWAY_SEED_PRESETS: list[GatewayProviderPreset] = [
    GatewayProviderPreset(
        name="百炼 (DashScope)",
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        default_model="qwen-plus",
        models=[
            GatewayModelPreset(name="qwen-turbo", display_name="Qwen Turbo", context_window=8_192),
            GatewayModelPreset(name="qwen-plus", display_name="Qwen Plus", context_window=32_768),
            GatewayModelPreset(name="qwen-max", display_name="Qwen Max", context_window=8_192),
        ],
    ),
    GatewayProviderPreset(
        name="OpenRouter",
        base_url="https://openrouter.ai/api/v1",
        default_model="openrouter/auto",
        models=[
            GatewayModelPreset(
                name="openrouter/auto",
                display_name="Auto Router",
                context_window=0,
            ),
            GatewayModelPreset(
                name="anthropic/claude-3.5-sonnet",
                display_name="Claude 3.5 Sonnet",
                context_window=200_000,
            ),
        ],
    ),
    GatewayProviderPreset(
        name="DeepSeek",
        base_url="https://api.deepseek.com/v1",
        default_model="deepseek-chat",
        models=[
            GatewayModelPreset(
                name="deepseek-chat",
                display_name="DeepSeek Chat",
                context_window=64_000,
            ),
            GatewayModelPreset(
                name="deepseek-reasoner",
                display_name="DeepSeek Reasoner",
                context_window=64_000,
            ),
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
