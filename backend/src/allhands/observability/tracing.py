"""Tracer protocol + LangFuse impl that activates when keys are configured."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any, Protocol

from allhands.config import get_settings


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


class _LangFuseTracer:
    def __init__(self) -> None:
        from langfuse import Langfuse

        settings = get_settings()
        self._client: Any = Langfuse(
            public_key=settings.langfuse_public_key,
            secret_key=settings.langfuse_secret_key,
            host=settings.langfuse_host,
        )

    @contextmanager
    def span(self, name: str, **attrs: object) -> Iterator[None]:
        trace = self._client.trace(name=name, metadata=attrs)
        try:
            yield
        finally:
            trace.update(status_message="done")

    def event(self, name: str, **attrs: object) -> None:
        self._client.event(name=name, metadata=attrs)


def get_tracer() -> Tracer:
    settings = get_settings()
    if settings.langfuse_public_key and settings.langfuse_secret_key:
        try:
            return _LangFuseTracer()
        except Exception:
            pass
    return _NoopTracer()


def get_langfuse_callback_handler() -> object | None:
    """Return LangFuse CallbackHandler for LangGraph, or None."""
    settings = get_settings()
    if not (settings.langfuse_public_key and settings.langfuse_secret_key):
        return None
    try:
        from langfuse.callback import CallbackHandler

        handler: object = CallbackHandler(
            public_key=settings.langfuse_public_key,
            secret_key=settings.langfuse_secret_key,
            host=settings.langfuse_host,
        )
        return handler
    except Exception:
        return None
