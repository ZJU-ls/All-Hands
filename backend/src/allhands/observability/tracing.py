"""Tracer protocol + no-op default. LangFuse impl drops in behind the same shape."""

from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator, Protocol


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
    """Return a tracer. v0 ships the no-op; LangFuse impl swaps in via settings."""
    return _NoopTracer()
