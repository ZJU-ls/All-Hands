"""Hybrid retriever — BM25 (FTS5) ⊕ vector ⊕ RRF [⊕ reranker · M3].

Inputs are stateless: a `kb_id`, a query string, a config. Outputs are
ScoredChunk (already normalized to a single ``score`` plus its provenance
ranks). The agent loop reads this back and decides whether to follow up
with `kb_read_document` or do another search round — Pure-Function
Query Loop (P3): no internal state on the retriever instance.

RRF: ``score(chunk) = Σ_i  weight_i / (k_const + rank_i(chunk))``.
Parameter-free across BM25 (unbounded score) and cosine (0-1) — neither
needs to be normalized to the same range.

Query embedding cache lives in-process: an ``LRUCache`` with TTL keyed
by ``sha256(query||model_ref)``. Same query within an hour skips the
embedder entirely. Useful for the playground page where the user tweaks
weights and re-runs the same query repeatedly.
"""

from __future__ import annotations

import asyncio
import hashlib
import time
from collections.abc import Awaitable, Callable, Coroutine
from dataclasses import dataclass
from typing import Any

from allhands.core import Chunk, RetrievalConfig, ScoredChunk
from allhands.execution.knowledge.embedder import Embedder
from allhands.execution.knowledge.vector import Vector, VectorStore

FtsSearchFn = Callable[[str, str, int], Coroutine[Any, Any, list[tuple[int, float]]]]
ChunkLookupFn = Callable[[list[int]], Coroutine[Any, Any, list[Chunk]]]

# ----------------------------------------------------------------------
# Query embedding cache (in-process LRU + TTL)
# ----------------------------------------------------------------------


@dataclass
class _CacheEntry:
    vec: Vector
    expires_at: float


class QueryEmbeddingCache:
    def __init__(self, max_entries: int = 1024, ttl_seconds: int = 3600) -> None:
        self._store: dict[str, _CacheEntry] = {}
        self._max = max_entries
        self._ttl = ttl_seconds

    def _key(self, query: str, model_ref: str) -> str:
        h = hashlib.sha256()
        h.update(model_ref.encode("utf-8"))
        h.update(b"\x00")
        h.update(query.encode("utf-8"))
        return h.hexdigest()

    def get(self, query: str, model_ref: str) -> Vector | None:
        k = self._key(query, model_ref)
        entry = self._store.get(k)
        if entry is None:
            return None
        if entry.expires_at < time.monotonic():
            self._store.pop(k, None)
            return None
        return entry.vec

    def put(self, query: str, model_ref: str, vec: Vector) -> None:
        if len(self._store) >= self._max:
            # Evict oldest by expiry
            oldest = min(self._store.items(), key=lambda kv: kv[1].expires_at)[0]
            self._store.pop(oldest, None)
        self._store[self._key(query, model_ref)] = _CacheEntry(
            vec=vec, expires_at=time.monotonic() + self._ttl
        )


# ----------------------------------------------------------------------
# RRF
# ----------------------------------------------------------------------


@dataclass(frozen=True)
class _RankedList:
    items: list[tuple[int, float]]  # (chunk_id, raw_score)  best-first
    weight: float


def rrf_fuse(lists: list[_RankedList], *, k_const: int = 60) -> list[tuple[int, float]]:
    """RRF over multiple ranked lists. Returns [(chunk_id, score)] best-first.

    `k_const=60` is the canonical value (Cormack, Clarke, Büttcher 2009).
    """
    contrib: dict[int, float] = {}
    for rl in lists:
        for rank, (chunk_id, _raw_score) in enumerate(rl.items, start=1):
            contrib[chunk_id] = contrib.get(chunk_id, 0.0) + rl.weight / (k_const + rank)
    return sorted(contrib.items(), key=lambda kv: -kv[1])


# ----------------------------------------------------------------------
# Hybrid retriever
# ----------------------------------------------------------------------


