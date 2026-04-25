"""Tracer protocol + lightweight self-instrumented impl.

Langfuse was removed in 2026-04-25. The platform self-instruments via the
``events`` table; ``Tracer`` is a thin context-manager facade for code that
historically wrapped operations in spans. The default impl is a no-op
(timing / errors are already captured by the chat service writing
``run.started`` / ``run.completed`` / ``run.failed`` events with duration).
A future impl could fan out to OpenTelemetry; the protocol stays stable.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Protocol


class Tracer(Protocol):
    @contextmanager
    def span(self, name: str, **attrs: object) -> Iterator[None]: ...

    def event(self, name: str, **attrs: object) -> None: ...


class _NoopTracer:
    @contextmanager
    def span(self, name: str, **attrs: object) -> Iterator[None]:
        yield

    def event(self, name: str, **attrs: object) -> None:
        return None


def get_tracer() -> Tracer:
    """Return the active tracer.

    Self-instrumented · the real telemetry is written to the local events
    table by chat_service / agent_loop. This shim exists so legacy call
    sites that already pass `with tracer.span(...)` keep compiling without
    a code change.
    """
    return _NoopTracer()
