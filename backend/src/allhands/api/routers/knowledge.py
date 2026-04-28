"""Knowledge Base REST endpoints — UI-facing surface, parallel to Meta Tools.

Tool-First (P1): every write endpoint here has a same-name Meta Tool in
`execution/tools/meta/knowledge_tools.py`. They share the same
KnowledgeService impl, so behavior cannot drift.

Endpoints:

    GET    /api/kb                                   list
    POST   /api/kb                                   create
    GET    /api/kb/{kb_id}
    DELETE /api/kb/{kb_id}                           soft-delete
    GET    /api/kb/{kb_id}/documents                 list (filter)
    POST   /api/kb/{kb_id}/documents                 multipart upload
    GET    /api/kb/{kb_id}/documents/{doc_id}        meta
    GET    /api/kb/{kb_id}/documents/{doc_id}/text   raw text
    DELETE /api/kb/{kb_id}/documents/{doc_id}        soft-delete
    POST   /api/kb/{kb_id}/search                    {query, top_k} → results
    GET    /api/kb/{kb_id}/grants                    list
    POST   /api/kb/{kb_id}/grants                    create
    DELETE /api/kb/{kb_id}/grants/{grant_id}         revoke
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, Body, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from allhands.core import (
    Document,
    Grant,
    GrantScope,
    KBVisibility,
    KnowledgeBase,
    RetrievalConfig,
    ScoredChunk,
)
from allhands.i18n import t
from allhands.services.knowledge_service import (
    DocumentNotFound,
    KBError,
    KBNotFound,
    KnowledgeService,
)

router = APIRouter(prefix="/kb", tags=["knowledge"])


# ----------------------------------------------------------------------
# Service singleton — process-level, shares the global session_maker.
# ----------------------------------------------------------------------


_svc: KnowledgeService | None = None


def _service() -> KnowledgeService:
    global _svc
    if _svc is None:
        from allhands.persistence.db import get_sessionmaker

        _svc = KnowledgeService(get_sessionmaker())
    return _svc


# ----------------------------------------------------------------------
# Wire models
# ----------------------------------------------------------------------


class KBOut(BaseModel):
    id: str
    name: str
    description: str
    visibility: str
    embedding_model_ref: str
    embedding_dim: int
    document_count: int
    chunk_count: int
    retrieval_config: RetrievalConfig
    created_at: str
    updated_at: str


def _kb_out(k: KnowledgeBase) -> KBOut:
    return KBOut(
        id=k.id,
        name=k.name,
        description=k.description,
        visibility=k.visibility.value,
        embedding_model_ref=k.embedding_model_ref,
        embedding_dim=k.embedding_dim,
        document_count=k.document_count,
        chunk_count=k.chunk_count,
        retrieval_config=k.retrieval_config,
        created_at=k.created_at.isoformat(),
        updated_at=k.updated_at.isoformat(),
    )


class CreateKBPayload(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    description: str = ""
    visibility: str = "private"
    embedding_model_ref: str | None = None


class DocOut(BaseModel):
    id: str
    kb_id: str
    title: str
    mime_type: str
    state: str
    state_error: str | None
    tags: list[str]
    chunk_count: int
    failed_chunk_count: int
    size_bytes: int
    version: int
    pinned: bool
    source_type: str
    source_uri: str | None
    created_at: str
    updated_at: str


def _doc_out(d: Document) -> DocOut:
    return DocOut(
        id=d.id,
        kb_id=d.kb_id,
        title=d.title,
        mime_type=d.mime_type,
        state=d.state.value,
        state_error=d.state_error,
        tags=list(d.tags),
        chunk_count=d.chunk_count,
        failed_chunk_count=d.failed_chunk_count,
        size_bytes=d.size_bytes,
        version=d.version,
        pinned=d.pinned,
        source_type=d.source_type.value,
        source_uri=d.source_uri,
        created_at=d.created_at.isoformat(),
        updated_at=d.updated_at.isoformat(),
    )


class SearchPayload(BaseModel):
    query: str
    top_k: int | None = None


class ScoredChunkOut(BaseModel):
    chunk_id: int
    document_id: str
    score: float
    text: str
    section_path: str | None
    page: int | None
    citation: str
    bm25_rank: int | None
    vector_rank: int | None


def _scored_out(r: ScoredChunk) -> ScoredChunkOut:
    return ScoredChunkOut(
        chunk_id=r.chunk.id,
        document_id=r.chunk.document_id,
        score=r.score,
        text=r.chunk.text,
        section_path=r.chunk.section_path,
        page=r.chunk.page,
        citation=r.citation,
        bm25_rank=r.bm25_rank,
        vector_rank=r.vector_rank,
    )


class CreateGrantPayload(BaseModel):
    scope: str
    employee_id: str | None = None
    skill_id: str | None = None
    expires_at: str | None = None


class GrantOut(BaseModel):
    id: str
    kb_id: str
    scope: str
    employee_id: str | None
    skill_id: str | None
    expires_at: str | None
    created_at: str


def _grant_out(g: Grant) -> GrantOut:
    return GrantOut(
        id=g.id,
        kb_id=g.kb_id,
        scope=g.scope.value,
        employee_id=g.employee_id,
        skill_id=g.skill_id,
        expires_at=g.expires_at.isoformat() if g.expires_at else None,
        created_at=g.created_at.isoformat(),
    )


# ----------------------------------------------------------------------
# KB CRUD
# ----------------------------------------------------------------------


class EmbeddingModelOut(BaseModel):
    ref: str
    label: str
    dim: int
    available: bool
    reason: str | None
    is_default: bool


@router.get("/embedding-models")
async def list_embedding_models() -> list[EmbeddingModelOut]:
    """List embedding models the create-KB form can offer.

    Static discovery: doesn't probe any provider HTTP endpoint. UI greys
    out options where ``available=false`` and surfaces ``reason`` so the
    user knows which env var to set.
    """
    opts = await _service().list_embedding_models()
    return [
        EmbeddingModelOut(
            ref=o.ref,
            label=o.label,
            dim=o.dim,
            available=o.available,
            reason=o.reason,
            is_default=o.is_default,
        )
        for o in opts
    ]


@router.get("")
async def list_kbs() -> list[KBOut]:
    kbs = await _service().list_kbs()
    return [_kb_out(k) for k in kbs]


@router.post("", status_code=201)
async def create_kb(payload: CreateKBPayload) -> KBOut:
    try:
        kb = await _service().create_kb(
            name=payload.name,
            description=payload.description,
            visibility=KBVisibility(payload.visibility),
            embedding_model_ref=payload.embedding_model_ref,
        )
    except KBError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _kb_out(kb)


@router.get("/{kb_id}")
async def get_kb(kb_id: str) -> KBOut:
    try:
        return _kb_out(await _service().get_kb(kb_id))
    except KBNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/{kb_id}", status_code=204)
async def delete_kb(kb_id: str) -> None:
    await _service().soft_delete_kb(kb_id)


class UpdateConfigPayload(BaseModel):
    bm25_weight: float | None = None
    vector_weight: float | None = None
    top_k: int | None = None
    min_score: float | None = None
    rerank_top_in: int | None = None
    reranker: str | None = None


@router.patch("/{kb_id}/retrieval-config")
async def update_retrieval_config(kb_id: str, payload: UpdateConfigPayload) -> KBOut:
    """Patch the KB's retrieval config; only fields present in the payload
    overwrite. Returns the full KB with the merged config so the UI can
    render the new state without an extra round-trip."""
    try:
        kb = await _service().get_kb(kb_id)
    except KBNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    merged = kb.retrieval_config.model_dump()
    for k, v in payload.model_dump(exclude_none=True).items():
        merged[k] = v
    new_cfg = RetrievalConfig.model_validate(merged)
    out = await _service().update_retrieval_config(kb_id, new_cfg)
    return _kb_out(out)


# ----------------------------------------------------------------------
# Documents
# ----------------------------------------------------------------------


@router.get("/{kb_id}/documents")
async def list_documents(
    kb_id: str,
    title_prefix: str | None = None,
    tag: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[DocOut]:
    docs = await _service().list_documents(
        kb_id, title_prefix=title_prefix, tag=tag, limit=limit, offset=offset
    )
    return [_doc_out(d) for d in docs]


class IngestUrlPayload(BaseModel):
    url: str
    title: str | None = None
    tags: list[str] | None = None


@router.post("/{kb_id}/ingest-url", status_code=201)
async def ingest_url(kb_id: str, payload: IngestUrlPayload) -> DocOut:
    """Fetch a URL and ingest as document. v0 only handles HTML pages
    that don't require JS rendering."""
    try:
        doc = await _service().ingest_url(
            kb_id, payload.url, title=payload.title, tags=payload.tags
        )
    except KBNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=400, detail=t("errors.kb_fetch_failed", detail=str(exc))
        ) from exc
    return _doc_out(doc)


