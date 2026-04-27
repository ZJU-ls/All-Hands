"""Pin the contextvar contract that broke artifact-creation turns.

Symptom (2026-04-27): every long enough chat turn (chart / image / multi-
shape pptx · anything that streamed past a context switch) ended with:

  ValueError: <Token var=<ContextVar name='allhands_parent_conversation_id'
  default=None at 0x...> at 0x...> was created in a different Context

The user-facing message swapped the body for "上游拒绝", masking the real
root cause behind a misleading "API key 没配" hint.

Root cause: `chat_service.send_message` is an async generator. The
caller (chat router's SSE encoder) wraps each `__anext__()` in
`asyncio.create_task(...)` so it can race against a heartbeat timer.
Each Task runs the resumed generator body in a fresh, COPIED context.
Token-based `reset()` raises when called from a context different from
the one where `set()` ran · which is exactly what happens in the
generator's `finally`.

Fix: skip the token machinery. Save the prior value with `.get()`,
restore with `.set()` in finally. The crash goes away.

(Cross-task value propagation is a separate, pre-existing limitation
of contextvars + multi-task generator advancement; not in scope here.)

These tests pin two things:
1. Token-based reset crashes under cross-task advancement (proves the
   failure mode is real · regression-only).
2. Save/restore does NOT crash · the user-facing 「上游拒绝」 banner is
   gone.
3. Static guard: chat_service.send_message must keep using save/
   restore, never revert to tokens.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextvars import ContextVar

import pytest

# Stand-in ContextVar so we don't need the real chat_service · contract is
# identical to `_parent_conversation_id`.
_demo_var: ContextVar[str | None] = ContextVar("test_demo_var", default=None)


async def _async_gen_save_restore(value: str) -> AsyncIterator[str]:
    """Mirrors the FIXED chat_service.send_message pattern: manual
    save/restore around the yielding loop · no token."""
    prev = _demo_var.get()
    _demo_var.set(value)
    try:
        for i in range(3):
            await asyncio.sleep(0)
            yield f"v={_demo_var.get()} i={i}"
    finally:
        _demo_var.set(prev)


async def _async_gen_token_based(value: str) -> AsyncIterator[str]:
    """Mirrors the BROKEN pattern: ContextVar.set() returns a token,
    finally calls reset(token). Triggers cross-context error when the
    generator is advanced from a different task — same shape as the SSE
    pump in production."""
    token = _demo_var.set(value)
    try:
        for i in range(3):
            await asyncio.sleep(0)
            yield f"v={_demo_var.get()} i={i}"
    finally:
        _demo_var.reset(token)  # raises ValueError if context switched


async def _drive_via_gather(gen: AsyncIterator[str]) -> list[str]:
    """Advance the async generator from inside `asyncio.gather`. Each
    `__anext__()` becomes its own Task with a freshly-copied context —
    same shape as the chat router wrapping `__anext__` in
    `asyncio.create_task` so it can race against a heartbeat timer."""
    results: list[str] = []
    while True:
        try:
            (val,) = await asyncio.gather(gen.__anext__())
        except StopAsyncIteration:
            break
        results.append(val)
    return results


@pytest.mark.asyncio
async def test_token_based_reset_raises_under_cross_task_advance() -> None:
    """The PRE-FIX failure mode reproduced. If this ever stops raising,
    Python's contextvar semantics relaxed and the workaround is no longer
    strictly necessary — but until that day, we keep the save/restore
    fix and pin the failure shape here."""
    gen = _async_gen_token_based("conv-xyz")
    with pytest.raises(ValueError, match="different Context"):
        await _drive_via_gather(gen)


@pytest.mark.asyncio
async def test_save_restore_does_not_raise_under_cross_task_advance() -> None:
    """The fix · the same gather-driven advance pattern that crashed
    the token version completes cleanly here. No exception, no banner,
    no 「上游拒绝」 surfacing to the user."""
    gen = _async_gen_save_restore("conv-abc")
    # The point of this test is "no exception" · we don't assert what
    # the cross-task tasks see (that's a separate contextvar limitation
    # of advancing async generators across tasks · not in scope of this
    # bug).
    results = await _drive_via_gather(gen)
    assert len(results) == 3


@pytest.mark.asyncio
async def test_save_restore_propagates_in_sequential_path() -> None:
    """When the generator is advanced from the SAME task throughout (the
    common case · single-consumer SSE encoder before heartbeat-task wrap),
    the var IS visible across yields. The save/restore pattern preserves
    that behaviour; it only loses the cross-task case (which the token
    version also lost · plus crashed)."""
    gen = _async_gen_save_restore("conv-direct")
    out: list[str] = []
    while True:
        try:
            out.append(await gen.__anext__())
        except StopAsyncIteration:
            break
    assert out == [
        "v=conv-direct i=0",
        "v=conv-direct i=1",
        "v=conv-direct i=2",
    ]
    # Restored to default after generator finishes.
    assert _demo_var.get() is None


@pytest.mark.asyncio
async def test_save_restore_preserves_pre_existing_outer_value() -> None:
    """If something upstream had already set the var, the restore must
    bring back THAT value — not None. Important when chat_service is
    nested under a parent-set context (e.g. tests that wrap calls)."""
    _demo_var.set("upstream-value")
    gen = _async_gen_save_restore("conv-def")
    # consume sequentially · cross-task case isn't relevant for this
    # invariant
    while True:
        try:
            await gen.__anext__()
        except StopAsyncIteration:
            break
    # Outer context keeps its value
    assert _demo_var.get() == "upstream-value"


def test_actual_chat_service_uses_save_restore_not_token() -> None:
    """Static guard. If a future refactor reintroduces the token-based
    pattern in chat_service.send_message, this catches it before the
    user sees 「上游拒绝」 again."""
    from pathlib import Path

    src = (
        Path(__file__).resolve().parents[2] / "src" / "allhands" / "services" / "chat_service.py"
    ).read_text(encoding="utf-8")
    # Token assignment is the smoking gun.
    assert "_conv_token = _parent_conversation_id.set(" not in src, (
        "chat_service.send_message reverted to token-based ContextVar "
        "pattern; this fails under SSE heartbeat / asyncio.wait task "
        "switches with the cross-context error."
    )
    # Save + restore must be present.
    assert "_conv_prev = _parent_conversation_id.get()" in src
    assert "_parent_conversation_id.set(_conv_prev)" in src
