"""Embedding domain models · L4 core · pydantic only.

Cleanest separation from chat/image: the result is a vector (or batch of
vectors), not media bytes. Used by:
- RAG pipelines (vector search)
- Semantic dedup / clustering
- Tool routing (similarity matching)

Phase A ships only the request/result types · concrete adapters land
when the first feature needs vectors (likely with a Memory v2 phase).
"""

from __future__ import annotations

from pydantic import BaseModel, Field

MAX_BATCH = 256
MAX_INPUT_CHARS = 8192


class EmbeddingRequest(BaseModel):
    """Embed N strings · returns N vectors aligned by index."""

    inputs: list[str] = Field(..., min_length=1, max_length=MAX_BATCH)
    dimensions: int | None = Field(
        default=None,
        ge=64,
        le=4096,
        description="Optional truncation hint · None ⇒ provider default.",
    )

    model_config = {"frozen": True}


class EmbeddingResult(BaseModel):
    """Vectors aligned to inputs · provider id + model name kept for trace."""

    vectors: list[list[float]] = Field(min_length=1)
    duration_ms: int = Field(ge=0)
    cost_usd: float | None = Field(default=None, ge=0)
    model_used: str
    provider_id: str

    model_config = {"frozen": True}


__all__ = [
    "MAX_BATCH",
    "MAX_INPUT_CHARS",
    "EmbeddingRequest",
    "EmbeddingResult",
]