@router.post("/{kb_id}/documents", status_code=201)
async def upload_document(
    kb_id: str,
    file: UploadFile = File(...),
    title: str | None = Form(None),
    tags: str | None = Form(None),
) -> DocOut:
    """Multipart upload. `title` defaults to the filename. `tags` is a comma-list."""
    raw = await file.read()
    try:
        doc = await _service().upload_document(
            kb_id,
            title=title or file.filename or "untitled",
            content_bytes=raw,
            filename=file.filename,
            mime_type=file.content_type,
            tags=[t.strip() for t in tags.split(",")] if tags else None,
        )
    except KBNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except KBError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _doc_out(doc)


@router.get("/{kb_id}/documents/{doc_id}")
async def get_document(kb_id: str, doc_id: str) -> DocOut:
    try:
        doc = await _service().get_document(doc_id)
    except DocumentNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if doc.kb_id != kb_id:
        raise HTTPException(status_code=404, detail=t("errors.not_found.document_in_kb"))
    return _doc_out(doc)


@router.get("/{kb_id}/documents/{doc_id}/text")
async def get_document_text(kb_id: str, doc_id: str) -> dict[str, str]:
    try:
        text = await _service().read_document_text(doc_id)
    except DocumentNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"document_id": doc_id, "content": text}


class ChunkOut(BaseModel):
    id: int
    ordinal: int
    text: str
    token_count: int
    section_path: str | None
    span_start: int
    span_end: int
    page: int | None


