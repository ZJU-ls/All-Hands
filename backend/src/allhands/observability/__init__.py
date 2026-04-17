"""Observability layer (L2). LangFuse tracing + structlog logging.

Kept as a thin package so execution/services can depend on an interface rather
than the concrete LangFuse SDK. Real wiring lands with the Agent Runner.
"""

from allhands.observability.tracing import Tracer, get_tracer

__all__ = ["Tracer", "get_tracer"]
