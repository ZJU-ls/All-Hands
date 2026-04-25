"""KnowledgeService — application-layer (L6) facade for KB operations.

Unifies REST endpoints and Meta-Tool executors over the same business
logic (Tool-First / Principle 1). Two API surfaces, one impl.

Provides:

- KB CRUD (create / get / list / soft delete)
- Document upload (raw bytes → file-on-disk + ingest pipeline)
- Document content read (file → text/bytes)
- Search (delegates to HybridRetriever)
- Grant CRUD + a `check_grant` helper for the Confirmation Gate path

Composition:

- Constructor takes a session_maker so each method opens its own
  transaction. This matches the artifact_service pattern.
- Single ingest happens synchronously per call. For larger uploads
  the REST layer can offload to a background task; v0 just blocks.
- Vector store and embedder are constructed inside the service so
  the wiring stays compact; tests substitute via the constructor
  for determinism.
"""

from __future__ import annotations

import contextlib
import hashlib
import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

from allhands.config.settings import get_settings
from allhands.core import (
    Chunk,
    Collection,
    Document,
    DocumentState,
    DocumentVersion,
    Grant,
    GrantScope,
    KBVisibility,
    KnowledgeBase,
    RetrievalConfig,
    ScoredChunk,
    SourceType,
)
from allhands.core.errors import DomainError
from allhands.execution.knowledge.chunker import Chunker, ChunkerConfig
from allhands.execution.knowledge.embedder import (
    Embedder,
    fetch_provider_creds_from_db,
    resolve_provider,
    resolve_provider_with_db,
)
from allhands.execution.knowledge.ingest import IngestOrchestrator
from allhands.execution.knowledge.parsers import detect_mime
from allhands.execution.knowledge.retriever import HybridRetriever
from allhands.execution.knowledge.vector import BlobVecStore, VectorStore
from allhands.persistence.knowledge_repos import (
    SqlChunkRepo,
    SqlCollectionRepo,
    SqlDocumentRepo,
    SqlGrantRepo,
    SqlKnowledgeBaseRepo,
    fts_search,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


_logger = logging.getLogger(__name__)


DEFAULT_WORKSPACE_ID = "default"
# Fallback when settings somehow aren't available (test harness without
# pydantic-settings). Real default is read from settings at construction.
_FALLBACK_EMBEDDING_REF = "mock:hash-64"


@dataclass(frozen=True)
class EmbeddingModelOption:
    """One row in the "pick an embedding model" UI dropdown.

    `available` is False when the scheme exists but is not currently
    usable in this process (e.g. ``openai`` without ``openai_api_key``).
    The UI greys out such options + shows ``reason``.
    """

    ref: str
    label: str
    dim: int
    available: bool
    reason: str | None = None
    is_default: bool = False


class KBError(DomainError):
    """KB-layer validation / not-found error."""


class KBNotFound(KBError):
    pass


class DocumentNotFound(KBError):
    pass


class GrantDenied(KBError):
    """Raised when an agent-initiated write hits no matching grant.

    The Meta-Tool executor catches this and converts it into a Defer
    so the user can grant permission inline.
    """


class KnowledgeService:
    def __init__(
        self,
        session_maker: async_sessionmaker[AsyncSession],
        *,
        data_dir: Path | None = None,
        embedder: Embedder | None = None,
        vec_store: VectorStore | None = None,
        chunker_config: ChunkerConfig | None = None,
    ) -> None:
        self._session_maker = session_maker
        settings = get_settings()
        self._data_dir = data_dir or Path(settings.data_dir)
        self._chunker = Chunker(chunker_config)

        # Embedder default chain:
        #   1. caller-provided embedder (tests / DI)
        #   2. settings.kb_default_embedding_model_ref (env-configured)
        #   3. mock:hash-64 (always-available fallback)
        # The settings path is what makes this user-configurable: prod sets
        # ALLHANDS_KB_DEFAULT_EMBEDDING_MODEL_REF=bailian:text-embedding-v3
        # and existing call sites need no change.
        if embedder is None:
            ref = (
                getattr(settings, "kb_default_embedding_model_ref", None) or _FALLBACK_EMBEDDING_REF
            )
            try:
                provider = resolve_provider(ref)
            except ValueError as exc:
                # Misconfigured env (e.g. openai:* without API key) → fall
                # back loudly. We log + degrade rather than crash boot,
                # so the platform stays available even when keys go stale.
                _logger.warning(
                    "kb embedder default %r unusable (%s) — falling back to %s",
                    ref,
                    exc,
                    _FALLBACK_EMBEDDING_REF,
                )
                ref = _FALLBACK_EMBEDDING_REF
                provider = resolve_provider(ref)
            embedder = Embedder(model_ref=ref, provider=provider)
        self._embedder = embedder

        if vec_store is None:
            vec_store = BlobVecStore(session_maker)
        self._vec_store = vec_store

        self._ingest = IngestOrchestrator(
            session_maker,
            chunker=self._chunker,
            embedder=self._embedder,
            vec_store=self._vec_store,
            data_root=self._data_dir,
        )
        self._retriever = HybridRetriever(
            embedder=self._embedder,
            vec_store=self._vec_store,
            fts_search=self._fts_search_for_kb,
            chunk_lookup=self._chunk_lookup,
        )

    # ------------------------------------------------------------------
    # Embedding model registry — what's installable in this process
    # ------------------------------------------------------------------

    async def list_embedding_models(self) -> list[EmbeddingModelOption]:
        """Return options the create-KB form can render in a dropdown.

        Availability resolution (per scheme):
          1. DB lookup — first enabled LLMProvider of matching kind with
             a non-empty api_key. Means the user configured it via /gateway.
          2. Env fallback — ALLHANDS_OPENAI_API_KEY / _DASHSCOPE_API_KEY.

        Reason strings now nudge users toward the UI (`/gateway`) rather
        than asking them to edit `.env` — that was the bad UX cited in
        v0 review.
        """
        settings = get_settings()
        default_ref = (
            getattr(settings, "kb_default_embedding_model_ref", None) or _FALLBACK_EMBEDDING_REF
        )

        # Probe both kinds via the unified resolver (DB first, env second)
        openai_creds = await fetch_provider_creds_from_db(self._session_maker, "openai")
        aliyun_creds = await fetch_provider_creds_from_db(self._session_maker, "aliyun")
        openai_key = openai_creds is not None or bool(getattr(settings, "openai_api_key", None))
        aliyun_key = aliyun_creds is not None or bool(getattr(settings, "dashscope_api_key", None))

        options: list[EmbeddingModelOption] = []

        # Mock — always available, two common dims
        for dim in (64, 256):
            ref = f"mock:hash-{dim}"
            options.append(
                EmbeddingModelOption(
                    ref=ref,
                    label=f"Mock · hash-{dim} (演示用 · 不懂语义)",
                    dim=dim,
                    available=True,
                    is_default=ref == default_ref,
                )
            )

        # OpenAI — UI hint when missing
        for model, dim in (
            ("text-embedding-3-small", 1536),
            ("text-embedding-3-large", 3072),
        ):
            ref = f"openai:{model}"
            options.append(
                EmbeddingModelOption(
                    ref=ref,
                    label=f"OpenAI · {model}",
                    dim=dim,
                    available=openai_key,
                    reason=None if openai_key else "去 /gateway 添加 OpenAI provider",
                    is_default=ref == default_ref,
                )
            )

        # 阿里云百炼 (DashScope OpenAI-compat) — accept both `aliyun:` and
        # `bailian:` for back-compat. UI shows the new "aliyun" form so
        # it lines up with /gateway 's preset list.
        for model, dim in (
            ("text-embedding-v3", 1024),
            ("text-embedding-v4", 1024),
        ):
            ref = f"aliyun:{model}"
            options.append(
                EmbeddingModelOption(
                    ref=ref,
                    label=f"阿里云百炼 · {model}",
                    dim=dim,
                    available=aliyun_key,
                    reason=None if aliyun_key else "去 /gateway 添加 阿里云 百炼 provider",
                    is_default=ref == default_ref,
                )
            )
        return options

    @staticmethod
    def default_embedding_model_ref() -> str:
        """Resolved env-configured default; convenience for callers that
        only need the string (e.g. UI form initial value)."""
        return (
            getattr(get_settings(), "kb_default_embedding_model_ref", None)
            or _FALLBACK_EMBEDDING_REF
        )

    # ------------------------------------------------------------------
    # KB CRUD
    # ------------------------------------------------------------------

    async def create_kb(
        self,
        *,
        name: str,
        description: str = "",
        visibility: KBVisibility = KBVisibility.PRIVATE,
        embedding_model_ref: str | None = None,
        retrieval_config: RetrievalConfig | None = None,
        workspace_id: str = DEFAULT_WORKSPACE_ID,
    ) -> KnowledgeBase:
        ref = embedding_model_ref or self._embedder.model_ref
        # Resolve via DB-first creds (UI-configured /gateway) → env fallback.
        # Lets the UI's "add provider" path work without an .env edit.
        provider = await resolve_provider_with_db(ref, self._session_maker)
        now = datetime.now(UTC)
        kb = KnowledgeBase(
            id=str(uuid.uuid4()),
            workspace_id=workspace_id,
            name=name,
            description=description,
            visibility=visibility,
            embedding_model_ref=ref,
            embedding_dim=provider.dim,
            retrieval_config=retrieval_config or RetrievalConfig(),
            created_at=now,
            updated_at=now,
        )
        async with self._session_maker() as s:
            repo = SqlKnowledgeBaseRepo(s)
            existing = await repo.get_by_name(workspace_id, name)
            if existing:
                raise KBError(f"a KB named {name!r} already exists in workspace {workspace_id!r}")
            await repo.upsert(kb)
            # initialize vec namespace
            await self._vec_store.create_namespace(kb.id, kb.embedding_dim)
            await s.commit()
        return kb

    async def get_kb(self, kb_id: str) -> KnowledgeBase:
        async with self._session_maker() as s:
            kb = await SqlKnowledgeBaseRepo(s).get(kb_id)
        if kb is None:
            raise KBNotFound(f"kb {kb_id!r} not found")
        return kb

    async def list_kbs(self, *, workspace_id: str = DEFAULT_WORKSPACE_ID) -> list[KnowledgeBase]:
        async with self._session_maker() as s:
            return await SqlKnowledgeBaseRepo(s).list_for_workspace(workspace_id)

    async def update_retrieval_config(self, kb_id: str, cfg: RetrievalConfig) -> KnowledgeBase:
        """Replace this KB's retrieval config wholesale.

        We keep the API "replace" rather than "patch" so callers can't end
        up with a half-mutated frozen pydantic model — the wire payload
        carries the full config, and we validate at the boundary.
        """
        kb = await self.get_kb(kb_id)
        updated = kb.model_copy(update={"retrieval_config": cfg, "updated_at": datetime.now(UTC)})
        async with self._session_maker() as s:
            await SqlKnowledgeBaseRepo(s).upsert(updated)
            await s.commit()
        return updated

    async def soft_delete_kb(self, kb_id: str) -> None:
        async with self._session_maker() as s:
            await SqlKnowledgeBaseRepo(s).soft_delete(kb_id)
            await s.commit()
        await self._vec_store.drop_namespace(kb_id)

    # ------------------------------------------------------------------
    # Documents
    # ------------------------------------------------------------------

    async def upload_document(
        self,
        kb_id: str,
        *,
        title: str,
        content_bytes: bytes,
        filename: str | None = None,
        mime_type: str | None = None,
        source_type: SourceType = SourceType.UPLOAD,
        source_uri: str | None = None,
        collection_id: str | None = None,
        tags: list[str] | None = None,
        created_by_employee_id: str | None = None,
    ) -> Document:
        await self.get_kb(kb_id)  # validate exists
        sha = hashlib.sha256(content_bytes).hexdigest()

        # Dedup on sha within the KB
        async with self._session_maker() as s:
            existing = await SqlDocumentRepo(s).get_by_sha(kb_id, sha)
        if existing is not None:
            return existing

        now = datetime.now(UTC)
        doc_id = str(uuid.uuid4())
        # Mime resolution: prefer caller-provided, but treat the generic
        # "application/octet-stream" as missing — multipart uploads from
        # browsers / curl often default to it for unknown extensions, and
        # we'd then fail with "no parser registered" even though the
        # filename suffix tells us exactly what it is.
        if mime_type and mime_type != "application/octet-stream":
            mime = mime_type
        elif filename:
            mime = detect_mime(filename)
        else:
            mime = "text/plain"
        ext = (Path(filename).suffix.lstrip(".") if filename else "bin") or "bin"
        rel_path = f"{kb_id}/{doc_id}/v1.{ext}"
        abs_path = self._data_dir / "kb" / rel_path
        abs_path.parent.mkdir(parents=True, exist_ok=True)
        # Atomic write
        tmp = abs_path.with_suffix(abs_path.suffix + ".tmp")
        tmp.write_bytes(content_bytes)
        tmp.replace(abs_path)

        doc = Document(
            id=doc_id,
            kb_id=kb_id,
            collection_id=collection_id,
            title=title,
            source_type=source_type,
            source_uri=source_uri,
            mime_type=mime,
            file_path=rel_path,
            size_bytes=len(content_bytes),
            sha256=sha,
            state=DocumentState.PENDING,
            tags=tags or [],
            chunk_count=0,
            failed_chunk_count=0,
            version=1,
            created_by_employee_id=created_by_employee_id,
            created_at=now,
            updated_at=now,
        )
        async with self._session_maker() as s:
            await SqlDocumentRepo(s).upsert(doc)
            await SqlDocumentRepo(s).save_version(
                DocumentVersion(
                    id=str(uuid.uuid4()),
                    document_id=doc_id,
                    version=1,
                    file_path=rel_path,
                    size_bytes=len(content_bytes),
                    sha256=sha,
                    diff_summary=None,
                    created_at=now,
                )
            )
            await s.commit()

        # Run ingest. (For long uploads the REST layer can offload this
        # to a BackgroundTasks; we keep the call sync here so callers can
        # await readiness.) Errors already wrote FAILED state; callers
        # see the failure in the returned doc.state.
        with contextlib.suppress(Exception):
            await self._ingest.ingest_document(doc_id, file_path_abs=abs_path)
        return await self.get_document(doc_id)

    async def get_document(self, document_id: str) -> Document:
        async with self._session_maker() as s:
            doc = await SqlDocumentRepo(s).get(document_id)
        if doc is None:
            raise DocumentNotFound(f"document {document_id!r} not found")
        return doc

    async def read_document_text(self, document_id: str) -> str:
        doc = await self.get_document(document_id)
        abs_path = self._data_dir / "kb" / doc.file_path
        try:
            return abs_path.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:  # missing file (someone wiped data dir?)
            raise DocumentNotFound(f"file for {document_id!r} missing: {exc}") from exc

    async def list_chunks_for_document(self, document_id: str) -> list[Chunk]:
        async with self._session_maker() as s:
            return await SqlChunkRepo(s).list_for_document(document_id)

    async def list_documents(
        self,
        kb_id: str,
        *,
        collection_id: str | None = None,
        state: DocumentState | None = None,
        title_prefix: str | None = None,
        tag: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[Document]:
        async with self._session_maker() as s:
            return await SqlDocumentRepo(s).list_for_kb(
                kb_id,
                collection_id=collection_id,
                state=state,
                title_prefix=title_prefix,
                tag=tag,
                limit=limit,
                offset=offset,
            )

    async def soft_delete_document(self, document_id: str) -> None:
        async with self._session_maker() as s:
            await SqlDocumentRepo(s).soft_delete(document_id)
            await s.commit()

    # ------------------------------------------------------------------
    # Search
    # ------------------------------------------------------------------

    async def search(
        self, kb_id: str, query: str, *, top_k: int | None = None
    ) -> list[ScoredChunk]:
        kb = await self.get_kb(kb_id)
        cfg = kb.retrieval_config
        if top_k is not None:
            cfg = RetrievalConfig.model_validate({**cfg.model_dump(), "top_k": top_k})
        import time

        t0 = time.monotonic()
        results = await self._retriever.search(kb_id, query, cfg)
        latency_ms = (time.monotonic() - t0) * 1000.0
        _record_search_stat(kb_id, query, latency_ms, len(results))
        return results

    async def diagnose_search(
        self, kb_id: str, query: str, *, top_k: int = 8
    ) -> dict[str, list[ScoredChunk]]:
        """Run the same query under three lens for the recall-test UI:
          - bm25_only: vector_weight=0
          - vector_only: bm25_weight=0
          - hybrid: 1.0 / 1.0
        All share the same top_k. Useful for "为什么这条没召回" analyses
        and for showing users why hybrid > either lens alone.
        """
        await self.get_kb(kb_id)  # validate
        bm25_cfg = RetrievalConfig(bm25_weight=1.0, vector_weight=0.0, top_k=top_k)
        vec_cfg = RetrievalConfig(bm25_weight=0.0, vector_weight=1.0, top_k=top_k)
        hyb_cfg = RetrievalConfig(bm25_weight=1.0, vector_weight=1.0, top_k=top_k)
        bm25 = await self._retriever.search(kb_id, query, bm25_cfg)
        vec = await self._retriever.search(kb_id, query, vec_cfg)
        hybrid = await self._retriever.search(kb_id, query, hyb_cfg)
        return {"bm25_only": bm25, "vector_only": vec, "hybrid": hybrid}

    def get_search_stats(self, kb_id: str) -> SearchStatsSummary:
        """In-memory ring buffer summary for the past N searches against
        this KB. v0 only; not persisted, lost on restart. Cheap and good
        enough to surface "本周 N 次检索 / 平均 X ms" in the sidebar."""
        return _summarize_stats(kb_id)

    # ------------------------------------------------------------------
    # Grants
    # ------------------------------------------------------------------

    async def grant_permission(
        self,
        kb_id: str,
        *,
        scope: GrantScope,
        employee_id: str | None = None,
        skill_id: str | None = None,
        expires_at: datetime | None = None,
        created_by: str | None = None,
    ) -> Grant:
        if employee_id is None and skill_id is None:
            raise KBError("grant_permission requires employee_id or skill_id")
        await self.get_kb(kb_id)  # validate exists
        now = datetime.now(UTC)
        grant = Grant(
            id=str(uuid.uuid4()),
            kb_id=kb_id,
            employee_id=employee_id,
            skill_id=skill_id,
            scope=scope,
            expires_at=expires_at,
            created_at=now,
            created_by=created_by,
        )
        async with self._session_maker() as s:
            await SqlGrantRepo(s).upsert(grant)
            await s.commit()
        return grant

    async def list_grants(self, kb_id: str) -> list[Grant]:
        async with self._session_maker() as s:
            return await SqlGrantRepo(s).list_for_kb(kb_id)

    async def revoke_grant(self, grant_id: str) -> None:
        async with self._session_maker() as s:
            await SqlGrantRepo(s).delete(grant_id)
            await s.commit()

    async def has_write_grant(
        self, kb_id: str, *, employee_id: str | None = None, skill_id: str | None = None
    ) -> bool:
        if employee_id is None and skill_id is None:
            return True  # human-driven path; UI layer enforces auth above
        async with self._session_maker() as s:
            grant = await SqlGrantRepo(s).find_for_principal(
                kb_id,
                employee_id=employee_id,
                skill_id=skill_id,
                min_scope=GrantScope.WRITE,
            )
        return grant is not None

    # ------------------------------------------------------------------
    # Collections (minimal v0)
    # ------------------------------------------------------------------

    async def list_collections(self, kb_id: str) -> list[Collection]:
        async with self._session_maker() as s:
            return await SqlCollectionRepo(s).list_for_kb(kb_id)

    # ------------------------------------------------------------------
    # Internal: retriever helpers (closures over session_maker)
    # ------------------------------------------------------------------

    async def _fts_search_for_kb(self, kb_id: str, query: str, top: int) -> list[tuple[int, float]]:
        async with self._session_maker() as s:
            return await fts_search(s, kb_id, query, top=top)

    async def _chunk_lookup(self, chunk_ids: list[int]) -> list[Chunk]:
        async with self._session_maker() as s:
            return await SqlChunkRepo(s).get_many(chunk_ids)


# ----------------------------------------------------------------------
# In-memory search stats (v0 ring buffer)
# ----------------------------------------------------------------------

# Per-KB ring buffer of (timestamp, query, latency_ms, hit_count).
# Lives in-process; lost on restart. Cap per KB so it can't grow unbounded
# under hot loops. A future v1 with proper analytics can land an event
# log + percentiles + per-day rollup.
_STATS_CAP = 50
_stats: dict[str, list[tuple[datetime, str, float, int]]] = {}


def _record_search_stat(kb_id: str, query: str, latency_ms: float, hit_count: int) -> None:
    bucket = _stats.setdefault(kb_id, [])
    bucket.append((datetime.now(UTC), query, latency_ms, hit_count))
    if len(bucket) > _STATS_CAP:
        del bucket[0 : len(bucket) - _STATS_CAP]


@dataclass(frozen=True)
class SearchStatRecent:
    at: str
    query: str
    latency_ms: float
    hits: int


@dataclass(frozen=True)
class SearchStatsSummary:
    count: int
    avg_latency_ms: float | None
    recent: list[SearchStatRecent]


def _summarize_stats(kb_id: str) -> SearchStatsSummary:
    bucket = _stats.get(kb_id, [])
    if not bucket:
        return SearchStatsSummary(count=0, avg_latency_ms=None, recent=[])
    avg = sum(b[2] for b in bucket) / len(bucket)
    return SearchStatsSummary(
        count=len(bucket),
        avg_latency_ms=round(avg, 1),
        recent=[
            SearchStatRecent(
                at=ts.isoformat(),
                query=q,
                latency_ms=round(lat, 1),
                hits=hits,
            )
            for ts, q, lat, hits in reversed(bucket[-10:])
        ],
    )


__all__ = [
    "DocumentNotFound",
    "EmbeddingModelOption",
    "GrantDenied",
    "KBError",
    "KBNotFound",
    "KnowledgeService",
]
