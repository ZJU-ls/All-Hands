"""Embedder — turn text → vector via ModelGateway-equivalent endpoints.

Three providers ship in v0:

- ``mock:hash-<dim>``  — deterministic SHA-256 fold. Always available.
                          Used in tests, CI, and any workspace lacking
                          an API key. Unit tests rely on its determinism
                          for golden assertions.
- ``openai:<model>``    — OpenAI embeddings API (httpx). Requires
                          ALLHANDS_OPENAI_API_KEY. Default URL =
                          https://api.openai.com/v1/embeddings .
- ``bailian:<model>``   — DashScope OpenAI-compat endpoint. Requires
                          ALLHANDS_DASHSCOPE_API_KEY. Default URL =
                          https://dashscope.aliyuncs.com/compatible-mode
                          /v1/embeddings .

The embedder front-loads two protections:

1. ``EmbeddingCacheRepo`` (sha256(text||model_ref) → bytes) avoids
   recomputing identical strings — common when the same query gets
   tweaked or a doc has repeated boilerplate sections.
2. Batched HTTP calls with capped concurrency so we don't fan out
   thousands of tiny requests. Provider-side rate limits stay healthy.

Vectors are L2-normalized before persistence so retrieval can use the
dot product directly (cosine ↔ dot ↔ L2 ranking equivalence on unit
vectors — see vector.py docstring).
"""

from __future__ import annotations

import contextlib
import hashlib
import logging
import struct
from collections.abc import Awaitable, Callable, Iterator
from dataclasses import dataclass
from typing import TYPE_CHECKING

import httpx

from allhands.execution.knowledge.vector import Vector, normalize, pack_vector, unpack_vector

if TYPE_CHECKING:
    from allhands.persistence.knowledge_repos import SqlEmbeddingCacheRepo


_logger = logging.getLogger(__name__)


# ----------------------------------------------------------------------
# Provider-side adapters
# ----------------------------------------------------------------------


@dataclass(frozen=True)
class EmbeddingProvider:
    """How to call a particular `<provider>:<model>` ref."""

    name: str
    dim: int
    embed: Callable[[list[str]], Awaitable[list[Vector]]]


def _hash_embed(dim: int) -> Callable[[list[str]], Awaitable[list[Vector]]]:
    """Deterministic SHA-256 fold → ``dim``-d float vector in [-1, 1].

    Splits the digest into ``dim`` segments (cycles if dim > 32). Maps
    each byte to a signed value, normalizes, and returns. Fixed length
    digest means longer dims mean reused bytes — hash collision quality
    isn't the goal here, just stable embeddings for tests/dev.
    """

    async def _embed(texts: list[str]) -> list[Vector]:
        out: list[Vector] = []
        for t in texts:
            digest = hashlib.sha256(t.encode("utf-8")).digest()
            v: Vector = []
            for i in range(dim):
                b = digest[i % len(digest)]
                v.append((b - 128) / 128.0)
            out.append(normalize(v))
        return out

    return _embed


def _openai_compat_embed(
    base_url: str,
    api_key: str,
    model: str,
) -> Callable[[list[str]], Awaitable[list[Vector]]]:
    """OpenAI-compat embeddings endpoint adapter.

    Used for both ``openai:`` and ``bailian:`` (DashScope) refs since the
    DashScope compatible-mode URL implements the same JSON shape.
    """
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    async def _embed(texts: list[str]) -> list[Vector]:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(
                base_url,
                headers=headers,
                json={"model": model, "input": texts, "encoding_format": "float"},
            )
            r.raise_for_status()
            data = r.json()["data"]
        return [normalize(item["embedding"]) for item in data]

    return _embed


# ----------------------------------------------------------------------
# Embedder
# ----------------------------------------------------------------------


@dataclass(frozen=True)
class EmbedderConfig:
    batch_size: int = 64
    max_retries: int = 3
    base_backoff_seconds: float = 0.4


