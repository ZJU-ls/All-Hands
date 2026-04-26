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
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

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


_ASK_SYSTEM_PROMPT = (
    "你是一个严谨的知识库助手。只用下面给出的上下文片段回答用户的问题。"
    "在每个引用了上下文事实的句尾,标注片段编号,如 [1]、[2]。"
    "如果上下文里没有答案,直接说不知道,不要编造。"
    "回答用中文。多轮对话里,沿用同一份上下文片段编号,不要重新编号。"
)


def _build_ask_prompt(question: str, hits: list[ScoredChunk]) -> tuple[str, str]:
    """Assemble the (system, user) prompt pair for an Ask turn."""
    context_block = "\n\n".join(f"[{i + 1}] {r.chunk.text}" for i, r in enumerate(hits))
    user = f"上下文:\n\n{context_block}\n\n问题:{question}"
    return _ASK_SYSTEM_PROMPT, user


def _serialise_sources(hits: list[ScoredChunk]) -> list[dict[str, object]]:
    return [
        {
            "n": i + 1,
            "chunk_id": r.chunk.id,
            "doc_id": r.chunk.document_id,
            "section_path": r.chunk.section_path,
            "page": r.chunk.page,
            "citation": r.citation,
            "text": r.chunk.text,
            "score": round(r.score, 4),
        }
        for i, r in enumerate(hits)
    ]


def _build_messages(system: str, user: str, history: list[dict[str, str]] | None) -> list[Any]:
    """Map (system, optional history, user) to LangChain message objects.

    History format: ``[{role: "user"|"assistant", content: str}, ...]``.
    Unknown roles are skipped — we don't want a malformed entry to crash
    the whole turn. The current question always lives in the trailing
    ``HumanMessage`` so retrieval context binds to *this* turn.
    """
    from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

    msgs: list[Any] = [SystemMessage(content=system)]
    if history:
        for h in history:
            role = h.get("role")
            content = h.get("content", "")
            if role == "user":
                msgs.append(HumanMessage(content=content))
            elif role == "assistant":
                msgs.append(AIMessage(content=content))
    msgs.append(HumanMessage(content=user))
    return msgs


# In-process cache for `suggest_starter_questions`. Key = (kb_id,
# kb.updated_at iso, limit) → questions list. KB writes bump
# ``updated_at`` so adding a doc invalidates the cache the next call.
# Dict-based, single-process; that's fine for v0 — when we go multi-worker
# we can move this to redis with the same key shape.
_STARTER_CACHE: dict[tuple[str, str, int], list[str]] = {}


class KBError(DomainError):
    """KB-layer validation / not-found error."""


class KBNotFound(KBError):
    pass


class DocumentNotFound(KBError):
    pass


