"""Knowledge Base domain models (L4).

A KB is a workspace-scoped collection of long-lived reference documents
that agents can search through (kb_search) and, with permission, write to
(kb_create_document). Documents go through an ingest state machine:
PENDING → PARSING → CHUNKING → INDEXING → READY (or FAILED).

Storage layout — files on disk, metadata in SQL:
  data/kb/<kb_id>/<doc_id>/v<N>.<ext>      raw uploaded bytes
  documents.file_path                       relative path under data/kb/
  chunks.text                               extracted text (FTS5 indexed)
  chunks.embedding                          float32 vector (BLOB) —
                                            for v0 a per-row BLOB; later
                                            swapped to per-KB sqlite-vec
                                            virtual table.

See `docs/specs/kb/2026-04-25-knowledge-base-design.md` for full spec.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field


class KBVisibility(StrEnum):
    PRIVATE = "private"  # only owner
    WORKSPACE = "workspace"  # all employees in workspace
    PUBLIC = "public"  # cross-workspace, read-only (v1+)


class DocumentState(StrEnum):
    PENDING = "pending"
    PARSING = "parsing"
    CHUNKING = "chunking"
    INDEXING = "indexing"
    READY = "ready"
    FAILED = "failed"


# Allowed forward transitions; FAILED can be retried back to PENDING via reindex
_LEGAL_DOC_TRANSITIONS: dict[DocumentState, frozenset[DocumentState]] = {
    DocumentState.PENDING: frozenset({DocumentState.PARSING, DocumentState.FAILED}),
    DocumentState.PARSING: frozenset({DocumentState.CHUNKING, DocumentState.FAILED}),
    DocumentState.CHUNKING: frozenset({DocumentState.INDEXING, DocumentState.FAILED}),
    DocumentState.INDEXING: frozenset({DocumentState.READY, DocumentState.FAILED}),
    DocumentState.READY: frozenset({DocumentState.PENDING}),  # reindex
    DocumentState.FAILED: frozenset({DocumentState.PENDING}),  # retry
}


def is_legal_doc_transition(from_state: DocumentState, to_state: DocumentState) -> bool:
    return to_state in _LEGAL_DOC_TRANSITIONS.get(from_state, frozenset())


class GrantScope(StrEnum):
    READ = "read"
    WRITE = "write"  # create / update / move / tag
    ADMIN = "admin"  # delete / grant


class SourceType(StrEnum):
    UPLOAD = "upload"
    URL = "url"
    AGENT = "agent"
    PASTE = "paste"


class EmbeddingJobState(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


# ----------------------------------------------------------------------
# Config
# ----------------------------------------------------------------------


class RetrievalConfig(BaseModel):
    """Per-KB retrieval tuning. Defaults give a sensible hybrid out of the box."""

    bm25_weight: float = Field(default=1.0, ge=0.0)
    vector_weight: float = Field(default=1.0, ge=0.0)
    reranker: Literal["none", "bge-base", "cohere"] = "none"
    top_k: int = Field(default=8, ge=1, le=100)
    min_score: float = Field(default=0.0, ge=0.0)
    rerank_top_in: int = Field(default=30, ge=1, le=200)

    model_config = {"frozen": True}


# ----------------------------------------------------------------------
# Aggregates
# ----------------------------------------------------------------------


class KnowledgeBase(BaseModel):
    id: str = Field(..., min_length=1, max_length=64)
    workspace_id: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=128)
    description: str = Field(default="", max_length=1024)
    visibility: KBVisibility = KBVisibility.PRIVATE
    embedding_model_ref: str = Field(
        ...,
        description="ModelGateway ref, e.g. 'mock:hash-64' or 'bailian:text-embedding-v3'.",
    )
    embedding_dim: int = Field(..., ge=1, le=8192)
    retrieval_config: RetrievalConfig = Field(default_factory=RetrievalConfig)
    document_count: int = Field(default=0, ge=0)
    chunk_count: int = Field(default=0, ge=0)
    deleted_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"frozen": True}


class Collection(BaseModel):
    """Folder-tree node. Path is computed as the chain of names joined by '/'."""

    id: str = Field(..., min_length=1, max_length=64)
    kb_id: str = Field(..., min_length=1, max_length=64)
    parent_id: str | None = None
    name: str = Field(..., min_length=1, max_length=128)
    path: str = Field(..., min_length=1, max_length=512)
    created_at: datetime

    model_config = {"frozen": True}


class Document(BaseModel):
    id: str = Field(..., min_length=1, max_length=64)
    kb_id: str = Field(..., min_length=1, max_length=64)
    collection_id: str | None = None
    title: str = Field(..., min_length=1, max_length=256)
    source_type: SourceType
    source_uri: str | None = Field(default=None, max_length=2048)
    mime_type: str = Field(..., min_length=1, max_length=128)
    file_path: str = Field(..., min_length=1, max_length=512)
    size_bytes: int = Field(..., ge=0)
    sha256: str = Field(..., min_length=64, max_length=64)
    state: DocumentState = DocumentState.PENDING
    state_error: str | None = None
    tags: list[str] = Field(default_factory=list)
    extra_metadata: dict[str, object] = Field(default_factory=dict)
    chunk_count: int = Field(default=0, ge=0)
    failed_chunk_count: int = Field(default=0, ge=0)
    version: int = Field(default=1, ge=1)
    pinned: bool = False
    deleted_at: datetime | None = None
    created_by_employee_id: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"frozen": True}


class DocumentVersion(BaseModel):
    id: str = Field(..., min_length=1, max_length=64)
    document_id: str = Field(..., min_length=1, max_length=64)
    version: int = Field(..., ge=1)
    file_path: str = Field(..., min_length=1, max_length=512)
    size_bytes: int = Field(..., ge=0)
    sha256: str = Field(..., min_length=64, max_length=64)
    diff_summary: str | None = None
    created_at: datetime

    model_config = {"frozen": True}


class Chunk(BaseModel):
    """Atomic retrieval unit. `text` is FTS-indexed, `embedding` is vec-indexed."""

    id: int  # autoincrement integer for vec0 PK alignment
    document_id: str = Field(..., min_length=1, max_length=64)
    kb_id: str = Field(..., min_length=1, max_length=64)
    ordinal: int = Field(..., ge=0)
    text: str = Field(..., min_length=1)
    token_count: int = Field(..., ge=0)
    section_path: str | None = Field(default=None, max_length=512)
    span_start: int = Field(..., ge=0)
    span_end: int = Field(..., ge=0)
    page: int | None = None
    extra_metadata: dict[str, object] = Field(default_factory=dict)

    model_config = {"frozen": True}


class Grant(BaseModel):
    """Write/admin permission on a KB granted to an employee or skill."""

    id: str = Field(..., min_length=1, max_length=64)
    kb_id: str = Field(..., min_length=1, max_length=64)
    employee_id: str | None = None
    skill_id: str | None = None
    scope: GrantScope
    expires_at: datetime | None = None
    created_at: datetime
    created_by: str | None = None

    model_config = {"frozen": True}


class EmbeddingJob(BaseModel):
    id: str = Field(..., min_length=1, max_length=64)
    kb_id: str = Field(..., min_length=1, max_length=64)
    document_id: str = Field(..., min_length=1, max_length=64)
    chunk_id: int = Field(..., ge=0)
    state: EmbeddingJobState = EmbeddingJobState.QUEUED
    attempts: int = Field(default=0, ge=0)
    error: str | None = None
    enqueued_at: datetime
    finished_at: datetime | None = None

    model_config = {"frozen": True}


# ----------------------------------------------------------------------
# Retrieval result transport (NOT a persisted entity)
# ----------------------------------------------------------------------


class ScoredChunk(BaseModel):
    chunk: Chunk
    score: float = Field(..., ge=0.0)
    bm25_rank: int | None = None
    vector_rank: int | None = None
    citation: str = Field(..., description="Human-friendly ref, e.g. 'doc#§2.3 · p14'.")

    model_config = {"frozen": True}
