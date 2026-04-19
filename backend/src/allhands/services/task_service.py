"""TaskService — CRUD + state transitions for asynchronous work units.

Spec: `docs/specs/agent-design/2026-04-18-tasks.md` § 4 / § 6.

v0 ships as a **persistence + lifecycle** layer. The actual `TaskExecutor` that
pulls `queued` tasks and runs them through an agent (§ 4.1) and LangGraph
checkpointer resume (§ 4.4) are deferred to v0.1; this service emits the state
transitions so downstream (cockpit / inbox / meta tool responses) already work.

When the executor lands, it will: (1) poll `list_all(statuses=[QUEUED])`,
(2) call `start(task_id, run_id)` to move QUEUED → RUNNING, (3) call
`request_input` / `request_approval` / `complete` / `fail` as the run progresses,
(4) call `answer_input` / `approve` to resume.

Every state transition fans out a `task.*` event on the provided event bus so
the cockpit activity stream picks it up (spec § 4.3). Emission is best-effort:
persistence is the source of truth, events just drive live UI.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from allhands.core import (
    Task,
    TaskSource,
    TaskStatus,
    is_legal_transition,
)
from allhands.core.errors import DomainError
from allhands.core.trigger import EventEnvelope

if TYPE_CHECKING:
    from collections.abc import Callable

    from allhands.persistence.repositories import TaskRepo


_ID_PREFIX = "T-"


def _new_task_id() -> str:
    return _ID_PREFIX + uuid.uuid4().hex[:12]


def _now() -> datetime:
    return datetime.now(UTC)


class TaskError(DomainError):
    """Task validation / transition failure."""


class TaskNotFound(TaskError):
    pass


class TaskTransitionError(TaskError):
    """Attempted state transition is not legal."""


class TaskService:
    """Persistence + state machine for Task aggregates.

    Event emission is **fire-and-forget**: if the event bus is None or raises,
    the state change still persists. This keeps the API contract
    "state-changes-always-commit" and prevents cockpit hiccups from rolling
    back user actions.
    """

    def __init__(
        self,
        repo: TaskRepo,
        *,
        event_emitter: Callable[[EventEnvelope], Any] | None = None,
    ) -> None:
        self._repo = repo
        self._emit = event_emitter

    async def _emit_event(
        self,
        kind: str,
        task: Task,
        *,
        severity: str = "info",
        extra_payload: dict[str, Any] | None = None,
    ) -> None:
        if self._emit is None:
            return
        payload: dict[str, Any] = {
            "task_id": task.id,
            "title": task.title,
            "status": task.status.value,
            "assignee_id": task.assignee_id,
        }
        if extra_payload:
            payload.update(extra_payload)
        envelope = EventEnvelope(
            id=uuid.uuid4().hex,
            kind=kind,
            payload=payload,
            published_at=_now(),
            actor=task.assignee_id,
            subject=task.id,
            severity=severity,
            link=f"/tasks/{task.id}",
            workspace_id=task.workspace_id,
        )
        try:
            result = self._emit(envelope)
            if hasattr(result, "__await__"):
                await result
        except Exception:
            # Event emission is best-effort; never fail the state change.
            pass

    # ------------------------------------------------------------------ READ

    async def get(self, task_id: str) -> Task:
        task = await self._repo.get(task_id)
        if task is None:
            raise TaskNotFound(f"task not found: {task_id}")
        return task

    async def try_get(self, task_id: str) -> Task | None:
        return await self._repo.get(task_id)

    async def list_all(
        self,
        *,
        workspace_id: str = "default",
        statuses: list[TaskStatus] | None = None,
        assignee_id: str | None = None,
        limit: int = 100,
    ) -> list[Task]:
        return await self._repo.list_all(
            workspace_id=workspace_id,
            statuses=statuses,
            assignee_id=assignee_id,
            limit=limit,
        )

    async def count_active(self, workspace_id: str = "default") -> int:
        return await self._repo.count_active(workspace_id)

    # ---------------------------------------------------------------- CREATE

    async def create(
        self,
        *,
        title: str,
        goal: str,
        dod: str,
        assignee_id: str,
        source: TaskSource,
        created_by: str,
        workspace_id: str = "default",
        parent_task_id: str | None = None,
        token_budget: int | None = None,
    ) -> Task:
        title = title.strip()
        goal = goal.strip()
        dod = dod.strip()
        if not title:
            raise TaskError("title is required")
        if not goal:
            raise TaskError("goal is required")
        if not dod:
            raise TaskError("dod is required · every task needs a Definition of Done")
        now = _now()
        task = Task(
            id=_new_task_id(),
            workspace_id=workspace_id,
            title=title,
            goal=goal,
            dod=dod,
            assignee_id=assignee_id,
            status=TaskStatus.QUEUED,
            source=source,
            created_by=created_by,
            parent_task_id=parent_task_id,
            token_budget=token_budget,
            created_at=now,
            updated_at=now,
        )
        saved = await self._repo.upsert(task)
        await self._emit_event("task.created", saved)
        return saved

    # ------------------------------------------------------ STATE TRANSITIONS

    async def _transition(
        self,
        task_id: str,
        *,
        to: TaskStatus,
        changes: dict[str, Any] | None = None,
    ) -> Task:
        task = await self.get(task_id)
        if not is_legal_transition(task.status, to):
            raise TaskTransitionError(
                f"illegal transition {task.status.value} -> {to.value} for task {task_id}"
            )
        updates: dict[str, Any] = {
            "status": to,
            "updated_at": _now(),
        }
        if to in {TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED}:
            updates["completed_at"] = updates["updated_at"]
        if changes:
            updates.update(changes)
        return await self._repo.upsert(task.model_copy(update=updates))

    async def start(self, task_id: str, run_id: str) -> Task:
        task = await self.get(task_id)
        run_ids = [*task.run_ids, run_id] if run_id not in task.run_ids else list(task.run_ids)
        saved = await self._transition(
            task_id,
            to=TaskStatus.RUNNING,
            changes={
                "run_ids": run_ids,
                "pending_input_question": None,
                "pending_approval_payload": None,
            },
        )
        await self._emit_event("task.started", saved)
        return saved

    async def request_input(self, task_id: str, question: str) -> Task:
        question = question.strip()
        if not question:
            raise TaskError("question is required")
        saved = await self._transition(
            task_id,
            to=TaskStatus.NEEDS_INPUT,
            changes={"pending_input_question": question},
        )
        await self._emit_event(
            "task.needs_input",
            saved,
            severity="warn",
            extra_payload={"question": question},
        )
        return saved

    async def request_approval(self, task_id: str, payload: dict[str, Any]) -> Task:
        if not payload:
            raise TaskError("approval payload is required")
        saved = await self._transition(
            task_id,
            to=TaskStatus.NEEDS_APPROVAL,
            changes={"pending_approval_payload": dict(payload)},
        )
        await self._emit_event(
            "task.needs_approval",
            saved,
            severity="warn",
            extra_payload={"approval": dict(payload)},
        )
        return saved

    async def answer_input(self, task_id: str, answer: str) -> Task:
        answer = answer.strip()
        if not answer:
            raise TaskError("answer is required")
        task = await self.get(task_id)
        if task.status != TaskStatus.NEEDS_INPUT:
            raise TaskTransitionError(
                f"cannot answer task in status {task.status.value} · expected needs_input"
            )
        saved = await self._transition(
            task_id,
            to=TaskStatus.RUNNING,
            changes={
                "pending_input_question": None,
            },
        )
        await self._emit_event(
            "task.answered",
            saved,
            extra_payload={"answer_preview": answer[:200]},
        )
        return saved

    async def approve(self, task_id: str, *, decision: str, note: str | None = None) -> Task:
        decision = decision.strip().lower()
        if decision not in {"approved", "denied"}:
            raise TaskError("decision must be 'approved' or 'denied'")
        task = await self.get(task_id)
        if task.status != TaskStatus.NEEDS_APPROVAL:
            raise TaskTransitionError(
                f"cannot approve task in status {task.status.value} · expected needs_approval"
            )
        if decision == "approved":
            saved = await self._transition(
                task_id,
                to=TaskStatus.RUNNING,
                changes={"pending_approval_payload": None},
            )
            await self._emit_event(
                "task.approved",
                saved,
                extra_payload={"note": note or ""},
            )
        else:
            saved = await self._transition(
                task_id,
                to=TaskStatus.FAILED,
                changes={
                    "pending_approval_payload": None,
                    "error_summary": f"approval denied: {note or '(no note)'}",
                },
            )
            await self._emit_event(
                "task.denied",
                saved,
                severity="warn",
                extra_payload={"note": note or ""},
            )
        return saved

    async def complete(
        self,
        task_id: str,
        *,
        result_summary: str,
        artifact_ids: list[str] | None = None,
        tokens_used: int | None = None,
    ) -> Task:
        if not result_summary.strip():
            raise TaskError("result_summary is required to complete a task")
        task = await self.get(task_id)
        merged_artifacts = list(task.artifact_ids)
        for aid in artifact_ids or []:
            if aid not in merged_artifacts:
                merged_artifacts.append(aid)
        changes: dict[str, Any] = {
            "result_summary": result_summary,
            "artifact_ids": merged_artifacts,
            "pending_input_question": None,
            "pending_approval_payload": None,
        }
        if tokens_used is not None:
            changes["tokens_used"] = tokens_used
        saved = await self._transition(task_id, to=TaskStatus.COMPLETED, changes=changes)
        await self._emit_event("task.completed", saved)
        return saved

    async def fail(self, task_id: str, *, error_summary: str) -> Task:
        if not error_summary.strip():
            raise TaskError("error_summary is required to fail a task")
        saved = await self._transition(
            task_id,
            to=TaskStatus.FAILED,
            changes={
                "error_summary": error_summary,
                "pending_input_question": None,
                "pending_approval_payload": None,
            },
        )
        await self._emit_event("task.failed", saved, severity="error")
        return saved

    async def cancel(self, task_id: str, *, reason: str | None = None) -> Task:
        task = await self.get(task_id)
        if task.status in {TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED}:
            raise TaskTransitionError(
                f"task {task_id} already in terminal state {task.status.value}"
            )
        changes: dict[str, Any] = {
            "pending_input_question": None,
            "pending_approval_payload": None,
        }
        if reason:
            changes["error_summary"] = f"cancelled: {reason}"
        saved = await self._transition(task_id, to=TaskStatus.CANCELLED, changes=changes)
        await self._emit_event(
            "task.cancelled",
            saved,
            severity="warn",
            extra_payload={"reason": reason or ""},
        )
        return saved

    async def add_artifact(self, task_id: str, artifact_id: str) -> Task:
        task = await self.get(task_id)
        if artifact_id in task.artifact_ids:
            return task
        return await self._repo.upsert(
            task.model_copy(
                update={
                    "artifact_ids": [*task.artifact_ids, artifact_id],
                    "updated_at": _now(),
                }
            )
        )
