"""Client-disconnect behaviour for POST /api/conversations/{id}/messages.

2026-04-28 inverted the historical contract: when the SSE client
disconnects, the agent task DOES NOT stop. The new ``stream_broker``
infrastructure (see ``execution/stream_broker.py``) decouples the agent
producer from the SSE consumer. A user that tabs away or refreshes can
re-attach via ``POST /runs/{id}/subscribe`` and pick up where they
left off — clicking a trace chip no longer kills spawn_subagent runs.

This test pins the new contract: disconnect → SSE response loop ends,
broker subscriber count drops to zero, but the underlying generator
keeps producing until *we* explicitly tear down the broker. The legacy
"router aclose()s the agent stream on disconnect" expectation is gone.

We drive the handler directly with a fake Request whose
``is_disconnected()`` flips after the first token, same as before.
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
        attachment_ids: object | None = None,
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
async def test_disconnect_keeps_broker_alive_for_resubscribe(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Disconnect mid-stream → SSE encoder exits but broker task lives on."""
    from allhands.execution.stream_broker import (
        get_broker_registry,
        reset_broker_registry_for_tests,
    )

    reset_broker_registry_for_tests()
    try:
        svc = CancelTrackingChatService()

        async def _svc(
            _session: object,
            request: object = None,
        ) -> CancelTrackingChatService:
            return svc

        monkeypatch.setattr(chat_router, "get_chat_service", _svc)

        request = FakeRequest()

        response = await chat_router.send_message(
            conversation_id="c1",
            body=chat_router.SendMessageRequest(content="hi"),
            request=request,  # type: ignore[arg-type]
            session=None,  # type: ignore[arg-type]
        )
        body_iter = response.body_iterator  # type: ignore[attr-defined]

        # RUN_STARTED → first token chunk lands.
        run_started = await body_iter.__anext__()
        assert b"event: RUN_STARTED" in run_started
        text_start = await body_iter.__anext__()
        assert b"event: TEXT_MESSAGE_START" in text_start

        # Client disconnects. The encoder exits its loop on the next poll.
        request.disconnect()
        try:
            while True:
                await asyncio.wait_for(body_iter.__anext__(), timeout=2.0)
        except StopAsyncIteration:
            pass

        # The agent stream must NOT have been closed by the disconnect
        # alone — broker contract. Give the producer a moment to keep
        # spinning; if it had been cancelled we'd see closed.is_set()
        # immediately.
        await asyncio.sleep(0.15)
        assert not svc.closed.is_set(), (
            "agent stream was closed on client disconnect — broker must keep "
            "the run alive for resubscribe"
        )

        # Active run is still queryable from the registry — that's how the
        # frontend will spot it on chat-page remount.
        active = get_broker_registry().active_run_for_conversation("c1")
        assert active is not None

        # Tear down explicitly so the test process doesn't leak the task.
        broker = get_broker_registry().get(active)
        assert broker is not None
        if broker._task is not None:
            broker._task.cancel()
            with pytest.raises((asyncio.CancelledError, BaseException)):
                await broker._task
    finally:
        reset_broker_registry_for_tests()
