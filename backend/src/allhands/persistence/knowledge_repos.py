"""Repositories for the Knowledge Base aggregate.

Six repos cover the persistence surface:

- ``SqlKnowledgeBaseRepo``  -KBs (CRUD + counters)
- ``SqlCollectionRepo``     -folder tree
- ``SqlDocumentRepo``       -documents + state machine + soft delete
- ``SqlChunkRepo``          -chunks (insert / read / read-by-ids / vector upsert)
- ``SqlGrantRepo``          -per-employee / per-skill write grants
- ``SqlEmbeddingJobRepo``   -embedding job state machine (queue / lease / done)
- ``SqlEmbeddingCacheRepo`` -cross-KB cache `sha256(text||model_ref)` → bytes

These are concrete classes — protocols live in ``persistence.repositories`` only
when there is an existing analogous abstraction. KB is new and self-contained,
so the impl is the contract for v0.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import String, delete, func, or_, select, text, update

from allhands.core import (
    Chunk,
    Collection,
    Document,
    DocumentState,
    DocumentVersion,
    EmbeddingJob,
    EmbeddingJobState,
    Grant,
    GrantScope,
    KBVisibility,
    KnowledgeBase,
    RetrievalConfig,
    SourceType,
)
from allhands.persistence.orm.knowledge_orm import (
    ChunkRow,
    CollectionRow,
    DocumentRow,
    DocumentVersionRow,
    EmbeddingCacheRow,
    EmbeddingJobRow,
    GrantRow,
    KnowledgeBaseRow,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


# ----------------------------------------------------------------------
# Mappers
# ----------------------------------------------------------------------


def _kb_row_to_model(row: KnowledgeBaseRow) -> KnowledgeBase:
    return KnowledgeBase(
        id=row.id,
        workspace_id=row.workspace_id,
        name=row.name,
        description=row.description or "",
        visibility=KBVisibility(row.visibility),
        embedding_model_ref=row.embedding_model_ref,
        embedding_dim=row.embedding_dim,
        retrieval_config=RetrievalConfig.model_validate(row.retrieval_config or {}),
        document_count=row.document_count,
        chunk_count=row.chunk_count,
        deleted_at=row.deleted_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _collection_row_to_model(row: CollectionRow) -> Collection:
    return Collection(
        id=row.id,
        kb_id=row.kb_id,
        parent_id=row.parent_id,
        name=row.name,
        path=row.path,
        created_at=row.created_at,
    )


def _doc_row_to_model(row: DocumentRow) -> Document:
    return Document(
        id=row.id,
        kb_id=row.kb_id,
        collection_id=row.collection_id,
        title=row.title,
        source_type=SourceType(row.source_type),
        source_uri=row.source_uri,
        mime_type=row.mime_type,
        file_path=row.file_path,
        size_bytes=row.size_bytes,
        sha256=row.sha256,
        state=DocumentState(row.state),
        state_error=row.state_error,
        tags=list(row.tags or []),
        extra_metadata=dict(row.extra_metadata or {}),
        chunk_count=row.chunk_count,
        failed_chunk_count=row.failed_chunk_count,
        version=row.version,
        pinned=row.pinned,
        deleted_at=row.deleted_at,
        created_by_employee_id=row.created_by_employee_id,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _docver_row_to_model(row: DocumentVersionRow) -> DocumentVersion:
    return DocumentVersion(
        id=row.id,
        document_id=row.document_id,
        version=row.version,
        file_path=row.file_path,
        size_bytes=row.size_bytes,
        sha256=row.sha256,
        diff_summary=row.diff_summary,
        created_at=row.created_at,
    )


def _chunk_row_to_model(row: ChunkRow) -> Chunk:
    return Chunk(
        id=row.id,
        document_id=row.document_id,
        kb_id=row.kb_id,
        ordinal=row.ordinal,
        text=row.text,
        token_count=row.token_count,
        section_path=row.section_path,
        span_start=row.span_start,
        span_end=row.span_end,
        page=row.page,
        extra_metadata=dict(row.extra_metadata or {}),
    )


def _grant_row_to_model(row: GrantRow) -> Grant:
    return Grant(
        id=row.id,
        kb_id=row.kb_id,
        employee_id=row.employee_id,
        skill_id=row.skill_id,
        scope=GrantScope(row.scope),
        expires_at=row.expires_at,
        created_at=row.created_at,
        created_by=row.created_by,
    )


def _job_row_to_model(row: EmbeddingJobRow) -> EmbeddingJob:
    return EmbeddingJob(
        id=row.id,
        kb_id=row.kb_id,
        document_id=row.document_id,
        chunk_id=row.chunk_id,
        state=EmbeddingJobState(row.state),
        attempts=row.attempts,
        error=row.error,
        enqueued_at=row.enqueued_at,
        finished_at=row.finished_at,
    )


# ----------------------------------------------------------------------
# Repos
# ----------------------------------------------------------------------


class SqlKnowledgeBaseRepo:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def upsert(self, kb: KnowledgeBase) -> KnowledgeBase:
        existing = await self._session.get(KnowledgeBaseRow, kb.id)
        data = {
            "id": kb.id,
            "workspace_id": kb.workspace_id,
            "name": kb.name,
            "description": kb.description,
            "visibility": kb.visibility.value,
            "embedding_model_ref": kb.embedding_model_ref,
            "embedding_dim": kb.embedding_dim,
            "retrieval_config": kb.retrieval_config.model_dump(),
            "document_count": kb.document_count,
            "chunk_count": kb.chunk_count,
            "deleted_at": kb.deleted_at,
            "created_at": kb.created_at,
            "updated_at": kb.updated_at,
        }
        if existing is None:
            self._session.add(KnowledgeBaseRow(**data))
        else:
            for k, v in data.items():
                setattr(existing, k, v)
        await self._session.flush()
        return kb

    async def get(self, kb_id: str) -> KnowledgeBase | None:
        row = await self._session.get(KnowledgeBaseRow, kb_id)
        return _kb_row_to_model(row) if row and row.deleted_at is None else None

    async def get_by_name(self, workspace_id: str, name: str) -> KnowledgeBase | None:
        stmt = select(KnowledgeBaseRow).where(
            KnowledgeBaseRow.workspace_id == workspace_id,
            KnowledgeBaseRow.name == name,
            KnowledgeBaseRow.deleted_at.is_(None),
        )
        row = (await self._session.execute(stmt)).scalar_one_or_none()
        return _kb_row_to_model(row) if row else None

    async def list_for_workspace(self, workspace_id: str) -> list[KnowledgeBase]:
        stmt = (
            select(KnowledgeBaseRow)
            .where(
                KnowledgeBaseRow.workspace_id == workspace_id,
                KnowledgeBaseRow.deleted_at.is_(None),
            )
            .order_by(KnowledgeBaseRow.created_at.desc())
        )
        return [_kb_row_to_model(r) for r in (await self._session.execute(stmt)).scalars()]

    async def soft_delete(self, kb_id: str) -> None:
        await self._session.execute(
            update(KnowledgeBaseRow)
            .where(KnowledgeBaseRow.id == kb_id)
            .values(deleted_at=datetime.now(UTC))
        )
        await self._session.flush()

    async def bump_counters(self, kb_id: str, *, docs: int = 0, chunks: int = 0) -> None:
        await self._session.execute(
            update(KnowledgeBaseRow)
            .where(KnowledgeBaseRow.id == kb_id)
            .values(
                document_count=KnowledgeBaseRow.document_count + docs,
                chunk_count=KnowledgeBaseRow.chunk_count + chunks,
                updated_at=datetime.now(UTC),
            )
        )
        await self._session.flush()


class SqlCollectionRepo:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def upsert(self, c: Collection) -> Collection:
        existing = await self._session.get(CollectionRow, c.id)
        data = {
            "id": c.id,
            "kb_id": c.kb_id,
            "parent_id": c.parent_id,
            "name": c.name,
            "path": c.path,
            "created_at": c.created_at,
        }
        if existing is None:
            self._session.add(CollectionRow(**data))
        else:
            for k, v in data.items():
                setattr(existing, k, v)
        await self._session.flush()
        return c

    async def get(self, collection_id: str) -> Collection | None:
        row = await self._session.get(CollectionRow, collection_id)
        return _collection_row_to_model(row) if row else None

    async def list_for_kb(self, kb_id: str) -> list[Collection]:
        stmt = (
            select(CollectionRow).where(CollectionRow.kb_id == kb_id).order_by(CollectionRow.path)
        )
        return [_collection_row_to_model(r) for r in (await self._session.execute(stmt)).scalars()]


class SqlDocumentRepo:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def upsert(self, doc: Document) -> Document:
        existing = await self._session.get(DocumentRow, doc.id)
        data = {
            "id": doc.id,
            "kb_id": doc.kb_id,
            "collection_id": doc.collection_id,
            "title": doc.title,
            "source_type": doc.source_type.value,
            "source_uri": doc.source_uri,
            "mime_type": doc.mime_type,
            "file_path": doc.file_path,
            "size_bytes": doc.size_bytes,
            "sha256": doc.sha256,
            "state": doc.state.value,
            "state_error": doc.state_error,
            "tags": list(doc.tags),
            "extra_metadata": dict(doc.extra_metadata),
            "chunk_count": doc.chunk_count,
            "failed_chunk_count": doc.failed_chunk_count,
            "version": doc.version,
            "pinned": doc.pinned,
            "deleted_at": doc.deleted_at,
            "created_by_employee_id": doc.created_by_employee_id,
            "created_at": doc.created_at,
            "updated_at": doc.updated_at,
        }
        if existing is None:
            self._session.add(DocumentRow(**data))
        else:
            for k, v in data.items():
                setattr(existing, k, v)
        await self._session.flush()
        return doc

    async def get(self, document_id: str) -> Document | None:
        row = await self._session.get(DocumentRow, document_id)
        return _doc_row_to_model(row) if row and row.deleted_at is None else None

    async def get_by_sha(self, kb_id: str, sha256: str) -> Document | None:
        stmt = select(DocumentRow).where(
            DocumentRow.kb_id == kb_id,
            DocumentRow.sha256 == sha256,
            DocumentRow.deleted_at.is_(None),
        )
        row = (await self._session.execute(stmt)).scalar_one_or_none()
        return _doc_row_to_model(row) if row else None

    async def list_for_kb(
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
        stmt = select(DocumentRow).where(
            DocumentRow.kb_id == kb_id, DocumentRow.deleted_at.is_(None)
        )
        if collection_id is not None:
            stmt = stmt.where(DocumentRow.collection_id == collection_id)
        if state is not None:
            stmt = stmt.where(DocumentRow.state == state.value)
        if title_prefix:
            stmt = stmt.where(DocumentRow.title.ilike(f"{title_prefix}%"))
        if tag:
            # Tags is JSON list — best-effort substring match. SQLite doesn't
            # have JSON_CONTAINS; this is acceptable for v0.
            stmt = stmt.where(func.lower(DocumentRow.tags.cast(String)).contains(tag.lower()))
        stmt = stmt.order_by(DocumentRow.updated_at.desc()).limit(limit).offset(offset)
        return [_doc_row_to_model(r) for r in (await self._session.execute(stmt)).scalars()]

    async def soft_delete(self, document_id: str) -> None:
        await self._session.execute(
            update(DocumentRow)
            .where(DocumentRow.id == document_id)
            .values(deleted_at=datetime.now(UTC))
        )
        await self._session.flush()

    async def update_state(
        self,
        document_id: str,
        new_state: DocumentState,
        *,
        error: str | None = None,
        chunk_count: int | None = None,
        failed_chunk_count: int | None = None,
    ) -> None:
        values: dict[str, object] = {
            "state": new_state.value,
            "state_error": error,
            "updated_at": datetime.now(UTC),
        }
        if chunk_count is not None:
            values["chunk_count"] = chunk_count
        if failed_chunk_count is not None:
            values["failed_chunk_count"] = failed_chunk_count
        await self._session.execute(
            update(DocumentRow).where(DocumentRow.id == document_id).values(**values)
        )
        await self._session.flush()

    async def save_version(self, version: DocumentVersion) -> DocumentVersion:
        self._session.add(
            DocumentVersionRow(
                id=version.id,
                document_id=version.document_id,
                version=version.version,
                file_path=version.file_path,
                size_bytes=version.size_bytes,
                sha256=version.sha256,
                diff_summary=version.diff_summary,
                created_at=version.created_at,
            )
        )
        await self._session.flush()
        return version

    async def list_versions(self, document_id: str) -> list[DocumentVersion]:
        stmt = (
            select(DocumentVersionRow)
            .where(DocumentVersionRow.document_id == document_id)
            .order_by(DocumentVersionRow.version.asc())
        )
        return [_docver_row_to_model(r) for r in (await self._session.execute(stmt)).scalars()]


class SqlChunkRepo:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def bulk_insert(
        self,
        document_id: str,
        kb_id: str,
        chunks: list[dict[str, object]],
    ) -> list[int]:
        """Insert chunks; returns the assigned chunk ids in input order."""
        ids: list[int] = []
        for c in chunks:
            row = ChunkRow(
                document_id=document_id,
                kb_id=kb_id,
                ordinal=c["ordinal"],
                text=c["text"],
                token_count=c.get("token_count", 0),
                section_path=c.get("section_path"),
                span_start=c.get("span_start", 0),
                span_end=c.get("span_end", 0),
                page=c.get("page"),
                extra_metadata=c.get("extra_metadata", {}),
                embedding=None,
            )
            self._session.add(row)
            await self._session.flush()
            ids.append(row.id)
        return ids

    async def get(self, chunk_id: int) -> Chunk | None:
        row = await self._session.get(ChunkRow, chunk_id)
        return _chunk_row_to_model(row) if row else None

    async def get_many(self, chunk_ids: list[int]) -> list[Chunk]:
        if not chunk_ids:
            return []
        stmt = select(ChunkRow).where(ChunkRow.id.in_(chunk_ids))
        rows = (await self._session.execute(stmt)).scalars().all()
        # preserve input order
        by_id = {r.id: r for r in rows}
        return [_chunk_row_to_model(by_id[i]) for i in chunk_ids if i in by_id]

    async def list_for_document(self, document_id: str) -> list[Chunk]:
        stmt = (
            select(ChunkRow)
            .where(ChunkRow.document_id == document_id)
            .order_by(ChunkRow.ordinal.asc())
        )
        return [_chunk_row_to_model(r) for r in (await self._session.execute(stmt)).scalars()]

    async def delete_for_document(self, document_id: str) -> int:
        result = await self._session.execute(
            delete(ChunkRow).where(ChunkRow.document_id == document_id)
        )
        await self._session.flush()
        return int(getattr(result, "rowcount", 0) or 0)

    async def upsert_embedding(self, chunk_id: int, vector_bytes: bytes) -> None:
        await self._session.execute(
            update(ChunkRow).where(ChunkRow.id == chunk_id).values(embedding=vector_bytes)
        )
        await self._session.flush()

    async def fetch_kb_vectors(self, kb_id: str) -> list[tuple[int, bytes]]:
        """All (chunk_id, embedding_bytes) for a KB where embedding is non-null.

        Used by BlobVecStore for brute-force search. For 100k chunks this is
        ~120MB of data; loading it once per query is fine for v0. Future
        sqlite-vec swap pushes the scan into native code.
        """
        stmt = select(ChunkRow.id, ChunkRow.embedding).where(
            ChunkRow.kb_id == kb_id, ChunkRow.embedding.is_not(None)
        )
        return [(int(r[0]), bytes(r[1])) for r in (await self._session.execute(stmt)).all()]


class SqlGrantRepo:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def upsert(self, grant: Grant) -> Grant:
        existing = await self._session.get(GrantRow, grant.id)
        data = {
            "id": grant.id,
            "kb_id": grant.kb_id,
            "employee_id": grant.employee_id,
            "skill_id": grant.skill_id,
            "scope": grant.scope.value,
            "expires_at": grant.expires_at,
            "created_at": grant.created_at,
            "created_by": grant.created_by,
        }
        if existing is None:
            self._session.add(GrantRow(**data))
        else:
            for k, v in data.items():
                setattr(existing, k, v)
        await self._session.flush()
        return grant

    async def list_for_kb(self, kb_id: str) -> list[Grant]:
        stmt = select(GrantRow).where(GrantRow.kb_id == kb_id)
        return [_grant_row_to_model(r) for r in (await self._session.execute(stmt)).scalars()]

    async def find_for_principal(
        self,
        kb_id: str,
        *,
        employee_id: str | None,
        skill_id: str | None,
        min_scope: GrantScope = GrantScope.WRITE,
    ) -> Grant | None:
        """Returns the strongest matching, non-expired grant, if any."""
        now = datetime.now(UTC)
        principal_filter = []
        if employee_id is not None:
            principal_filter.append(GrantRow.employee_id == employee_id)
        if skill_id is not None:
            principal_filter.append(GrantRow.skill_id == skill_id)
        if not principal_filter:
            return None
        stmt = select(GrantRow).where(
            GrantRow.kb_id == kb_id,
            or_(*principal_filter),
            or_(GrantRow.expires_at.is_(None), GrantRow.expires_at > now),
        )
        rows = (await self._session.execute(stmt)).scalars().all()
        if not rows:
            return None
        ordering = {GrantScope.READ: 0, GrantScope.WRITE: 1, GrantScope.ADMIN: 2}
        candidates = [_grant_row_to_model(r) for r in rows]
        candidates = [g for g in candidates if ordering[g.scope] >= ordering[min_scope]]
        if not candidates:
            return None
        candidates.sort(key=lambda g: ordering[g.scope], reverse=True)
        return candidates[0]

    async def delete(self, grant_id: str) -> None:
        await self._session.execute(delete(GrantRow).where(GrantRow.id == grant_id))
        await self._session.flush()


class SqlEmbeddingJobRepo:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def enqueue_many(self, jobs: list[EmbeddingJob]) -> None:
        for j in jobs:
            self._session.add(
                EmbeddingJobRow(
                    id=j.id,
                    kb_id=j.kb_id,
                    document_id=j.document_id,
                    chunk_id=j.chunk_id,
                    state=j.state.value,
                    attempts=j.attempts,
                    error=j.error,
                    enqueued_at=j.enqueued_at,
                    finished_at=j.finished_at,
                )
            )
        await self._session.flush()

    async def lease(self, kb_id: str | None = None, *, limit: int = 64) -> list[EmbeddingJob]:
        """Pop up to `limit` queued jobs and mark them RUNNING.

        SQLite doesn't have row-level locking; in WAL mode the begin-immediate
        + UPDATE pattern is enough for the single-worker-per-process case the
        v0 ingest worker uses.
        """
        stmt = select(EmbeddingJobRow).where(
            EmbeddingJobRow.state == EmbeddingJobState.QUEUED.value
        )
        if kb_id is not None:
            stmt = stmt.where(EmbeddingJobRow.kb_id == kb_id)
        stmt = stmt.order_by(EmbeddingJobRow.enqueued_at.asc()).limit(limit)
        rows = list((await self._session.execute(stmt)).scalars().all())
        for r in rows:
            r.state = EmbeddingJobState.RUNNING.value
            r.attempts = (r.attempts or 0) + 1
        await self._session.flush()
        return [_job_row_to_model(r) for r in rows]

    async def mark_done(self, job_ids: list[str]) -> None:
        if not job_ids:
            return
        await self._session.execute(
            update(EmbeddingJobRow)
            .where(EmbeddingJobRow.id.in_(job_ids))
            .values(state=EmbeddingJobState.DONE.value, finished_at=datetime.now(UTC), error=None)
        )
        await self._session.flush()

    async def mark_failed(self, job_ids: list[str], error: str) -> None:
        if not job_ids:
            return
        await self._session.execute(
            update(EmbeddingJobRow)
            .where(EmbeddingJobRow.id.in_(job_ids))
            .values(
                state=EmbeddingJobState.FAILED.value,
                finished_at=datetime.now(UTC),
                error=error[:2000],
            )
        )
        await self._session.flush()

    async def reset_failed_for_doc(self, document_id: str) -> int:
        result = await self._session.execute(
            update(EmbeddingJobRow)
            .where(
                EmbeddingJobRow.document_id == document_id,
                EmbeddingJobRow.state == EmbeddingJobState.FAILED.value,
            )
            .values(state=EmbeddingJobState.QUEUED.value, error=None, finished_at=None)
        )
        await self._session.flush()
        return int(getattr(result, "rowcount", 0) or 0)

    async def doc_progress(self, document_id: str) -> dict[str, int]:
        """Counts of jobs by state for a document. Used to decide READY."""
        stmt = (
            select(EmbeddingJobRow.state, func.count())
            .where(EmbeddingJobRow.document_id == document_id)
            .group_by(EmbeddingJobRow.state)
        )
        result = (await self._session.execute(stmt)).all()
        return {state: int(n) for state, n in result}


class SqlEmbeddingCacheRepo:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, hash_: str) -> bytes | None:
        row = await self._session.get(EmbeddingCacheRow, hash_)
        return bytes(row.vector) if row is not None else None

    async def get_many(self, hashes: list[str]) -> dict[str, bytes]:
        if not hashes:
            return {}
        stmt = select(EmbeddingCacheRow).where(EmbeddingCacheRow.hash.in_(hashes))
        return {r.hash: bytes(r.vector) for r in (await self._session.execute(stmt)).scalars()}

    async def put_many(self, entries: list[tuple[str, str, int, bytes]]) -> None:
        """entries: (hash, model_ref, dim, vector_bytes)."""
        now = datetime.now(UTC)
        for h, model_ref, dim, vec in entries:
            existing = await self._session.get(EmbeddingCacheRow, h)
            if existing is not None:
                continue
            self._session.add(
                EmbeddingCacheRow(hash=h, model_ref=model_ref, dim=dim, vector=vec, created_at=now)
            )
        await self._session.flush()


# ----------------------------------------------------------------------
# FTS helper (bypasses ORM — FTS5 is an SQLite virtual table, not a Row)
# ----------------------------------------------------------------------


_FTS5_RESERVED = re.compile(r"[\"'*()+\-:^!?,;.&|/\\\[\]{}<>=~`@#$%]+")


def _sanitise_fts_query(query: str) -> str:
    """Strip FTS5-reserved punctuation so natural-language questions
    (and user typos like ``what is rrf?``) don't blow up the parser.

    The MATCH grammar treats ``?``, ``!``, quotes, colons, parens etc.
    as syntax — bare punctuation in a user-typed question therefore
    raises ``fts5: syntax error near "?"``. We replace all reserved
    chars with spaces, collapse whitespace, then drop empty tokens.
    Empty result means "search everything that matches anything" — we
    treat it as no-op (caller short-circuits on empty).
    """
    cleaned = _FTS5_RESERVED.sub(" ", query)
    tokens = [t for t in cleaned.split() if t]
    return " ".join(tokens)


async def fts_search(
    session: AsyncSession, kb_id: str, query: str, *, top: int = 50
) -> list[tuple[int, float]]:
    """BM25 over `kb_chunks_fts`; returns [(chunk_id, bm25_neg_score)] sorted best-first.

    SQLite FTS5's `bm25()` returns a NEGATIVE score (lower is better);
    we negate so callers can treat higher = better.
    """
    cleaned = _sanitise_fts_query(query)
    if not cleaned:
        return []
    sql = text(
        """
        SELECT rowid, bm25(kb_chunks_fts) AS score
          FROM kb_chunks_fts
         WHERE kb_id = :kb_id AND text MATCH :q
         ORDER BY score
         LIMIT :limit
        """
    )
    rows = (await session.execute(sql, {"kb_id": kb_id, "q": cleaned, "limit": top})).all()
    # Negate so higher = better.
    return [(int(r[0]), -float(r[1])) for r in rows]


__all__ = [
    "SqlChunkRepo",
    "SqlCollectionRepo",
    "SqlDocumentRepo",
    "SqlEmbeddingCacheRepo",
    "SqlEmbeddingJobRepo",
    "SqlGrantRepo",
    "SqlKnowledgeBaseRepo",
    "fts_search",
]
