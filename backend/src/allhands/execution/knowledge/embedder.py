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
from typing import TYPE_CHECKING, Any

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
    # Per-provider batch ceiling. Aliyun DashScope text-embedding-v3/v4 caps
    # batch at 10 (HTTP 400: "batch size is invalid, it should not be larger
    # than 10"). OpenAI's `text-embedding-3-*` allows >>64 but our writer
    # latency / retry backoff is happier at 64. None = use the global default.
    max_batch_size: int | None = None


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
            if r.status_code >= 400:
                # Surface the upstream body — dashscope / openai both return
                # `{"error": {"message": "..."}}` on 4xx, which is far more
                # actionable than a bare "Client error 400".
                detail = r.text[:500]
                raise httpx.HTTPStatusError(
                    f"{r.status_code} from {base_url}: {detail}",
                    request=r.request,
                    response=r,
                )
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
        # Provider-specific cap wins. Aliyun v3/v4 returns 400 above 10.
        effective_batch = (
            min(self.cfg.batch_size, self.provider.max_batch_size)
            if self.provider.max_batch_size is not None
            else self.cfg.batch_size
        )
        for batch in _chunks(texts, effective_batch):
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


@dataclass(frozen=True)
class _ProviderCreds:
    """What the resolver needs from a single LLMProvider DB row."""

    api_key: str
    base_url: str


@dataclass(frozen=True)
class CredsLookup:
    """Two-source credential resolver passed into ``resolve_provider``.

    Source 1 (preferred): the LLMProvider table — populated via the
    `/gateway` UI. Lets non-developers add an embedding-capable provider
    without editing .env. The lookup is keyed by `kind` (``openai`` /
    ``aliyun``) since `model_ref` already encodes it.

    Source 2 (fallback): env vars on `Settings`. Kept so dev / CI / docker
    images that pre-bake a key still work without touching the DB.
    """

    db_lookup: Callable[[str], _ProviderCreds | None] | None = None
    env_lookup: Callable[[], object] | None = None


def resolve_provider(
    model_ref: str,
    *,
    settings_lookup: Callable[[], object] | None = None,
    creds: CredsLookup | None = None,
) -> EmbeddingProvider:
    """Parse a ``<scheme>:<rest>`` ref into an EmbeddingProvider.

    Supported schemes:

    - ``mock:hash-<dim>``    — synchronous, no creds
    - ``openai:<model>``     — DB-configured OpenAI-kind provider, or
                               ``ALLHANDS_OPENAI_API_KEY`` fallback
    - ``aliyun:<model>``     — DB-configured aliyun-kind provider, or
                               ``ALLHANDS_DASHSCOPE_API_KEY`` fallback
    - ``bailian:<model>``    — alias for ``aliyun:`` (kept for back-compat)

    The two-source resolution lets the UI add a provider via /gateway
    without an .env edit, while keeping a key in env still works for
    docker / CI bootstrapping.
    """
    scheme, _, rest = model_ref.partition(":")
    if scheme == "mock":
        if not rest.startswith("hash-"):
            raise ValueError(f"unsupported mock ref: {model_ref!r}")
        dim = int(rest.removeprefix("hash-"))
        return EmbeddingProvider(name=model_ref, dim=dim, embed=_hash_embed(dim))

    if scheme not in {"openai", "aliyun", "bailian"}:
        raise ValueError(f"unknown embedding model_ref scheme: {scheme!r}")

    # Normalize bailian → aliyun for DB lookup (provider_presets uses aliyun)
    db_kind = "aliyun" if scheme in {"aliyun", "bailian"} else "openai"
    creds = creds or CredsLookup()
    found: _ProviderCreds | None = None

    # Source 1: DB
    if creds.db_lookup is not None:
        found = creds.db_lookup(db_kind)

    # Source 2: env fallback
    if found is None:
        settings_obj: object
        if creds.env_lookup is not None:
            settings_obj = creds.env_lookup()
        elif settings_lookup is not None:
            settings_obj = settings_lookup()
        else:
            from allhands.config.settings import get_settings as _gs

            settings_obj = _gs()

        if scheme == "openai":
            api_key = getattr(settings_obj, "openai_api_key", None)
            base_url = getattr(settings_obj, "openai_base_url", None) or "https://api.openai.com/v1"
        else:
            api_key = getattr(settings_obj, "dashscope_api_key", None)
            base_url = "https://dashscope.aliyuncs.com/compatible-mode/v1"

        if not api_key:
            hint = (
                "ALLHANDS_OPENAI_API_KEY 或在 /gateway 配置 OpenAI provider"
                if scheme == "openai"
                else "ALLHANDS_DASHSCOPE_API_KEY 或在 /gateway 配置阿里云 provider"
            )
            raise ValueError(f"{scheme} embedder needs credentials: set {hint}")
        found = _ProviderCreds(api_key=api_key, base_url=base_url)

    base = found.base_url.rstrip("/")
    dim = _OPENAI_DIMS.get(rest, 1536) if scheme == "openai" else _BAILIAN_DIMS.get(rest, 1024)
    # Aliyun DashScope text-embedding-v3/v4 caps batch at 10 (HTTP 400 above
    # that). OpenAI's text-embedding-3-* allows much larger batches but our
    # latency / retry math is fine at the global default. Only constrain when
    # we know the upstream limit.
    max_batch = 10 if scheme in {"aliyun", "bailian"} else None
    return EmbeddingProvider(
        name=model_ref,
        dim=dim,
        embed=_openai_compat_embed(f"{base}/embeddings", found.api_key, rest),
        max_batch_size=max_batch,
    )


async def fetch_provider_creds_from_db(session_maker: Any, kind: str) -> _ProviderCreds | None:
    """Async DB read for the first enabled, key-bearing LLMProvider of
    a given kind. Caller (KnowledgeService) awaits this once at startup
    or on KB create, then hands the result to ``resolve_provider`` via
    ``CredsLookup(db_lookup=lambda _: creds)``.

    First-fit is good enough for v0 — typical user has 0 or 1 of each
    kind. Per-KB pinning to a specific provider id is a v1 follow-up.
    """
    from allhands.persistence.sql_repos import SqlLLMProviderRepo

    async with session_maker() as s:
        repo = SqlLLMProviderRepo(s)
        all_providers = await repo.list_all()
    for p in all_providers:
        if p.kind == kind and p.enabled and p.api_key:
            return _ProviderCreds(api_key=p.api_key, base_url=p.base_url)
    return None


async def resolve_provider_with_db(model_ref: str, session_maker: Any) -> EmbeddingProvider:
    """Async wrapper that does the DB lookup + dispatches to the sync
    resolver. Use this from the service layer; raw ``resolve_provider``
    is kept sync for tests + the env-only path."""
    scheme, _, _ = model_ref.partition(":")
    if scheme in {"openai", "aliyun", "bailian"}:
        db_kind = "aliyun" if scheme in {"aliyun", "bailian"} else "openai"
        creds_obj = await fetch_provider_creds_from_db(session_maker, db_kind)
    else:
        creds_obj = None
    creds = CredsLookup(db_lookup=(lambda _k: creds_obj) if creds_obj else None)
    return resolve_provider(model_ref, creds=creds)


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