@router.get("/{kb_id}/documents/{doc_id}/chunks")
async def list_document_chunks(kb_id: str, doc_id: str) -> list[ChunkOut]:
    """All chunks of a document in ordinal order. Used by the doc drawer
    "分片" tab so users can verify how the chunker split their file."""
    try:
        doc = await _service().get_document(doc_id)
    except DocumentNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if doc.kb_id != kb_id:
        raise HTTPException(status_code=404, detail=t("errors.not_found.document_in_kb"))
    chunks = await _service().list_chunks_for_document(doc_id)
    return [
        ChunkOut(
            id=c.id,
            ordinal=c.ordinal,
            text=c.text,
            token_count=c.token_count,
            section_path=c.section_path,
            span_start=c.span_start,
            span_end=c.span_end,
            page=c.page,
        )
        for c in chunks
    ]


@router.delete("/{kb_id}/documents/{doc_id}", status_code=204)
async def delete_document(kb_id: str, doc_id: str) -> None:
    await _service().soft_delete_document(doc_id)


@router.post("/{kb_id}/documents/{doc_id}/reindex")
async def reindex_document(kb_id: str, doc_id: str) -> DocOut:
    """Wipe + re-run ingest. Surfaces the resulting Document state."""
    try:
        doc = await _service().reindex_document(doc_id)
    except DocumentNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _doc_out(doc)


@router.post("/{kb_id}/documents/{doc_id}/suggest-tags")
async def suggest_tags(kb_id: str, doc_id: str) -> dict[str, list[str]]:
    """LLM-suggested tags for a document. Empty list means the LLM was
    unreachable or returned nothing useful — UI hides the chip row."""
    try:
        tags = await _service().suggest_tags_for_document(doc_id, max_tags=3)
    except DocumentNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"tags": tags}


class TagPatchPayload(BaseModel):
    add: list[str] | None = None
    remove: list[str] | None = None
    replace: list[str] | None = None


@router.patch("/{kb_id}/documents/{doc_id}/tags")
async def patch_document_tags(kb_id: str, doc_id: str, payload: TagPatchPayload) -> DocOut:
    """Add / remove / replace tags on a single document.

    Bulk paths (e.g. tag N selected docs) issue this in a loop client-side
    — no dedicated bulk endpoint yet because the per-doc op is cheap and
    the front-end wants per-row error tolerance anyway.
    """
    try:
        doc = await _service().update_document_tags(
            doc_id, add=payload.add, remove=payload.remove, replace=payload.replace
        )
    except DocumentNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _doc_out(doc)


# ----------------------------------------------------------------------
# Search
# ----------------------------------------------------------------------


@router.post("/{kb_id}/search")
async def search_kb(kb_id: str, payload: SearchPayload = Body(...)) -> list[ScoredChunkOut]:
    try:
        results = await _service().search(kb_id, payload.query, top_k=payload.top_k)
    except KBNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return [_scored_out(r) for r in results]


