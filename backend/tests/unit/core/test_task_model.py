"""Core Task model + state machine tests.

Spec: `docs/specs/agent-design/2026-04-18-tasks.md` § 2.2 / § 3. Legal
transitions are enforced by `is_legal_transition`; these tests lock down the
matrix so accidental regressions (e.g. "terminal → running") can't slip in.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from allhands.core import (
    ACTIVE_STATUSES,
    PENDING_USER_STATUSES,
    TERMINAL_STATUSES,
    Task,
    TaskSource,
    TaskStatus,
    is_legal_transition,
)


def _task(**overrides: object) -> Task:
    now = datetime.now(UTC)
    data: dict[str, object] = {
        "id": "T-test",
        "title": "demo",
        "goal": "g",
        "dod": "d",
        "assignee_id": "emp-1",
        "source": TaskSource.USER,
        "created_by": "user",
        "created_at": now,
        "updated_at": now,
    }
    data.update(overrides)
    return Task(**data)  # type: ignore[arg-type]


class TestTaskStatus:
    def test_terminal_statuses_are_complete(self) -> None:
        assert (
            frozenset({TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED})
            == TERMINAL_STATUSES
        )

    def test_pending_user_statuses(self) -> None:
        assert (
            frozenset({TaskStatus.NEEDS_INPUT, TaskStatus.NEEDS_APPROVAL}) == PENDING_USER_STATUSES
        )

    def test_active_statuses_exclude_terminal(self) -> None:
        assert ACTIVE_STATUSES.isdisjoint(TERMINAL_STATUSES)


class TestLegalTransitions:
    @pytest.mark.parametrize(
        ("from_s", "to_s"),
        [
            (TaskStatus.QUEUED, TaskStatus.RUNNING),
            (TaskStatus.QUEUED, TaskStatus.CANCELLED),
            (TaskStatus.RUNNING, TaskStatus.NEEDS_INPUT),
            (TaskStatus.RUNNING, TaskStatus.NEEDS_APPROVAL),
            (TaskStatus.RUNNING, TaskStatus.COMPLETED),
            (TaskStatus.RUNNING, TaskStatus.FAILED),
            (TaskStatus.RUNNING, TaskStatus.CANCELLED),
            (TaskStatus.NEEDS_INPUT, TaskStatus.RUNNING),
            (TaskStatus.NEEDS_INPUT, TaskStatus.CANCELLED),
            (TaskStatus.NEEDS_APPROVAL, TaskStatus.RUNNING),
            (TaskStatus.NEEDS_APPROVAL, TaskStatus.CANCELLED),
            (TaskStatus.NEEDS_APPROVAL, TaskStatus.FAILED),
        ],
    )
    def test_legal(self, from_s: TaskStatus, to_s: TaskStatus) -> None:
        assert is_legal_transition(from_s, to_s)

    @pytest.mark.parametrize(
        "to_s",
        [
            TaskStatus.QUEUED,
            TaskStatus.RUNNING,
            TaskStatus.NEEDS_INPUT,
            TaskStatus.NEEDS_APPROVAL,
            TaskStatus.COMPLETED,
            TaskStatus.FAILED,
            TaskStatus.CANCELLED,
        ],
    )
    def test_same_status_always_legal(self, to_s: TaskStatus) -> None:
        assert is_legal_transition(to_s, to_s)

    @pytest.mark.parametrize(
        ("from_s", "to_s"),
        [
            (TaskStatus.COMPLETED, TaskStatus.RUNNING),
            (TaskStatus.FAILED, TaskStatus.RUNNING),
            (TaskStatus.CANCELLED, TaskStatus.RUNNING),
            (TaskStatus.QUEUED, TaskStatus.COMPLETED),
            (TaskStatus.QUEUED, TaskStatus.NEEDS_INPUT),
            (TaskStatus.COMPLETED, TaskStatus.FAILED),
            (TaskStatus.NEEDS_INPUT, TaskStatus.NEEDS_APPROVAL),
        ],
    )
    def test_illegal(self, from_s: TaskStatus, to_s: TaskStatus) -> None:
        assert not is_legal_transition(from_s, to_s)


class TestTaskHelpers:
    def test_is_terminal_reports_correctly(self) -> None:
        assert _task(status=TaskStatus.COMPLETED).is_terminal()
        assert _task(status=TaskStatus.FAILED).is_terminal()
        assert _task(status=TaskStatus.CANCELLED).is_terminal()
        assert not _task(status=TaskStatus.RUNNING).is_terminal()
        assert not _task(status=TaskStatus.QUEUED).is_terminal()

    def test_needs_user_reports_correctly(self) -> None:
        assert _task(status=TaskStatus.NEEDS_INPUT).needs_user()
        assert _task(status=TaskStatus.NEEDS_APPROVAL).needs_user()
        assert not _task(status=TaskStatus.RUNNING).needs_user()

    def test_task_is_frozen(self) -> None:
        t = _task()
        with pytest.raises(Exception):
            t.status = TaskStatus.RUNNING  # type: ignore[misc]