class Embedder:
    """Resolve a model_ref → provider, batch text → vectors, cache."""

    def __init__(
        self,
        model_ref: str,
        provider: EmbeddingProvider,
        cache_repo_factory: Callable[[], SqlEmbeddingCacheRepo] | None = None,
        config: EmbedderConfig | None = None,
    ) -> None:
        self.model_ref = model_ref
        self.provider = provider
        self.dim = provider.dim
        self._cache_factory = cache_repo_factory
        self.cfg = config or EmbedderConfig()

    async def embed_texts(self, texts: list[str]) -> list[Vector]:
        if not texts:
            return []

        # 1. Pull cached entries
        results: list[Vector | None] = [None] * len(texts)
        hashes = [_text_hash(t, self.model_ref) for t in texts]
        if self._cache_factory is not None:
            cache_repo = self._cache_factory()
            cached = await cache_repo.get_many(hashes)
            for i, h in enumerate(hashes):
                blob = cached.get(h)
                if blob is not None:
                    with contextlib.suppress(ValueError):
                        results[i] = unpack_vector(blob, self.dim)

        # 2. Compute the misses
        missing_idx = [i for i, r in enumerate(results) if r is None]
        if missing_idx:
            new_vectors = await self._embed_with_retry([texts[i] for i in missing_idx])
            new_entries: list[tuple[str, str, int, bytes]] = []
            for slot, vec in zip(missing_idx, new_vectors, strict=True):
                results[slot] = vec
                new_entries.append((hashes[slot], self.model_ref, self.dim, pack_vector(vec)))
            if self._cache_factory is not None:
                cache_repo = self._cache_factory()
                await cache_repo.put_many(new_entries)

        # mypy: at this point all slots are Vector
        return [r for r in results if r is not None]

    async def _embed_with_retry(self, texts: list[str]) -> list[Vector]:
        out: list[Vector] = []
        for batch in _chunks(texts, self.cfg.batch_size):
            attempts = 0
            while True:
                attempts += 1
                try:
                    out.extend(await self.provider.embed(batch))
                    break
                except Exception as exc:
                    if attempts >= self.cfg.max_retries:
                        raise
                    backoff = self.cfg.base_backoff_seconds * (2 ** (attempts - 1))
                    _logger.warning(
                        "embed batch failed (attempt %d/%d): %s — retrying in %.1fs",
                        attempts,
                        self.cfg.max_retries,
                        exc,
                        backoff,
                    )
                    import asyncio

                    await asyncio.sleep(backoff)
        return out


# ----------------------------------------------------------------------
# Resolver — model_ref → EmbeddingProvider
# ----------------------------------------------------------------------


def resolve_provider(
    model_ref: str, *, settings_lookup: Callable[[], object] | None = None
) -> EmbeddingProvider:
    settings: object
    """Parse a `<scheme>:<rest>` ref into an EmbeddingProvider.

    Supported schemes:

    - ``mock:hash-<dim>`` — synchronous, dependency-free
    - ``openai:<model>``  — needs settings.openai_api_key
    - ``bailian:<model>`` — needs settings.dashscope_api_key
    """
    scheme, _, rest = model_ref.partition(":")
    if scheme == "mock":
        # `hash-64` → 64
        if not rest.startswith("hash-"):
            raise ValueError(f"unsupported mock ref: {model_ref!r}")
        dim = int(rest.removeprefix("hash-"))
        return EmbeddingProvider(name=model_ref, dim=dim, embed=_hash_embed(dim))

    # Real providers: settings holds the API key.
    if settings_lookup is None:
        from allhands.config.settings import get_settings as _gs

        settings = _gs()
    else:
        settings = settings_lookup()

    if scheme == "openai":
        api_key = getattr(settings, "openai_api_key", None)
        if not api_key:
            raise ValueError("openai embedder requires ALLHANDS_OPENAI_API_KEY")
        base = (getattr(settings, "openai_base_url", None) or "https://api.openai.com/v1").rstrip(
            "/"
        )
        # OpenAI dim defaults
        dim = _OPENAI_DIMS.get(rest, 1536)
        return EmbeddingProvider(
            name=model_ref,
            dim=dim,
            embed=_openai_compat_embed(f"{base}/embeddings", api_key, rest),
        )

    if scheme == "bailian":
        api_key = getattr(settings, "dashscope_api_key", None)
        if not api_key:
            raise ValueError("bailian embedder requires ALLHANDS_DASHSCOPE_API_KEY")
        base = "https://dashscope.aliyuncs.com/compatible-mode/v1"
        dim = _BAILIAN_DIMS.get(rest, 1024)
        return EmbeddingProvider(
            name=model_ref,
            dim=dim,
            embed=_openai_compat_embed(f"{base}/embeddings", api_key, rest),
        )

    raise ValueError(f"unknown embedding model_ref scheme: {scheme!r}")


_OPENAI_DIMS: dict[str, int] = {
    "text-embedding-3-small": 1536,
    "text-embedding-3-large": 3072,
    "text-embedding-ada-002": 1536,
}

_BAILIAN_DIMS: dict[str, int] = {
    "text-embedding-v1": 1536,
    "text-embedding-v2": 1536,
    "text-embedding-v3": 1024,
    "text-embedding-v4": 1024,
}


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------


def _text_hash(text: str, model_ref: str) -> str:
    h = hashlib.sha256()
    h.update(model_ref.encode("utf-8"))
    h.update(b"\x00")
    h.update(text.encode("utf-8"))
    return h.hexdigest()


def _chunks(items: list[str], n: int) -> Iterator[list[str]]:
    for i in range(0, len(items), n):
        yield items[i : i + n]


# Re-export to keep struct stable for tests that mock the embedder.
__all__ = [
    "Embedder",
    "EmbedderConfig",
    "EmbeddingProvider",
    "resolve_provider",
    "struct",
]