class AskHistoryTurn(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class AskPayload(BaseModel):
    question: str
    top_k: int | None = 5
    model_ref: str | None = None
    history: list[AskHistoryTurn] | None = None


class AskSourceOut(BaseModel):
    n: int
    chunk_id: int
    doc_id: str
    section_path: str | None
    page: int | None
    citation: str
    text: str
    score: float


class AskOut(BaseModel):
    answer: str
    sources: list[AskSourceOut]
    used_model: str | None
    latency_ms: float


@router.post("/{kb_id}/ask")
async def ask_kb(kb_id: str, payload: AskPayload) -> AskOut:
    """RAG QA over a KB. Search → context → LLM → answer with [N] cites
    pointing into the returned `sources` list."""
    try:
        out = await _service().ask(
            kb_id,
            payload.question,
            top_k=payload.top_k or 5,
            model_ref=payload.model_ref,
            history=[h.model_dump() for h in payload.history] if payload.history else None,
        )
    except KBNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except KBError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    raw_sources = out["sources"]
    sources_list: list[AskSourceOut] = []
    if isinstance(raw_sources, list):
        for s in raw_sources:
            if isinstance(s, dict):
                sources_list.append(AskSourceOut(**s))
    return AskOut(
        answer=str(out["answer"]),
        sources=sources_list,
        used_model=out["used_model"] if isinstance(out["used_model"], str) else None,
        latency_ms=float(out["latency_ms"]) if isinstance(out["latency_ms"], (int, float)) else 0.0,
    )


@router.post("/{kb_id}/ask/stream")
async def ask_kb_stream(kb_id: str, payload: AskPayload) -> StreamingResponse:
    """Streaming RAG QA — Server-Sent Events.

    Frame protocol (one JSON object per ``data:`` line, terminated by a
    blank line per the SSE spec):

    - ``{"event": "sources", "sources": [...]}`` (always first)
    - ``{"event": "delta", "text": "..."}`` (zero or more)
    - ``{"event": "done", "used_model": "...", "latency_ms": 123.4}`` (terminal)
    - ``{"event": "error", "message": "..."}`` (terminal — replaces ``done``)

    Front-end iterates with ``ReadableStream`` + a small SSE splitter; the
    ``[N]`` chip rewrite happens after ``done`` so partial deltas don't
    flicker. KB existence and "no chat provider" errors are reported as
    in-stream ``error`` frames (HTTP status is still 200) — keeps the
    fetch promise resolved and lets the UI render the error inline.
    """

    async def event_source() -> AsyncIterator[bytes]:
        try:
            async for frame in _service().ask_stream(
                kb_id,
                payload.question,
                top_k=payload.top_k or 5,
                model_ref=payload.model_ref,
                history=([h.model_dump() for h in payload.history] if payload.history else None),
            ):
                yield f"data: {json.dumps(frame, ensure_ascii=False)}\n\n".encode()
        except Exception as exc:
            err = {"event": "error", "message": f"streaming aborted: {exc}"}
            yield f"data: {json.dumps(err, ensure_ascii=False)}\n\n".encode()

    return StreamingResponse(
        event_source(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",  # disable nginx buffering when proxied
        },
    )


class HealthOut(BaseModel):
    doc_count: int
    chunk_count: int
    token_sum: int
    last_activity: str | None
    daily_doc_counts: list[dict[str, object]]
    top_tags: list[dict[str, object]]
    mime_breakdown: list[dict[str, object]]
    chunks_missing_embeddings: int


@router.get("/{kb_id}/health")
async def kb_health(kb_id: str, days: int = 30) -> HealthOut:
    """Sidebar "health" snapshot — totals, activity sparkline, top tags."""
    try:
        h = await _service().get_kb_health(kb_id, days=days)
    except KBNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return HealthOut(**h)


class ReembedOut(BaseModel):
    processed: int
    succeeded: int
    failed: int


class SwitchEmbeddingPayload(BaseModel):
    new_ref: str


class SwitchEmbeddingOut(BaseModel):
    kb: KBOut
    reembed: ReembedOut


@router.post("/{kb_id}/embedding-model")
async def switch_embedding_model(kb_id: str, payload: SwitchEmbeddingPayload) -> SwitchEmbeddingOut:
    """Re-bind a KB to a different embedding model + reindex all docs.

    Synchronous in v0 — fine for small KBs. Returns the updated KB row and
    the per-doc reembed result so the UI can show "switched + N docs
    re-indexed" in one response.
    """
    try:
        out = await _service().switch_embedding_model(kb_id, payload.new_ref)
    except KBNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except KBError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    kb_dict = out["kb"]
    reembed_dict = out["reembed"]
    if not isinstance(kb_dict, dict) or not isinstance(reembed_dict, dict):
        raise HTTPException(status_code=500, detail=t("errors.malformed_response"))
    return SwitchEmbeddingOut(
        kb=KBOut(**kb_dict),
        reembed=ReembedOut(**reembed_dict),
    )


@router.post("/{kb_id}/reembed-all")
async def reembed_all(kb_id: str) -> ReembedOut:
    """Re-run ingest for every doc in the KB. Backfills missing vectors
    (e.g. after fixing the embedding provider config). Synchronous in v0
    — fine for small KBs (<100 docs); needs a BackgroundTasks queue when
    we go bigger."""
    try:
        result = await _service().reembed_all(kb_id)
    except KBNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ReembedOut(**result)


@router.get("/{kb_id}/starter-questions")
async def starter_questions(kb_id: str, limit: int = 4) -> dict[str, list[str]]:
    """Return ``limit`` LLM-suggested starter questions for the KB.

    Cached per (kb, updated_at, limit). Empty list when KB has no docs
    or no chat provider is configured — UI hides the chip row gracefully.
    """
    try:
        qs = await _service().suggest_starter_questions(kb_id, limit=limit)
    except KBNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"questions": qs}


