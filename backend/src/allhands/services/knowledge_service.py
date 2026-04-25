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
from allhands.execution.knowledge.embedder import Embedder, resolve_provider
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

    def list_embedding_models(self) -> list[EmbeddingModelOption]:
        """Return options the create-KB form can render in a dropdown.

        Discovery is deliberately static: we know the three schemes the
        embedder supports + the per-scheme prerequisites (api keys). We do
        NOT round-trip provider HTTP here — UI render must be cheap and
        free of external dependencies.
        """
        settings = get_settings()
        default_ref = (
            getattr(settings, "kb_default_embedding_model_ref", None) or _FALLBACK_EMBEDDING_REF
        )
        options: list[EmbeddingModelOption] = []

        # Mock — always on, two common dims
        for dim in (64, 256):
            ref = f"mock:hash-{dim}"
            options.append(
                EmbeddingModelOption(
                    ref=ref,
                    label=f"Mock · hash-{dim} (deterministic, dev only)",
                    dim=dim,
                    available=True,
                    is_default=ref == default_ref,
                )
            )

        # OpenAI
        openai_key = getattr(settings, "openai_api_key", None)
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
                    available=bool(openai_key),
                    reason=None if openai_key else "set ALLHANDS_OPENAI_API_KEY",
                    is_default=ref == default_ref,
                )
            )

        # Bailian (DashScope)
        dash_key = getattr(settings, "dashscope_api_key", None)
        for model, dim in (
            ("text-embedding-v3", 1024),
            ("text-embedding-v4", 1024),
        ):
            ref = f"bailian:{model}"
            options.append(
                EmbeddingModelOption(
                    ref=ref,
                    label=f"百炼 · {model}",
                    dim=dim,
                    available=bool(dash_key),
                    reason=None if dash_key else "set ALLHANDS_DASHSCOPE_API_KEY",
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
        provider = resolve_provider(ref)
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
        mime = mime_type or (detect_mime(filename) if filename else "text/plain")
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
        return await self._retriever.search(kb_id, query, cfg)

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


__all__ = [
    "DocumentNotFound",
    "EmbeddingModelOption",
    "GrantDenied",
    "KBError",
    "KBNotFound",
    "KnowledgeService",
]
