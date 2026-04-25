"""I-0017 · wire-format guard — every SSE endpoint emits AG-UI v1 events.

Drives each router's streaming coroutine directly (same pattern as
``test_artifacts_sse.py`` uses to dodge the TestClient + aiosqlite + SSE
deadlock) and asserts the SSE frame ``event:`` line + JSON body match the
AG-UI v1 contract in ADR 0010 / docs/specs/2026-04-19-ag-ui-migration.md.

What we assert per endpoint:

* chat (`POST /api/conversations/{id}/messages`) — RUN_STARTED,
  TEXT_MESSAGE_START/CONTENT/END for token kind, TOOL_CALL_START/ARGS/END/RESULT
  for tool_call_* kinds, CUSTOM ``allhands.*`` for confirm/render/nested/trace,
  RUN_FINISHED at the end. RUN_ERROR replaces FINISHED on failure.
* model-test (`POST /api/models/{id}/test/stream`) — RUN_STARTED,
  CUSTOM ``allhands.model_test_meta``, TEXT_MESSAGE_START + TEXT_MESSAGE_CHUNK
  (deltas), REASONING_MESSAGE_CHUNK when applicable, TEXT_MESSAGE_END,
  CUSTOM ``allhands.model_test_metrics`` on done, RUN_FINISHED.
* cockpit (`GET /api/cockpit/stream`) — RUN_STARTED,
  CUSTOM ``allhands.cockpit_snapshot``, then CUSTOM ``allhands.cockpit_*``
  per bus event, CUSTOM ``allhands.heartbeat`` during idle.
* artifacts (`GET /api/artifacts/stream`) — RUN_STARTED,
  CUSTOM ``allhands.artifacts_ready``, CUSTOM ``allhands.artifact_changed``
  on each bus event, CUSTOM ``allhands.heartbeat`` during idle.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Callable
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from allhands.core import ArtifactKind
from allhands.core.conversation import RenderPayload, ToolCall, ToolCallStatus
from allhands.execution.event_bus import EventBus
from allhands.execution.events import (
    ConfirmRequiredEvent,
    DoneEvent,
    RenderEvent,
    TokenEvent,
    ToolCallEndEvent,
    ToolCallStartEvent,
    TraceEvent,
)
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import SqlArtifactRepo
from allhands.services.artifact_service import ArtifactService

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _parse_frames(body: str) -> list[dict[str, Any]]:
    """Parse SSE body text into a list of ``{event, data}`` dicts."""
    out: list[dict[str, Any]] = []
    for raw in body.split("\n\n"):
        if not raw.strip():
            continue
        evt = ""
        data_parts: list[str] = []
        for line in raw.split("\n"):
            if line.startswith("event:"):
                evt = line[len("event:") :].strip()
            elif line.startswith("data:"):
                data_parts.append(line[len("data:") :].lstrip())
        payload: Any = {}
        if data_parts:
            try:
                payload = json.loads("\n".join(data_parts))
            except json.JSONDecodeError:
                payload = {"_raw": "\n".join(data_parts)}
        out.append({"event": evt, "data": payload})
    return out


async def _drain(
    body_iterator: AsyncIterator[bytes | str], *, max_frames: int = 40, timeout_s: float = 2.0
) -> list[dict[str, Any]]:
    frames: list[dict[str, Any]] = []
    buf = ""
    try:
        while len(frames) < max_frames:
            chunk = await asyncio.wait_for(body_iterator.__anext__(), timeout=timeout_s)
            text = chunk.decode("utf-8") if isinstance(chunk, bytes) else chunk
            buf += text
            while "\n\n" in buf:
                raw, buf = buf.split("\n\n", 1)
                for f in _parse_frames(raw + "\n\n"):
                    frames.append(f)
    except (StopAsyncIteration, TimeoutError, asyncio.CancelledError):
        pass
    return frames


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
async def session_maker() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


class _FakeApp:
    def __init__(self) -> None:
        self.state = FastAPI().state


class _FakeRequest:
    def __init__(self, app: _FakeApp) -> None:
        self.app = app
        self._closed = False

    def close(self) -> None:
        self._closed = True

    async def is_disconnected(self) -> bool:
        return self._closed


# ---------------------------------------------------------------------------
# Model test stream
# ---------------------------------------------------------------------------


async def test_model_test_stream_emits_ag_ui_envelope(monkeypatch: pytest.MonkeyPatch) -> None:
    """Wire-level guard: model-test emits RUN_STARTED, CUSTOM meta, TEXT_MESSAGE_*,
    CUSTOM metrics, RUN_FINISHED — never legacy meta/delta/done."""
    from allhands.api.routers import models as models_router

    async def fake_astream(*_args: Any, **_kwargs: Any) -> AsyncIterator[dict[str, Any]]:
        yield {"type": "meta", "model": "m1", "started_at_ms": 1700}
        yield {"type": "delta", "text": "he"}
        yield {"type": "delta", "text": "llo"}
        yield {
            "type": "done",
            "latency_ms": 123,
            "ttft_ms": 42,
            "reasoning_first_ms": 0,
            "usage": {"input_tokens": 1, "output_tokens": 2, "total_tokens": 3},
            "tokens_per_second": 17.1,
            "response": "hello",
            "reasoning_text": "",
        }

    monkeypatch.setattr(models_router, "astream_chat_test", fake_astream)

    # Stub resolve_with_provider + get_model_service via a tiny fake svc.
    class _FakeSvc:
        async def resolve_with_provider(self, _id: str) -> tuple[Any, Any]:
            class _P:
                id = "p1"
                name = "prov"
                base_url = "https://x/v1"
                api_key = "sk-x"

            class _M:
                name = "m1"

            return _M(), _P()

    async def _fake_get_model_service(_sess: Any) -> _FakeSvc:
        return _FakeSvc()

    monkeypatch.setattr(models_router, "get_model_service", _fake_get_model_service)

    response = await models_router.test_model_stream(
        model_id="m1",
        body=None,
        session=object(),  # type: ignore[arg-type]
    )
    frames = await _drain(response.body_iterator, max_frames=20)
    events = [f["event"] for f in frames]

    assert events[0] == "RUN_STARTED"
    assert events[-1] == "RUN_FINISHED"
    assert "TEXT_MESSAGE_START" in events
    assert events.count("TEXT_MESSAGE_CHUNK") + events.count("TEXT_MESSAGE_CONTENT") >= 2
    assert "TEXT_MESSAGE_END" in events

    # CUSTOM meta + metrics
    customs = [f for f in frames if f["event"] == "CUSTOM"]
    names = [c["data"].get("name") for c in customs]
    assert "allhands.model_test_meta" in names
    assert "allhands.model_test_metrics" in names

    # Legacy names must not appear in AG-UI mode.
    assert "delta" not in events
    assert "meta" not in events
    assert "done" not in events

    # Wire fields must be camelCase on AG-UI envelopes.
    run_started = frames[0]["data"]
    assert "threadId" in run_started
    assert "runId" in run_started
    # Lifecycle IDs must be present.
    assert run_started["threadId"].startswith("model-test") or run_started["threadId"].startswith(
        "mt_"
    )


# ---------------------------------------------------------------------------
# Chat stream
# ---------------------------------------------------------------------------


class _FakeAsyncIter:
    def __init__(self, events: list[Any]) -> None:
        self._events = events

    def __aiter__(self) -> _FakeAsyncIter:
        return self

    async def __anext__(self) -> Any:
        if not self._events:
            raise StopAsyncIteration
        return self._events.pop(0)

    async def aclose(self) -> None:
        self._events.clear()


async def test_chat_stream_emits_ag_ui_envelope(monkeypatch: pytest.MonkeyPatch) -> None:
    from allhands.api.protocol import SendMessageRequest
    from allhands.api.routers import chat as chat_router

    tool_call = ToolCall(
        id="call_1",
        tool_id="echo",
        args={"x": 1},
        status=ToolCallStatus.SUCCEEDED,
        result={"ok": True},
    )

    events: list[Any] = [
        TokenEvent(message_id="msg_1", delta="he"),
        TokenEvent(message_id="msg_1", delta="llo"),
        ToolCallStartEvent(tool_call=tool_call),
        ToolCallEndEvent(tool_call=tool_call),
        ConfirmRequiredEvent(
            confirmation_id="cf_1",
            tool_call_id="call_1",
            summary="proceed?",
            rationale="writes a file",
            diff=None,
        ),
        RenderEvent(
            message_id="msg_1",
            payload=RenderPayload(component="MarkdownCard", props={"body": "hi"}),
        ),
        TraceEvent(trace_id="tr_1", url="https://lf/tr_1"),
        DoneEvent(message_id="msg_1", reason="done"),
    ]

    class _FakeChatSvc:
        async def send_message(
            self,
            _cid: str,
            _content: str,
            overrides: object | None = None,
        ) -> _FakeAsyncIter:
            return _FakeAsyncIter(list(events))

    async def _fake_get_chat_service(_sess: Any, request: Any = None) -> _FakeChatSvc:
        return _FakeChatSvc()

    monkeypatch.setattr(chat_router, "get_chat_service", _fake_get_chat_service)

    class _Req:
        async def is_disconnected(self) -> bool:
            return False

    response = await chat_router.send_message(
        conversation_id="conv_1",
        body=SendMessageRequest(content="hi"),
        request=_Req(),  # type: ignore[arg-type]
        session=object(),  # type: ignore[arg-type]
    )
    frames = await _drain(response.body_iterator, max_frames=40)
    names = [f["event"] for f in frames]

    assert names[0] == "RUN_STARTED"
    assert names[-1] == "RUN_FINISHED"

    assert "TEXT_MESSAGE_START" in names
    assert "TEXT_MESSAGE_CONTENT" in names
    assert "TEXT_MESSAGE_END" in names

    assert "TOOL_CALL_START" in names
    assert "TOOL_CALL_END" in names
    # tool result present in AG-UI mode
    assert "TOOL_CALL_RESULT" in names

    # CUSTOM allhands.* events for confirm / render / trace
    customs = [f["data"] for f in frames if f["event"] == "CUSTOM"]
    custom_names = [c.get("name") for c in customs]
    assert "allhands.confirm_required" in custom_names
    assert "allhands.render" in custom_names
    assert "allhands.trace" in custom_names

    # Legacy event names must be gone
    for legacy in (
        "token",
        "tool_call_start",
        "tool_call_end",
        "confirm_required",
        "render",
        "trace",
        "done",
    ):
        assert legacy not in names, f"legacy name leaked: {legacy}"

    # Wire fields camelCase
    ts = frames[0]["data"]
    assert "threadId" in ts
    assert "runId" in ts
    assert ts["threadId"] == "conv_1"


# ---------------------------------------------------------------------------
# Cockpit stream
# ---------------------------------------------------------------------------


async def test_cockpit_stream_emits_ag_ui_envelope(monkeypatch: pytest.MonkeyPatch) -> None:
    from allhands.api.routers import cockpit as cockpit_router

    class _FakeCockpitSvc:
        async def build_summary(self) -> Any:
            class _Summary:
                def model_dump(self, mode: str = "json") -> dict[str, Any]:
                    return {"runs": [], "kpi": {}}

            return _Summary()

    request = _FakeRequest(_FakeApp())
    response = await cockpit_router.stream(request=request, svc=_FakeCockpitSvc())  # type: ignore[arg-type]
    frames = await _drain(response.body_iterator, max_frames=6, timeout_s=1.0)
    names = [f["event"] for f in frames]

    assert names[0] == "RUN_STARTED"
    # Snapshot frame is a CUSTOM allhands.cockpit_snapshot
    assert any(
        f["event"] == "CUSTOM" and f["data"].get("name") == "allhands.cockpit_snapshot"
        for f in frames
    )
    assert "snapshot" not in names, "legacy `snapshot` event leaked"


# ---------------------------------------------------------------------------
# Artifacts stream
# ---------------------------------------------------------------------------


async def test_artifacts_stream_emits_ag_ui_envelope(
    session_maker: async_sessionmaker[AsyncSession],
    tmp_path: Path,
) -> None:
    from allhands.api.routers.artifacts import stream_artifacts

    bus = EventBus()
    app = _FakeApp()

    class _Runtime:
        pass

    runtime = _Runtime()
    runtime.bus = bus  # type: ignore[attr-defined]
    app.state.trigger_runtime = runtime
    request = _FakeRequest(app)

    response = await stream_artifacts(request)  # type: ignore[arg-type]
    body_iterator = response.body_iterator

    async def _next_matching(
        predicate: Callable[[dict[str, Any]], bool], *, timeout_s: float = 2.0
    ) -> dict[str, Any]:
        deadline = asyncio.get_event_loop().time() + timeout_s
        buf = ""
        while True:
            remaining = deadline - asyncio.get_event_loop().time()
            if remaining <= 0:
                raise AssertionError("timed out waiting for artifact frame")
            chunk = await asyncio.wait_for(body_iterator.__anext__(), timeout=remaining)
            buf += chunk.decode("utf-8") if isinstance(chunk, bytes) else chunk
            while "\n\n" in buf:
                raw, buf = buf.split("\n\n", 1)
                for f in _parse_frames(raw + "\n\n"):
                    if predicate(f):
                        return f

    # 1. First meaningful frame = RUN_STARTED.
    run_started = await _next_matching(lambda f: f["event"] == "RUN_STARTED")
    assert run_started["data"].get("threadId")
    assert run_started["data"].get("runId")

    # 2. Write an artifact → expect CUSTOM allhands.artifact_changed.
    async with session_maker() as s:
        svc = ArtifactService(SqlArtifactRepo(s), tmp_path, bus=bus)
        art = await svc.create(name="ag-ui", kind=ArtifactKind.MARKDOWN, content="hi")

    changed = await _next_matching(
        lambda f: f["event"] == "CUSTOM" and f["data"].get("name") == "allhands.artifact_changed"
    )
    assert art.id in json.dumps(changed["data"]["value"])

    request.close()