class FollowUpPayload(BaseModel):
    question: str
    answer: str
    limit: int = 3


@router.post("/{kb_id}/follow-ups")
async def follow_up_questions(kb_id: str, payload: FollowUpPayload) -> dict[str, list[str]]:
    """LLM-suggested follow-up questions for an Ask turn.

    Empty list on no-provider / LLM error — UI hides the row gracefully.
    """
    try:
        qs = await _service().suggest_follow_up_questions(
            kb_id,
            question=payload.question,
            answer=payload.answer,
            limit=payload.limit,
        )
    except KBNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"questions": qs}


class DiagnoseOut(BaseModel):
    bm25_only: list[ScoredChunkOut]
    vector_only: list[ScoredChunkOut]
    hybrid: list[ScoredChunkOut]


@router.post("/{kb_id}/search/diagnose")
async def diagnose_search(kb_id: str, payload: SearchPayload = Body(...)) -> DiagnoseOut:
    """Same query under three lenses (BM25-only / vector-only / hybrid).
    For the recall-test UI side-by-side comparison."""
    try:
        out = await _service().diagnose_search(kb_id, payload.query, top_k=payload.top_k or 8)
    except KBNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return DiagnoseOut(
        bm25_only=[_scored_out(r) for r in out["bm25_only"]],
        vector_only=[_scored_out(r) for r in out["vector_only"]],
        hybrid=[_scored_out(r) for r in out["hybrid"]],
    )


class StatsRecent(BaseModel):
    at: str
    query: str
    latency_ms: float
    hits: int


class StatsOut(BaseModel):
    count: int
    avg_latency_ms: float | None
    recent: list[StatsRecent]


@router.get("/{kb_id}/stats")
async def get_kb_stats(kb_id: str) -> StatsOut:
    """In-process search stats (this process only · ring buffer of 50)."""
    s = _service().get_search_stats(kb_id)
    return StatsOut(
        count=s.count,
        avg_latency_ms=s.avg_latency_ms,
        recent=[
            StatsRecent(at=r.at, query=r.query, latency_ms=r.latency_ms, hits=r.hits)
            for r in s.recent
        ],
    )


# ----------------------------------------------------------------------
# Grants
# ----------------------------------------------------------------------


@router.get("/{kb_id}/grants")
async def list_grants(kb_id: str) -> list[GrantOut]:
    return [_grant_out(g) for g in await _service().list_grants(kb_id)]


@router.post("/{kb_id}/grants", status_code=201)
async def create_grant(kb_id: str, payload: CreateGrantPayload) -> GrantOut:
    from datetime import datetime

    exp = datetime.fromisoformat(payload.expires_at) if payload.expires_at else None
    grant = await _service().grant_permission(
        kb_id,
        scope=GrantScope(payload.scope),
        employee_id=payload.employee_id,
        skill_id=payload.skill_id,
        expires_at=exp,
    )
    return _grant_out(grant)


@router.delete("/{kb_id}/grants/{grant_id}", status_code=204)
async def revoke_grant(kb_id: str, grant_id: str) -> None:
    await _service().revoke_grant(grant_id)
