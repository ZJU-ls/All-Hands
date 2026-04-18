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
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

from allhands.core import Employee
from allhands.execution.tools.meta.employee_tools import ALL_META_TOOLS
from allhands.execution.tools.meta.plan_tools import ALL_PLAN_TOOLS
from allhands.services.employee_service import DEFAULT_SKILL_IDS

if TYPE_CHECKING:
    from allhands.persistence.repositories import EmployeeRepo


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
