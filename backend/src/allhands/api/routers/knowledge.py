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

from fastapi import APIRouter, Body, File, Form, HTTPException, UploadFile
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
    opts = _service().list_embedding_models()
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
        raise HTTPException(status_code=404, detail="document not in this kb")
    return _doc_out(doc)


@router.get("/{kb_id}/documents/{doc_id}/text")
async def get_document_text(kb_id: str, doc_id: str) -> dict[str, str]:
    try:
        text = await _service().read_document_text(doc_id)
    except DocumentNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"document_id": doc_id, "content": text}


@router.delete("/{kb_id}/documents/{doc_id}", status_code=204)
async def delete_document(kb_id: str, doc_id: str) -> None:
    await _service().soft_delete_document(doc_id)


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