class HybridRetriever:
    """Stateless: holds dependencies, no per-query state.

    Dependencies:
      - ``embedder``: query → vec
      - ``vec_store``: vec search (read side of VectorStore)
      - ``fts_search``: callable (kb_id, query, top) → [(chunk_id, score)]
      - ``chunk_lookup``: callable [int] → list[Chunk]
      - ``query_cache``: optional in-process embedding cache
    """

    def __init__(
        self,
        *,
        embedder: Embedder,
        vec_store: VectorStore,
        fts_search: FtsSearchFn,
        chunk_lookup: ChunkLookupFn,
        query_cache: QueryEmbeddingCache | None = None,
        embedder_for_kb: Callable[[str], Awaitable[Embedder]] | None = None,
    ) -> None:
        self.embedder = embedder
        self.vec_store = vec_store
        self.fts_search = fts_search
        self.chunk_lookup = chunk_lookup
        self.query_cache = query_cache or QueryEmbeddingCache()
        # Per-KB resolver (same shape as IngestOrchestrator) — when set,
        # search() picks the embedder for the queried KB rather than the
        # constructor-provided default. Keeps query and ingest aligned
        # so a switched KB's vectors are encoded *and* queried with the
        # same model.
        self.embedder_for_kb = embedder_for_kb

    async def search(
        self,
        kb_id: str,
        query: str,
        cfg: RetrievalConfig | None = None,
        *,
        filter_chunk_ids: set[int] | None = None,
    ) -> list[ScoredChunk]:
        cfg = cfg or RetrievalConfig()
        query = query.strip()
        if not query:
            return []

        # 1. Query embedding (cache → embedder)
        embedder = (
            await self.embedder_for_kb(kb_id) if self.embedder_for_kb is not None else self.embedder
        )
        cached = self.query_cache.get(query, embedder.model_ref)
        if cached is not None:
            q_vec = cached
        else:
            q_vec = (await embedder.embed_texts([query]))[0]
            self.query_cache.put(query, embedder.model_ref, q_vec)

        # 2. Run BM25 + vector concurrently
        bm25_task = asyncio.create_task(self.fts_search(kb_id, query, 50))
        vec_task = asyncio.create_task(
            self.vec_store.search(kb_id, q_vec, top=50, filter_ids=filter_chunk_ids)
        )
        bm25_hits, vec_hits = await asyncio.gather(bm25_task, vec_task)

        # 3. Build ranks → RRF
        bm25_list = _RankedList(items=list(bm25_hits), weight=cfg.bm25_weight)
        vec_list = _RankedList(
            items=[(h.chunk_id, h.score) for h in vec_hits],
            weight=cfg.vector_weight,
        )
        fused = rrf_fuse([bm25_list, vec_list])
        fused = fused[: cfg.rerank_top_in]

        # 4. (M3) reranker — placeholder for now; cfg.reranker == "none"
        # Once the bge ONNX runtime ships, swap a list-rescore in here.

        # 5. top_k + filter on min_score
        topk = fused[: cfg.top_k]
        topk = [(cid, s) for cid, s in topk if s >= cfg.min_score]
        if not topk:
            return []

        # 6. Hydrate chunks + assemble citation
        chunk_ids = [cid for cid, _ in topk]
        chunks = await self.chunk_lookup(chunk_ids)
        chunks_by_id = {c.id: c for c in chunks}
        bm25_rank_by_id = {cid: i + 1 for i, (cid, _) in enumerate(bm25_hits)}
        vec_rank_by_id = {h.chunk_id: i + 1 for i, h in enumerate(vec_hits)}

        out: list[ScoredChunk] = []
        for cid, score in topk:
            c = chunks_by_id.get(cid)
            if c is None:
                continue
            out.append(
                ScoredChunk(
                    chunk=c,
                    score=score,
                    bm25_rank=bm25_rank_by_id.get(cid),
                    vector_rank=vec_rank_by_id.get(cid),
                    citation=_citation(c),
                )
            )
        return out


def _citation(c: Chunk) -> str:
    parts = [f"doc {c.document_id[:8]}"]
    if c.section_path:
        parts.append(f"§ {c.section_path}")
    if c.page is not None:
        parts.append(f"p{c.page}")
    return " · ".join(parts)


__all__ = ["HybridRetriever", "QueryEmbeddingCache", "rrf_fuse"]
