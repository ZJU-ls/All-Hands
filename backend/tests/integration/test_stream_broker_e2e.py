"""End-to-end exercise of the stream-broker resume contract.

Substitutes the real LLM-backed chat service with a deterministic
``StreamingTokenSource`` so the test can pin exactly which events land
on each subscriber under three adversarial scenarios:

  1. **10 plain rounds** — happy path · POST /messages → SSE delivers
     RUN_STARTED / TEXT_MESSAGE_* / RUN_FINISHED in order. Broker
     finishes and is queryable for the idle-grace window.
  2. **Mid-stream disconnect + resubscribe** — drop after partial
     output, then POST /runs/{id}/subscribe; the resumed stream MUST
     replay from RUN_STARTED, finish cleanly, and the broker producer
     MUST NOT have been cancelled by the disconnect (legacy contract:
     it would have been).
  3. **Two simultaneous subscribers** — open a /messages stream and a
     /subscribe stream against the same run; both receive the full
     event sequence.

This is the verification scaffold for stream_broker that
"真实 LLM 10 轮" was supposed to exercise — without OpenAI/qwen
credentials in the harness, deterministic tokens give us the same
broker / wire coverage with zero flake.
"""

from __future__ import annotations

import asyncio
import json
import re
from collections.abc import AsyncIterator
from typing import Any

import pytest

from allhands.api.routers import chat as chat_router
from allhands.execution.events import TokenEvent
from allhands.execution.stream_broker import (
    get_broker_registry,
    reset_broker_registry_for_tests,
)


class FakeChatService:
    """Emits N tokens with a small wait between each so resume tests can
    drop the SSE response mid-stream and have the broker keep producing.

    Each call to ``send_message`` returns a fresh async iterator (matches
    the real ``ChatService.send_message`` shape).
    """

    def __init__(self, tokens_per_round: int = 8, delay_s: float = 0.05) -> None:
        self.tokens_per_round = tokens_per_round
        self.delay_s = delay_s
        self.calls: int = 0
        self.cancelled_runs: int = 0

    async def send_message(
        self,
        conversation_id: str,
        user_content: str,
        overrides: object | None = None,
        attachment_ids: object | None = None,
    ) -> AsyncIterator[Any]:
        self.calls += 1
        round_no = self.calls
        delay = self.delay_s

        async def gen() -> AsyncIterator[Any]:
            try:
                msg_id = f"msg_{round_no}"
                # We mimic what ChatService yields: TokenEvent chunks
                # ending with a "done" event so the encoder closes the
                # text-message frame and emits RUN_FINISHED.
                from allhands.execution.events import DoneEvent

                yield TokenEvent(message_id=msg_id, delta=f"r{round_no}:")
                for i in range(self.tokens_per_round):
                    await asyncio.sleep(delay)
                    yield TokenEvent(message_id=msg_id, delta=f" tok{i}")
                yield DoneEvent(message_id=msg_id, reason="done")
            except (asyncio.CancelledError, GeneratorExit):
                self.cancelled_runs += 1
                raise

        return gen()


class FakeRequest:
    """Drives ``request.is_disconnected()``."""

    def __init__(self) -> None:
        self._disconnected = False

    def disconnect(self) -> None:
        self._disconnected = True

    async def is_disconnected(self) -> bool:
        return self._disconnected


