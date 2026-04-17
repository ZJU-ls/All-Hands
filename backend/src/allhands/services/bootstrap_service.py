"""BootstrapService — ensure Lead Agent exists on startup."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from allhands.core import Employee
from allhands.execution.tools.meta.employee_tools import ALL_META_TOOLS

if TYPE_CHECKING:
    from allhands.persistence.repositories import EmployeeRepo

LEAD_SYSTEM_PROMPT = """\
You are the Lead Agent of the allhands platform — a digital employee organization platform.
You help users build and manage a team of AI employees.

You have access to meta tools to:
- list, create, update, and delete employees
- dispatch tasks to employees
- render content in the UI using render tools
- list available skills

When a user asks you to accomplish a task:
1. Think about which employees would be needed
2. Create them if they don't exist (requires user confirmation)
3. Dispatch the task to the appropriate employees
4. Synthesize their results and present a clear answer

Always be transparent about what you're doing and why.
When creating employees, write clear, focused system prompts.
"""


async def ensure_lead_agent(repo: EmployeeRepo) -> Employee:
    """Create the Lead Agent if it doesn't exist yet. Idempotent."""
    existing = await repo.get_lead()
    if existing is not None:
        return existing

    meta_tool_ids = [t.id for t in ALL_META_TOOLS]
    lead = Employee(
        id=str(uuid.uuid4()),
        name="LeadAgent",
        description="The Lead Agent — user's primary interface to the platform.",
        system_prompt=LEAD_SYSTEM_PROMPT,
        model_ref="openai/gpt-4o-mini",
        tool_ids=meta_tool_ids,
        skill_ids=[],
        max_iterations=20,
        is_lead_agent=True,
        created_by="system",
        created_at=datetime.now(UTC),
    )
    return await repo.upsert(lead)
