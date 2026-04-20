"""Client-disconnect → agent-cancel wiring for POST /api/conversations/{id}/messages.

I-0015 / I-0016: the Composer's single send/stop button aborts the fetch
when the user clicks while streaming. Starlette surfaces this as a
`http.disconnect` receive frame. `routers/chat.py::send_message` polls
`request.is_disconnected()` between events and closes the underlying
async generator; this test proves the generator is actually closed (i.e.
the agent loop does not keep running after disconnect).

We test the async generator returned by `event_stream()` directly with a
fake Request whose `is_disconnected()` flips to True after the first
token is consumed. This avoids the sync TestClient + SSE cancellation
edge cases (the sync client doesn't reliably push `http.disconnect` into
the ASGI receive queue mid-stream).
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

import pytest

from allhands.api.routers import chat as chat_router
from allhands.execution.events import TokenEvent


class CancelTrackingChatService:
    """Stub ChatService whose stream blocks between tokens and records aclose()."""

    def __init__(self) -> None:
        self.closed = asyncio.Event()
        self.cancelled = asyncio.Event()
        self.tokens_emitted = 0

    async def send_message(
        self,
        conversation_id: str,
        user_content: str,
        overrides: object | None = None,
    ) -> AsyncIterator[TokenEvent]:
        async def gen() -> AsyncIterator[TokenEvent]:
            try:
                # Emit one token fast so the client sees "streaming has started"
                # and then block on each subsequent iteration. The disconnect
                # check has to fire between iterations.
                self.tokens_emitted += 1
                yield TokenEvent(message_id="msg_stub", delta="hello ")
                while True:
                    await asyncio.sleep(0.05)
                    self.tokens_emitted += 1
                    yield TokenEvent(message_id="msg_stub", delta=".")
            except (asyncio.CancelledError, GeneratorExit):
                self.cancelled.set()
                raise
            finally:
                self.closed.set()

        return gen()


class FakeRequest:
    """Minimal Request-like object exposing `is_disconnected`."""

    def __init__(self) -> None:
        self._disconnected = False

    def disconnect(self) -> None:
        self._disconnected = True

    async def is_disconnected(self) -> bool:
        return self._disconnected


@pytest.mark.asyncio
async def test_event_stream_closes_agent_on_disconnect(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Disconnect mid-stream → router breaks the loop and `aclose()`s the agent gen."""

    svc = CancelTrackingChatService()

    async def _svc(_session: object) -> CancelTrackingChatService:
        return svc

    monkeypatch.setattr(chat_router, "get_chat_service", _svc)

    request = FakeRequest()

    # Invoke the underlying handler without the FastAPI machinery so we
    # can drive the generator ourselves. `send_message` returns a
    # StreamingResponse whose body iterator IS our event_stream().
    response = await chat_router.send_message(
        conversation_id="c1",
        body=chat_router.SendMessageRequest(content="hi"),
        request=request,  # type: ignore[arg-type]
        session=None,  # type: ignore[arg-type]
    )
    body_iter = response.body_iterator  # type: ignore[attr-defined]

    # First frame: RUN_STARTED opens the AG-UI v1 envelope (I-0017).
    run_started = await body_iter.__anext__()
    assert b"event: RUN_STARTED" in run_started
    # Next frame: the first AG-UI token lands as TEXT_MESSAGE_START.
    text_start = await body_iter.__anext__()
    assert b"event: TEXT_MESSAGE_START" in text_start
    assert not svc.closed.is_set()

    # Client disconnects. Router polls between events so the next
    # iteration must observe the flag and break out of the loop.
    request.disconnect()

    # The loop may yield one more buffered token before polling; drain
    # until the iterator ends.
    try:
        while True:
            await asyncio.wait_for(body_iter.__anext__(), timeout=2.0)
    except StopAsyncIteration:
        pass

    assert svc.closed.is_set(), "router did not aclose() the agent stream after disconnect"
