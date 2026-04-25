"""Plan tool executors · ADR 0019 C1 · Claude-Code-style atomic todo list.

The new executor is a single function bound to (plan_repo, conversation_id,
employee_id). Every call replaces the conversation's plan steps atomically.

Status mapping
--------------

The agent-facing API uses Claude Code's three statuses (pending / in_progress
/ completed). We map them to the existing AgentPlan StepStatus enum so the
DB schema and frontend types don't need to change:

    pending      → StepStatus.PENDING
    in_progress  → StepStatus.RUNNING
    completed    → StepStatus.DONE

Validation rules (rejected with structured error envelope):
  - 1-20 todos
  - each content / activeForm non-empty after strip()
  - **at most one todo with status="in_progress"** — Claude Code's rule
  - status string must be one of the three values

Atomic replace semantics:
  - Look up the conversation's latest plan
  - If exists: keep its plan_id, replace its title (if explicitly given) +
    steps wholesale, bump updated_at
  - If not: create a fresh plan with a new uuid

This means within a single conversation, the plan_id is stable across
update_plan calls — the UI's GET /plans/latest just keeps refreshing the
same panel rather than seeing a flicker between two plans.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from allhands.core.plan import AgentPlan, PlanStep, StepStatus

if TYPE_CHECKING:
    from allhands.execution.registry import ToolExecutor
    from allhands.persistence.repositories import AgentPlanRepo


UPDATE_PLAN_TOOL_ID = "allhands.meta.update_plan"
VIEW_PLAN_TOOL_ID = "allhands.meta.view_plan"


_STATUS_MAP: dict[str, StepStatus] = {
    "pending": StepStatus.PENDING,
    "in_progress": StepStatus.RUNNING,
    "completed": StepStatus.DONE,
}

_REVERSE_STATUS_MAP: dict[StepStatus, str] = {v: k for k, v in _STATUS_MAP.items()}


def _now() -> datetime:
    return datetime.now(UTC)


def _summarize(todos: list[dict[str, Any]]) -> str:
    """Tiny human-readable echo, returned as the tool result so the agent
    sees "3/5 done · 1 in progress" and can compose its next status line.
    """
    total = len(todos)
    done = sum(1 for t in todos if t.get("status") == "completed")
    running = sum(1 for t in todos if t.get("status") == "in_progress")
    bits = [f"{done}/{total} done"]
    if running:
        bits.append(f"{running} in progress")
    pending = total - done - running
    if pending:
        bits.append(f"{pending} pending")
    return " · ".join(bits)


def make_update_plan_executor(
    *,
    repo: AgentPlanRepo,
    conversation_id: str,
    employee_id: str,
) -> ToolExecutor:
    """Build the update_plan executor bound to this conversation."""

    async def _exec(
        *,
        todos: list[Any] | None = None,
        title: str | None = None,
    ) -> dict[str, Any]:
        # ── Validation: shape ────────────────────────────────────────────
        if not isinstance(todos, list) or not todos:
            return {"error": "todos must be a non-empty list"}
        if len(todos) > 20:
            return {"error": "plan supports up to 20 todos"}

        # ── Validation: per-item ─────────────────────────────────────────
        normalized: list[tuple[str, str, StepStatus]] = []
        in_progress_count = 0
        for i, raw in enumerate(todos):
            if not isinstance(raw, dict):
                return {"error": f"todo[{i}] must be an object"}
            content = str(raw.get("content", "")).strip()
            active_form = str(raw.get("activeForm", "")).strip()
            status_str = str(raw.get("status", "")).strip()

            if not content:
                return {"error": f"todo[{i}].content is empty"}
            if not active_form:
                # Soft-default activeForm to content when the model forgot —
                # Claude Code's prompt warns models to provide both, but
                # weaker models miss this. Falling back keeps progress
                # moving instead of failing the call.
                active_form = content

            mapped = _STATUS_MAP.get(status_str)
            if mapped is None:
                return {
                    "error": (
                        f"todo[{i}].status must be one of {list(_STATUS_MAP)}, got {status_str!r}"
                    ),
                }
            if mapped is StepStatus.RUNNING:
                in_progress_count += 1

            normalized.append((content, active_form, mapped))

        # Claude Code rule: at most one in_progress at a time.
        if in_progress_count > 1:
            return {
                "error": (
                    f"only one todo may be in_progress at a time "
                    f"(got {in_progress_count}). Mark the others completed "
                    "or pending."
                ),
            }

        # ── Atomic replace semantics ─────────────────────────────────────
        existing = await repo.get_latest_for_conversation(conversation_id)
        now = _now()

        if existing is not None:
            plan_id = existing.id
            new_title = title.strip() if title and title.strip() else existing.title
            created_at = existing.created_at
        else:
            plan_id = str(uuid.uuid4())
            new_title = title.strip() if title and title.strip() else _derive_title(normalized)
            created_at = now

        steps = [
            PlanStep(
                index=i,
                title=content,
                status=status,
                # Stash activeForm into note for now — the backend's
                # PlanStep doesn't have a dedicated activeForm column. UI
                # already renders note as the secondary line, so this
                # surfaces nicely without a migration.
                note=active_form if active_form != content else None,
            )
            for i, (content, active_form, status) in enumerate(normalized)
        ]

        plan = AgentPlan(
            id=plan_id,
            conversation_id=conversation_id,
            run_id=None,
            owner_employee_id=employee_id,
            title=new_title,
            steps=steps,
            created_at=created_at,
            updated_at=now,
        )
        await repo.upsert(plan)

        # Echo back the summary + plan_id so the agent's next text turn can
        # reference progress without a separate view_plan call.
        return {
            "plan_id": plan_id,
            "summary": _summarize(todos),
        }

    return _exec


def _derive_title(
    normalized: list[tuple[str, str, StepStatus]],
) -> str:
    """When the agent doesn't provide a title on the first call, fall back
    to a short auto-derived one so the UI doesn't render an empty header.
    """
    if not normalized:
        return "Plan"
    first_content = normalized[0][0]
    snippet = first_content[:48]
    return f"Plan · {snippet}{'…' if len(first_content) > 48 else ''}"


def make_view_plan_executor(
    *,
    repo: AgentPlanRepo,
    conversation_id: str,
) -> ToolExecutor:
    """view_plan returns the current plan as a structured object (NOT a
    render envelope this time — the UI already shows the timeline via
    ProgressPanel pulling from /plans/latest).

    Used when the chat has been compacted and the model needs to recall
    its own plan.
    """

    async def _exec() -> dict[str, Any]:
        plan = await repo.get_latest_for_conversation(conversation_id)
        if plan is None:
            return {
                "error": ("no plan exists for this conversation yet — call update_plan first"),
            }
        return {
            "plan_id": plan.id,
            "title": plan.title,
            "todos": [
                {
                    "content": s.title,
                    "activeForm": s.note or s.title,
                    "status": _REVERSE_STATUS_MAP.get(s.status, "pending"),
                }
                for s in plan.steps
            ],
        }

    return _exec


__all__ = [
    "UPDATE_PLAN_TOOL_ID",
    "VIEW_PLAN_TOOL_ID",
    "make_update_plan_executor",
    "make_view_plan_executor",
]