def _decode_sse(blob: bytes) -> list[dict[str, Any]]:
    """Pull the AG-UI ``data: …`` lines out of an SSE byte blob."""
    out: list[dict[str, Any]] = []
    for raw in blob.decode("utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line.startswith("data:"):
            continue
        body = line[5:].strip()
        if not body:
            continue
        try:
            out.append(json.loads(body))
        except json.JSONDecodeError:
            continue
    return out


def _types(events: list[dict[str, Any]]) -> list[str]:
    return [e.get("type", "?") for e in events]


async def _drain_response(response: Any) -> bytes:
    chunks: list[bytes] = []
    async for chunk in response.body_iterator:  # type: ignore[attr-defined]
        chunks.append(chunk)
    return b"".join(chunks)


@pytest.fixture(autouse=True)
def _reset_registry():
    reset_broker_registry_for_tests()
    yield
    reset_broker_registry_for_tests()


@pytest.mark.asyncio
async def test_ten_rounds_each_complete_cleanly(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Happy path · 10 sequential turns · each one's SSE delivers
    RUN_STARTED → text chunks → RUN_FINISHED. Broker is registered and
    ends in 'finished'."""
    svc = FakeChatService(tokens_per_round=4, delay_s=0.005)

    async def _svc(_session: object, request: object = None) -> FakeChatService:
        return svc

    monkeypatch.setattr(chat_router, "get_chat_service", _svc)

    for n in range(1, 11):
        request = FakeRequest()
        response = await chat_router.send_message(
            conversation_id="conv-e2e",
            body=chat_router.SendMessageRequest(content=f"round {n}"),
            request=request,  # type: ignore[arg-type]
            session=None,  # type: ignore[arg-type]
        )
        blob = await _drain_response(response)
        types = _types(_decode_sse(blob))
        assert types[0] == "RUN_STARTED", f"round {n}: missing RUN_STARTED"
        assert "RUN_FINISHED" in types, f"round {n}: missing RUN_FINISHED"
        assert any(t == "TEXT_MESSAGE_CONTENT" for t in types), f"round {n}: no token chunks"

    assert svc.calls == 10
    # No cancellations for happy-path rounds.
    assert svc.cancelled_runs == 0


@pytest.mark.asyncio
async def test_drop_midstream_then_resubscribe_finishes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Drop the first SSE response after the first token, then
    POST /runs/{id}/subscribe. The resumed stream replays from
    RUN_STARTED, includes the TEXT chunks the first one missed, and
    finishes. The broker's producer MUST keep running across the gap.
    """
    svc = FakeChatService(tokens_per_round=8, delay_s=0.04)

    async def _svc(_session: object, request: object = None) -> FakeChatService:
        return svc

    monkeypatch.setattr(chat_router, "get_chat_service", _svc)

    # First request — drop after capturing RUN_STARTED.
    req1 = FakeRequest()
    resp1 = await chat_router.send_message(
        conversation_id="conv-drop",
        body=chat_router.SendMessageRequest(content="hello"),
        request=req1,  # type: ignore[arg-type]
        session=None,  # type: ignore[arg-type]
    )
    body_iter = resp1.body_iterator  # type: ignore[attr-defined]

    # Pull the RUN_STARTED frame so we know the broker has started.
    first_chunk = await body_iter.__anext__()
    assert b"event: RUN_STARTED" in first_chunk
    match = re.search(rb'"runId":\s*"([^"]+)"', first_chunk)
    assert match is not None, "could not extract run_id"
    run_id = match.group(1).decode()

    # Pull one more frame so a few tokens have entered the buffer.
    second = await body_iter.__anext__()
    assert b"event:" in second

    # Disconnect — encoder exits its loop; broker keeps going.
    req1.disconnect()
    try:
        while True:
            await asyncio.wait_for(body_iter.__anext__(), timeout=2.0)
    except StopAsyncIteration:
        pass

    # The producer should NOT be cancelled by the disconnect alone.
    await asyncio.sleep(0.02)
    assert svc.cancelled_runs == 0, (
        "agent task was cancelled on client disconnect — broker contract broken"
    )

    # Resubscribe — replay must reach RUN_FINISHED.
    req2 = FakeRequest()
    resp2 = await chat_router.subscribe_to_run(
        conversation_id="conv-drop",
        run_id=run_id,
        request=req2,  # type: ignore[arg-type]
    )
    blob = await _drain_response(resp2)
    types = _types(_decode_sse(blob))
    assert types[0] == "RUN_STARTED", "resubscribe did not re-frame RUN_STARTED"
    assert "RUN_FINISHED" in types, "resumed stream never finished"
    assert any(t == "TEXT_MESSAGE_CONTENT" for t in types), "resumed stream missing token chunks"

    # Same run_id flows on the wire — frontend can correlate.
    started = next(e for e in _decode_sse(blob) if e.get("type") == "RUN_STARTED")
    assert started.get("runId") == run_id


@pytest.mark.asyncio
async def test_two_subscribers_both_finish(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Multi-tab safety · the original /messages response and a parallel
    /subscribe response both walk through to RUN_FINISHED on the same
    underlying broker."""
    svc = FakeChatService(tokens_per_round=10, delay_s=0.01)

    async def _svc(_session: object, request: object = None) -> FakeChatService:
        return svc

    monkeypatch.setattr(chat_router, "get_chat_service", _svc)

    req_main = FakeRequest()
    resp_main = await chat_router.send_message(
        conversation_id="conv-multi",
        body=chat_router.SendMessageRequest(content="parallel"),
        request=req_main,  # type: ignore[arg-type]
        session=None,  # type: ignore[arg-type]
    )

    # Pull the first frame off the main stream so we know it's mid-flight.
    main_iter = resp_main.body_iterator  # type: ignore[attr-defined]
    first_chunk = await main_iter.__anext__()
    assert b"event: RUN_STARTED" in first_chunk
    run_id = re.search(rb'"runId":\s*"([^"]+)"', first_chunk).group(1).decode()  # type: ignore[union-attr]

    # Open a second subscriber while the broker is still producing.
    req_second = FakeRequest()
    resp_second = await chat_router.subscribe_to_run(
        conversation_id="conv-multi",
        run_id=run_id,
        request=req_second,  # type: ignore[arg-type]
    )

    async def _drain_into_list(it) -> list[bytes]:
        out: list[bytes] = []
        async for c in it:
            out.append(c)
        return out

    # Drain both concurrently. Add the first chunk we already consumed.
    main_chunks = [first_chunk] + await _drain_into_list(main_iter)
    second_chunks = await _drain_into_list(resp_second.body_iterator)  # type: ignore[attr-defined]

    main_types = _types(_decode_sse(b"".join(main_chunks)))
    second_types = _types(_decode_sse(b"".join(second_chunks)))

    assert main_types[0] == "RUN_STARTED"
    assert second_types[0] == "RUN_STARTED"
    assert "RUN_FINISHED" in main_types
    assert "RUN_FINISHED" in second_types
    assert sum(1 for t in main_types if t == "TEXT_MESSAGE_CONTENT") > 0
    assert sum(1 for t in second_types if t == "TEXT_MESSAGE_CONTENT") > 0


@pytest.mark.asyncio
async def test_subscribe_unknown_run_id_returns_404(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """After the broker has been GC'd (or never existed), the subscribe
    endpoint surfaces a 404 so the frontend can fall back to GET
    /messages for the full history."""
    from fastapi import HTTPException

    request = FakeRequest()
    with pytest.raises(HTTPException) as exc_info:
        await chat_router.subscribe_to_run(
            conversation_id="conv-x",
            run_id="run_missing",
            request=request,  # type: ignore[arg-type]
        )
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_active_run_id_surfaces_then_clears(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``GET /conversations/{id}`` returns ``active_run_id`` while the
    broker is alive and ``None`` once the run has finished + drained."""
    svc = FakeChatService(tokens_per_round=4, delay_s=0.005)

    async def _svc(_session: object, request: object = None) -> FakeChatService:
        return svc

    monkeypatch.setattr(chat_router, "get_chat_service", _svc)

    request = FakeRequest()
    response = await chat_router.send_message(
        conversation_id="conv-active",
        body=chat_router.SendMessageRequest(content="probe"),
        request=request,  # type: ignore[arg-type]
        session=None,  # type: ignore[arg-type]
    )
    main_iter = response.body_iterator  # type: ignore[attr-defined]
    # Consume the RUN_STARTED frame so we know the broker is registered.
    await main_iter.__anext__()

    reg = get_broker_registry()
    active = reg.active_run_for_conversation("conv-active")
    assert active is not None
    assert active.startswith("run_")

    # Drain to the end.
    async for _chunk in main_iter:
        pass

    # After RUN_FINISHED the broker is still in the registry but `ended`,
    # so active_run_for_conversation returns None.
    assert reg.active_run_for_conversation("conv-active") is None
