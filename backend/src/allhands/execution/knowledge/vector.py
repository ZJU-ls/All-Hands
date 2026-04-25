"""Vector primitives + VectorStore interface + v0 BlobVecStore impl.

Vectors are pure-Python ``list[float]`` and packed/unpacked through
``struct`` (little-endian float32). Avoids a numpy dependency for the v0
single-machine path. A future ``SqliteVecStore`` swap (sqlite-vec
loadable extension) keeps the same `VectorStore` interface and only
changes how `search` is run — brute-force Python cosine becomes
native vec0 distance.

Cosine vs L2 reminder: all vectors must be L2-normalized at write time.
Then for unit vectors, cosine_sim(a,b) = a·b, and L2² = 2(1 - a·b).
That makes cosine ranking ↔ L2 ranking interchangeable; we expose
cosine in `VecHit.score` for human-friendly numbers.
"""

from __future__ import annotations

import math
import struct
from typing import TYPE_CHECKING, Any, Protocol

from pydantic import BaseModel

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    SessionMaker = async_sessionmaker[AsyncSession]
else:
    SessionMaker = Any

Vector = list[float]


# ----------------------------------------------------------------------
# Pack / unpack / norm
# ----------------------------------------------------------------------


def pack_vector(v: Vector) -> bytes:
    """Pack as little-endian float32. Length = dim * 4 bytes."""
    return struct.pack(f"<{len(v)}f", *v)


def unpack_vector(b: bytes, dim: int) -> Vector:
    if len(b) != dim * 4:
        raise ValueError(f"vector bytes length {len(b)} != dim*4 ({dim * 4})")
    return list(struct.unpack(f"<{dim}f", b))


def normalize(v: Vector) -> Vector:
    """L2-normalize. Zero vector returns itself unchanged (caller's problem)."""
    norm = math.sqrt(sum(x * x for x in v))
    if norm == 0.0:
        return v
    return [x / norm for x in v]


def cosine(a: Vector, b: Vector) -> float:
    """For pre-normalized vectors this is just the dot product. We compute
    full cosine here to stay safe against caller passing un-normalized
    inputs — cheap enough for brute-force scan path."""
    if not a or not b:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (na * nb)


# ----------------------------------------------------------------------
# Interface + transport
# ----------------------------------------------------------------------


class VecHit(BaseModel):
    chunk_id: int
    score: float  # cosine in [-1, 1]; higher better

    model_config = {"frozen": True}


class VectorStore(Protocol):
    """Per-KB vector ops. KB id is the namespace.

    v0 ``BlobVecStore`` ignores ``create_namespace`` / ``drop_namespace``
    because vectors live on the chunks table; the per-KB filter happens
    in ``search`` via kb_id. A future sqlite-vec impl uses these to
    create/drop ``kb_<id>_vec`` virtual tables.
    """

    async def create_namespace(self, kb_id: str, dim: int) -> None: ...
    async def drop_namespace(self, kb_id: str) -> None: ...
    async def upsert(self, kb_id: str, items: list[tuple[int, Vector]]) -> None: ...
    async def search(
        self,
        kb_id: str,
        query_vec: Vector,
        *,
        top: int = 50,
        filter_ids: set[int] | None = None,
    ) -> list[VecHit]: ...


# ----------------------------------------------------------------------
# v0 implementation: vectors live in chunks.embedding BLOB
# ----------------------------------------------------------------------


class BlobVecStore:
    """Brute-force Python cosine over chunks.embedding BLOBs.

    Reads `(chunk_id, blob)` for the KB on each search. Adequate up to
    100k chunks (≈ 100ms scan in Python on a M1). Beyond that, swap in
    SqliteVecStore — the interface contract is identical.

    Threading: SqlChunkRepo opens its session, so multiple concurrent
    searches each see a snapshot. No locking needed for the v0 path.
    """

    def __init__(self, session_maker: SessionMaker) -> None:
        # session_maker is an `async_sessionmaker[AsyncSession]`. We import
        # SqlChunkRepo lazily inside the methods to keep this module free
        # of persistence imports (preserves layered dependency direction).
        self._session_maker = session_maker
        # Per-KB dim cache: filled lazily on first upsert. Used to validate
        # `query_vec` length matches what was indexed for this KB.
        self._dim: dict[str, int] = {}

    async def create_namespace(self, kb_id: str, dim: int) -> None:
        self._dim[kb_id] = dim

    async def drop_namespace(self, kb_id: str) -> None:
        self._dim.pop(kb_id, None)

    async def upsert(self, kb_id: str, items: list[tuple[int, Vector]]) -> None:
        if not items:
            return
        # Set dim if first time; sanity-check on subsequent
        first_dim = len(items[0][1])
        if kb_id in self._dim and self._dim[kb_id] != first_dim:
            raise ValueError(
                f"kb {kb_id!r} dim mismatch: expected {self._dim[kb_id]}, got {first_dim}"
            )
        self._dim[kb_id] = first_dim
        from allhands.persistence.knowledge_repos import SqlChunkRepo

        async with self._session_maker() as s:
            repo = SqlChunkRepo(s)
            for chunk_id, vec in items:
                if len(vec) != first_dim:
                    raise ValueError(
                        f"vector dim mismatch for chunk_id={chunk_id}: "
                        f"expected {first_dim}, got {len(vec)}"
                    )
                await repo.upsert_embedding(chunk_id, pack_vector(vec))
            await s.commit()

    async def search(
        self,
        kb_id: str,
        query_vec: Vector,
        *,
        top: int = 50,
        filter_ids: set[int] | None = None,
    ) -> list[VecHit]:
        from allhands.persistence.knowledge_repos import SqlChunkRepo

        async with self._session_maker() as s:
            repo = SqlChunkRepo(s)
            rows = await repo.fetch_kb_vectors(kb_id)
        if not rows:
            return []
        dim = self._dim.get(kb_id) or len(query_vec)
        scored: list[VecHit] = []
        for chunk_id, blob in rows:
            if filter_ids is not None and chunk_id not in filter_ids:
                continue
            try:
                v = unpack_vector(blob, dim)
            except ValueError:
                # dim mismatch (e.g. mid-reindex); skip silently
                continue
            scored.append(VecHit(chunk_id=chunk_id, score=cosine(query_vec, v)))
        scored.sort(key=lambda h: -h.score)
        return scored[:top]
