# ruff: noqa: E402
"""ADR 0014 · Phase 4b — POST /api/conversations/{id}/resume endpoint.

Narrow test scope:
  1. Service layer: ChatService.resume_message raises DomainError when the
     conversation doesn't exist (mirrors send_message).
  2. Service layer: ChatService.resume_message raises DomainError when no
     checkpointer is wired — resume is meaningless without one.
  3. HTTP layer: POST /api/conversations/{id}/resume returns 200 and SSE
     stream headers (TestClient + aiosqlite chunked streaming has a known
     deadlock so we assert response type, not the streaming body).

Phase 4c (gate migration) + integration-level "real round trip" tests are
deferred — the Phase 3 test_interrupt_resume.py already covers the
runner-level resume round-trip end-to-end. These are the ADR Phase 4b
plumbing guarantees.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from datetime import UTC, datetime

import pytest

pytestmark = pytest.mark.skip(reason="ADR 0018: legacy checkpointer/interrupt model · superseded")
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from allhands.api import create_app
from allhands.api.deps import get_session
from allhands.core import Conversation, Employee
from allhands.core.errors import DomainError
from allhands.execution.gate import AutoApproveGate
from allhands.execution.registry import ToolRegistry
from allhands.execution.skills import SkillRegistry
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import SqlConversationRepo, SqlEmployeeRepo
from allhands.services.chat_service import ChatService


def _make_emp() -> Employee:
    return Employee(
        id="emp-resume",
        name="resume-test",
        description="",
        system_prompt="test",
        model_ref="default",
        tool_ids=[],
        skill_ids=[],
        max_iterations=3,
        is_lead_agent=False,
        created_by="system",
        created_at=datetime.now(UTC),
        metadata={},
    )


def _make_conv() -> Conversation:
    return Conversation(
        id="conv-resume",
        employee_id="emp-resume",
        title=None,
        created_at=datetime(2026, 4, 23, tzinfo=UTC),
        metadata={},
    )


async def _seed(engine) -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as session:
        await SqlEmployeeRepo(session).upsert(_make_emp())
        await SqlConversationRepo(session).create(_make_conv())


@pytest.mark.asyncio
async def test_resume_message_raises_when_conversation_missing() -> None:
    """Service-layer guard: a stale conversation id must surface as a
    DomainError, not a silent 500 or a deadlock inside the runner."""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    await _seed(engine)
    maker = async_sessionmaker(engine, expire_on_commit=False)

    async with maker() as session:
        svc = ChatService(
            employee_repo=SqlEmployeeRepo(session),
            conversation_repo=SqlConversationRepo(session),
            tool_registry=ToolRegistry(),
            skill_registry=SkillRegistry(),
            gate=AutoApproveGate(),
        )
        with pytest.raises(DomainError, match="not found"):
            await svc.resume_message("does-not-exist", resume_value="approve")


@pytest.mark.asyncio
async def test_resume_message_raises_without_checkpointer() -> None:
    """Without a checkpointer, LangGraph has nothing to resume from. Surface
    that as a DomainError up front rather than let astream produce an
    opaque error. Matches ADR 0014 R5: resume requires a checkpointer."""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    await _seed(engine)
    maker = async_sessionmaker(engine, expire_on_commit=False)

    async with maker() as session:
        svc = ChatService(
            employee_repo=SqlEmployeeRepo(session),
            conversation_repo=SqlConversationRepo(session),
            tool_registry=ToolRegistry(),
            skill_registry=SkillRegistry(),
            gate=AutoApproveGate(),
            # checkpointer intentionally omitted
        )
        with pytest.raises(DomainError, match="checkpointer"):
            await svc.resume_message("conv-resume", resume_value="approve")


def test_resume_http_endpoint_is_mounted_and_accepts_body() -> None:
    """HTTP smoke test: the endpoint is mounted at the expected path and
    accepts a JSON body shaped like ``{"resume_value": ...}``. We don't
    drive the SSE body here (TestClient + aiosqlite deadlock — tracked in
    test_cockpit_api.py's SKIP); we assert the endpoint exists and the
    request doesn't bounce off routing or schema. Real SSE round-trip
    runs in e2e."""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    asyncio.run(_seed(engine))

    async def _session() -> AsyncIterator[AsyncSession]:
        maker = async_sessionmaker(engine, expire_on_commit=False)
        async with maker() as s:
            yield s

    app = create_app()
    app.dependency_overrides[get_session] = _session
    client = TestClient(app)

    # Ask with streaming so we don't drain the response body (would hit the
    # aiosqlite TestClient deadlock). All we want is "route resolved, the
    # 404 of a non-existent conversation surfaces as RUN_ERROR inside the
    # SSE body, not a pre-routing 404".
    with client.stream(
        "POST",
        "/api/conversations/conv-resume/resume",
        json={"resume_value": "approve"},
    ) as resp:
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/event-stream")