class _NoChatProvider(Exception):
    """Internal marker — no usable LLMProvider for the Ask path."""


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

    async def ingest_url(
        self,
        kb_id: str,
        url: str,
        *,
        title: str | None = None,
        tags: list[str] | None = None,
        timeout_seconds: float = 20.0,
    ) -> Document:
        """Fetch a URL, treat the body as HTML, ingest as a document.

        Reuses ``upload_document`` so chunking / embedding pipeline is
        identical. Title falls back to the URL itself; mime defaults to
        ``text/html`` so the html parser handles it. The fetch is via
        httpx with redirect-follow + a generous timeout — websites that
        require JS rendering won't extract well, but raw HTML pages
        (docs / wikis / blog posts) work fine.
        """
        import httpx

        await self.get_kb(kb_id)
        async with httpx.AsyncClient(follow_redirects=True, timeout=timeout_seconds) as client:
            r = await client.get(url, headers={"user-agent": "allhands-kb/0.1"})
            r.raise_for_status()
            body = r.content
            mime = r.headers.get("content-type", "text/html").split(";")[0].strip()

        derived_title = title or _derive_title_from_url(url)
        return await self.upload_document(
            kb_id,
            title=derived_title,
            content_bytes=body,
            filename=f"{derived_title}.html",
            mime_type=mime or "text/html",
            source_type=SourceType.URL,
            source_uri=url,
            tags=tags,
        )

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

    async def reindex_document(self, document_id: str) -> Document:
        """Re-run ingest pipeline for a doc. Wipes its chunks + embedding
        jobs first, resets state to PENDING, then runs the orchestrator
        from scratch. Useful for FAILED docs after the user fixed env
        (e.g. installed pypdf) or for re-chunking after settings changed."""
        doc = await self.get_document(document_id)
        async with self._session_maker() as s:
            from allhands.persistence.knowledge_repos import (
                SqlChunkRepo,
                SqlDocumentRepo,
                SqlEmbeddingJobRepo,
                SqlKnowledgeBaseRepo,
            )

            chunk_repo = SqlChunkRepo(s)
            removed = await chunk_repo.delete_for_document(document_id)
            jobs = SqlEmbeddingJobRepo(s)
            # Reset any jobs that exist for this doc (lease/done/failed all
            # become queued again — but we'll wipe then re-enqueue, so just
            # delete by setting them all to a dead state via reset).
            await jobs.reset_failed_for_doc(document_id)
            doc_repo = SqlDocumentRepo(s)
            await doc_repo.update_state(
                document_id,
                DocumentState.PENDING,
                error=None,
                chunk_count=0,
                failed_chunk_count=0,
            )
            # Counters: subtract the removed chunks from the KB total.
            if removed:
                await SqlKnowledgeBaseRepo(s).bump_counters(doc.kb_id, docs=0, chunks=-removed)
            await s.commit()

        abs_path = self._data_dir / "kb" / doc.file_path
        with contextlib.suppress(Exception):
            await self._ingest.ingest_document(document_id, file_path_abs=abs_path)
        return await self.get_document(document_id)

    async def update_document_tags(
        self,
        document_id: str,
        *,
        add: list[str] | None = None,
        remove: list[str] | None = None,
        replace: list[str] | None = None,
    ) -> Document:
        """Mutate a document's tag set.

        Three exclusive shapes:
        - ``add``: union with current tags (deduped, order preserved).
        - ``remove``: drop any matching tags.
        - ``replace``: set tags wholesale (overrides current list).

        Returns the post-update document. Bumps ``updated_at`` so KB
        derived caches (starter-questions, sidebar tag chips) refresh
        on next read.
        """
        doc = await self.get_document(document_id)
        if replace is not None:
            new_tags = list(dict.fromkeys(t.strip() for t in replace if t.strip()))
        else:
            existing = list(doc.tags)
            if remove:
                drop = {t.strip() for t in remove}
                existing = [t for t in existing if t not in drop]
            if add:
                seen = set(existing)
                for t in add:
                    cleaned = t.strip()
                    if cleaned and cleaned not in seen:
                        existing.append(cleaned)
                        seen.add(cleaned)
            new_tags = existing

        updated = doc.model_copy(update={"tags": new_tags, "updated_at": datetime.now(UTC)})
        async with self._session_maker() as s:
            await SqlDocumentRepo(s).upsert(updated)
            await s.commit()
        return updated

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

    async def ask(
        self,
        kb_id: str,
        question: str,
        *,
        top_k: int = 5,
        model_ref: str | None = None,
        history: list[dict[str, str]] | None = None,
    ) -> dict[str, object]:
        """RAG QA: search → assemble context → LLM with citation prompt.

        ``history`` is an optional list of ``{role, content}`` dicts from
        prior turns of the same KB Ask session. When present, the LLM
        sees the prior Q&A as conversational context so follow-up
        pronouns ("它", "比 X 呢") resolve correctly. Retrieval still
        runs on the latest question only — chunks from the previous turn
        are not re-injected (avoids stale context bloat).
        """
        kb = await self.get_kb(kb_id)
        cfg = RetrievalConfig.model_validate({**kb.retrieval_config.model_dump(), "top_k": top_k})

        import time

        t0 = time.monotonic()
        hits = await self._retriever.search(kb_id, question, cfg)
        if not hits:
            return {
                "answer": "知识库里没有跟这个问题相关的内容。换个说法,或者补一份资料试试。",
                "sources": [],
                "used_model": None,
                "latency_ms": round((time.monotonic() - t0) * 1000, 1),
            }

        system, user = _build_ask_prompt(question, hits)

        try:
            answer_text, used_model = await self._call_chat_llm(
                system, user, model_ref=model_ref, history=history
            )
        except _NoChatProvider:
            raise KBError(
                "还没有可用的对话模型 · 去 /gateway 添加一个 OpenAI / 阿里云 / Anthropic provider"
            ) from None

        return {
            "answer": answer_text,
            "sources": _serialise_sources(hits),
            "used_model": used_model,
            "latency_ms": round((time.monotonic() - t0) * 1000, 1),
        }

    async def ask_stream(
        self,
        kb_id: str,
        question: str,
        *,
        top_k: int = 5,
        model_ref: str | None = None,
        history: list[dict[str, str]] | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        """Streaming variant of :meth:`ask`.

        Yields a sequence of envelope dicts that the SSE encoder serialises:

        - ``{"event": "sources", "sources": [...], "kb": {"id"...}}`` first,
          so the UI can paint the citations area before any text arrives.
        - ``{"event": "delta", "text": "..."}`` per LLM token chunk.
          Multiple deltas may be coalesced upstream — order is preserved.
        - ``{"event": "done", "used_model": str | None, "latency_ms": float}``
          terminal frame after the last delta.

        On hard failure yields ``{"event": "error", "message": str}`` and
        terminates without a ``done`` frame, so the client can distinguish
        "model finished cleanly" from "stream aborted mid-flight".
        """
        try:
            kb = await self.get_kb(kb_id)
        except KBError as exc:
            yield {"event": "error", "message": str(exc)}
            return
        cfg = RetrievalConfig.model_validate({**kb.retrieval_config.model_dump(), "top_k": top_k})

        import time

        t0 = time.monotonic()
        hits = await self._retriever.search(kb_id, question, cfg)
        sources = _serialise_sources(hits)
        yield {"event": "sources", "sources": sources}

        if not hits:
            yield {
                "event": "delta",
                "text": "知识库里没有跟这个问题相关的内容。换个说法,或者补一份资料试试。",
            }
            yield {
                "event": "done",
                "used_model": None,
                "latency_ms": round((time.monotonic() - t0) * 1000, 1),
            }
            return

        system, user = _build_ask_prompt(question, hits)

        try:
            used_model: str | None = None
            async for piece, model_used in self._call_chat_llm_stream(
                system, user, model_ref=model_ref, history=history
            ):
                if piece:
                    yield {"event": "delta", "text": piece}
                if model_used:
                    used_model = model_used
        except _NoChatProvider:
            yield {
                "event": "error",
                "message": (
                    "还没有可用的对话模型 · 去 /gateway 添加一个 "
                    "OpenAI / 阿里云 / Anthropic provider"
                ),
            }
            return
        except Exception as exc:
            _logger.exception("kb.ask_stream LLM error")
            yield {"event": "error", "message": f"模型调用失败:{exc}"}
            return

        yield {
            "event": "done",
            "used_model": used_model,
            "latency_ms": round((time.monotonic() - t0) * 1000, 1),
        }

    async def _call_chat_llm(
        self,
        system: str,
        user: str,
        *,
        model_ref: str | None = None,
        history: list[dict[str, str]] | None = None,
    ) -> tuple[str, str]:
        """Pick first usable LLMProvider, build LangChain chat model, invoke."""
        provider, ref = await self._pick_chat_provider(model_ref)

        from allhands.execution.llm_factory import build_llm

        llm = build_llm(provider, ref)
        messages = _build_messages(system, user, history)
        result = await llm.ainvoke(messages)
        text = getattr(result, "content", "") or ""
        if isinstance(text, list):
            text = "".join(b.get("text", "") if isinstance(b, dict) else str(b) for b in text)
        return str(text), ref

    async def _call_chat_llm_stream(
        self,
        system: str,
        user: str,
        *,
        model_ref: str | None = None,
        history: list[dict[str, str]] | None = None,
    ) -> AsyncIterator[tuple[str, str]]:
        """Stream text chunks from LangChain ``astream``.

        Yields ``(piece, model_ref)`` tuples — ``model_ref`` is only set on
        the first non-empty piece so the caller can record it without
        repeating per-chunk. ``piece`` may be empty for control frames
        (reasoning tokens etc.) which we drop.
        """
        provider, ref = await self._pick_chat_provider(model_ref)

        from allhands.execution.llm_factory import build_llm

        llm = build_llm(provider, ref)
        messages = _build_messages(system, user, history)
        emitted = False
        async for chunk in llm.astream(messages):
            text = getattr(chunk, "content", "") or ""
            if isinstance(text, list):
                # Anthropic streams content blocks; flatten to plain text.
                text = "".join(b.get("text", "") if isinstance(b, dict) else str(b) for b in text)
            if not text:
                continue
            yield text, (ref if not emitted else "")
            emitted = True

    async def _pick_chat_provider(self, model_ref: str | None) -> tuple[Any, str]:
        from allhands.persistence.sql_repos import SqlLLMProviderRepo

        async with self._session_maker() as s:
            providers = await SqlLLMProviderRepo(s).list_all()
        usable = [p for p in providers if p.enabled and p.api_key]
        if not usable:
            raise _NoChatProvider()
        provider = usable[0]

        ref = model_ref or get_settings().default_model_ref
        if not ref:
            from allhands.core.provider_presets import preset_for

            ref = preset_for(provider.kind).default_model
        return provider, ref

    async def get_kb_health(self, kb_id: str, *, days: int = 30) -> dict[str, Any]:
        """Snapshot of a KB for the sidebar "health" card.

        Returns:
        - ``doc_count`` / ``chunk_count``: aggregates straight from KB row
        - ``token_sum``: sum of ``chunk.token_count`` across all chunks (not
          stored on KB so we sum on the fly — cheap because v0 KBs are small)
        - ``last_activity``: ISO of latest ``updated_at`` across docs;
          ``None`` for empty KB.
        - ``daily_doc_counts``: ``[{date, count}, …]`` of length ``days``,
          oldest day first. Today's bucket is the rightmost. Drives the
          sparkline.
        - ``top_tags``: ``[{tag, count}, …]`` top 5 by occurrence.
        - ``mime_breakdown``: ``[{mime, count}, …]`` sorted desc.

        Cheap enough to call on every sidebar render (≤ 1 select + a few
        aggregations); we don't bother caching at this scale.
        """
        from collections import Counter
        from datetime import timedelta

        kb = await self.get_kb(kb_id)
        docs = await self.list_documents(kb_id, limit=1000)

        # Token sum needs chunk rows. One query per doc would be N round
        # trips; instead do a single aggregate via the chunk repo for the
        # whole KB.
        async with self._session_maker() as s:
            from sqlalchemy import func, select

            from allhands.persistence.orm.knowledge_orm import ChunkRow

            total_tokens = (
                await s.execute(
                    select(func.coalesce(func.sum(ChunkRow.token_count), 0)).where(
                        ChunkRow.kb_id == kb_id
                    )
                )
            ).scalar() or 0

        last_activity = max((d.updated_at for d in docs), default=None)

        today = datetime.now(UTC).date()
        bucket_counts: Counter[str] = Counter()
        for d in docs:
            day = d.created_at.date()
            delta = (today - day).days
            if 0 <= delta < days:
                bucket_counts[day.isoformat()] += 1
        daily = [
            {
                "date": (today - timedelta(days=days - 1 - i)).isoformat(),
                "count": bucket_counts.get((today - timedelta(days=days - 1 - i)).isoformat(), 0),
            }
            for i in range(days)
        ]

        tag_counter: Counter[str] = Counter()
        for d in docs:
            tag_counter.update(d.tags)
        top_tags = [{"tag": tag, "count": count} for tag, count in tag_counter.most_common(5)]

        mime_counter: Counter[str] = Counter()
        for d in docs:
            mime_counter[d.mime_type] += 1
        mime_breakdown = [
            {"mime": mime, "count": count}
            for mime, count in sorted(mime_counter.items(), key=lambda kv: -kv[1])
        ]

        return {
            "doc_count": kb.document_count,
            "chunk_count": kb.chunk_count,
            "token_sum": int(total_tokens),
            "last_activity": last_activity.isoformat() if last_activity else None,
            "daily_doc_counts": daily,
            "top_tags": top_tags,
            "mime_breakdown": mime_breakdown,
        }

    async def suggest_starter_questions(
        self, kb_id: str, *, limit: int = 4, model_ref: str | None = None
    ) -> list[str]:
        """Return a small set of LLM-generated "starter questions" for a KB.

        The Ask mode opens onto a blank canvas — users with a fresh KB
        often don't know what to ask. NotebookLM / Glean both surface a
        handful of suggested prompts derived from the corpus; we do the
        same: collect doc titles + top section headings, ask the chat LLM
        to propose ``limit`` short questions, return them as plain strings.

        Cache key = ``(kb_id, kb.updated_at, limit)`` — the ``updated_at``
        bumps whenever a doc is added / removed, so adding a new PDF
        invalidates stale suggestions automatically. No LLM call when the
        KB has no documents (returns an empty list — UI shows the empty
        starter copy instead).
        """
        kb = await self.get_kb(kb_id)
        cache_key = (kb_id, kb.updated_at.isoformat(), limit)
        cached = _STARTER_CACHE.get(cache_key)
        if cached is not None:
            return cached

        docs = await self.list_documents(kb_id, limit=12)
        if not docs:
            return []

        # Lightweight corpus snapshot — titles + the first section path of
        # each doc keep the prompt under ~1k tokens regardless of corpus
        # size. Falling back to the title alone when no chunks exist yet.
        corpus_lines: list[str] = []
        for d in docs:
            chunks = await self.list_chunks_for_document(d.id)
            sections = [c.section_path for c in chunks if c.section_path]
            top_sections = list(dict.fromkeys(sections))[:3]
            if top_sections:
                corpus_lines.append(f"- {d.title} :: {' / '.join(top_sections)}")
            else:
                corpus_lines.append(f"- {d.title}")

        system = (
            "You generate starter questions a curious user might ask of a "
            "private knowledge base. Be specific to the listed documents — "
            "no generic 'what is this' fluff. Output ONE question per line, "
            "no numbering, no quotes, no leading dash. Match the language "
            "of the document titles (Chinese in → Chinese out)."
        )
        user = (
            f"Knowledge base: {kb.name}\n"
            f"Documents (title :: top sections):\n"
            + "\n".join(corpus_lines)
            + f"\n\nGenerate exactly {limit} short, useful starter questions."
        )

        try:
            text, _ = await self._call_chat_llm(system, user, model_ref=model_ref)
        except _NoChatProvider:
            # Graceful degrade: fall back to "在 <title> 里说了什么?" for
            # the first ``limit`` docs. Better than a blank panel.
            return [f"{d.title} 里讲了什么?" for d in docs[:limit]]
        except Exception:
            _logger.exception("kb.suggest_starter_questions LLM error")
            return [f"{d.title} 里讲了什么?" for d in docs[:limit]]

        questions = [
            line.strip().lstrip("-•*0123456789.) ").strip()
            for line in text.splitlines()
            if line.strip()
        ]
        questions = [q for q in questions if q][:limit]
        _STARTER_CACHE[cache_key] = questions
        return questions

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


def _derive_title_from_url(url: str) -> str:
    """Best-effort human title from a URL: last path segment with hyphens
    swapped to spaces, falling back to the host. Keeps the create-doc UX
    pleasant when the user just pastes a link."""
    from urllib.parse import unquote, urlparse

    p = urlparse(url)
    last = (p.path or "").rstrip("/").split("/")[-1]
    if last:
        return unquote(last).replace("-", " ").replace("_", " ")[:200]
    return p.netloc or url


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
