"""Ingest orchestrator — drives a Document through PARSING→CHUNKING→INDEXING→READY.

Synchronous (per-call) for simplicity in v0: one ``ingest_document`` call
runs the full pipeline. Worker-based async embedding is wrapped in here
too so the caller doesn't need to plumb a separate worker pool — the
function returns when the doc is READY (or FAILED).

State transitions are checked against ``is_legal_doc_transition`` and
written through ``DocumentRepo.update_state``. Embedding work goes
through ``EmbeddingJobRepo`` so a crash mid-ingest leaves a resumable
queue (the chunks are already inserted; only the vector backfill is
pending).

Future async path: split this into "queue jobs" + "worker drain"
once we add a real background worker (M2 stretch). The interface
stays the same.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    SessionMaker = async_sessionmaker[AsyncSession]
else:
    SessionMaker = Any

from allhands.core import (
    DocumentState,
    EmbeddingJob,
    EmbeddingJobState,
)
from allhands.execution.knowledge.chunker import Chunker
from allhands.execution.knowledge.embedder import Embedder
from allhands.execution.knowledge.parsers import detect_mime, get_parser_for
from allhands.execution.knowledge.vector import VectorStore
from allhands.persistence.knowledge_repos import (
    SqlChunkRepo,
    SqlDocumentRepo,
    SqlEmbeddingJobRepo,
    SqlKnowledgeBaseRepo,
)

_logger = logging.getLogger(__name__)


class IngestError(RuntimeError):
    pass


class IngestOrchestrator:
    """Coordinates parsers + chunker + embedder + vec store + repos.

    Constructed once per session_maker; each ``ingest_document`` call
    opens a fresh session via the maker so transactions are scoped to
    one document end-to-end.
    """

    def __init__(
        self,
        session_maker: SessionMaker,
        *,
        chunker: Chunker,
        embedder: Embedder,
        vec_store: VectorStore,
        data_root: Path,
    ) -> None:
        self._session_maker = session_maker
        self.chunker = chunker
        self.embedder = embedder
        self.vec_store = vec_store
        self.data_root = data_root

    async def ingest_document(self, document_id: str, *, file_path_abs: Path) -> None:
        """Run the full pipeline for one already-uploaded document.

        Caller has already inserted the Document row in PENDING state and
        written the file to disk at ``file_path_abs``. We do parse → chunk →
        index → ready (or failed) and update the row + bump KB counters.
        """
        # ── 1. PARSE
        async with self._session_maker() as s:
            doc_repo = SqlDocumentRepo(s)
            doc = await doc_repo.get(document_id)
            if doc is None:
                raise IngestError(f"document {document_id!r} not found")
            kb_repo = SqlKnowledgeBaseRepo(s)
            kb = await kb_repo.get(doc.kb_id)
            if kb is None:
                raise IngestError(f"kb {doc.kb_id!r} not found for doc {document_id!r}")
            await doc_repo.update_state(document_id, DocumentState.PARSING)
            await s.commit()

        try:
            mime = doc.mime_type or detect_mime(file_path_abs.name)
            parser = get_parser_for(mime)
            if parser is None:
                raise IngestError(f"no parser registered for mime {mime!r}")
            parsed = parser.parse(str(file_path_abs))

            # ── 2. CHUNK
            async with self._session_maker() as s:
                doc_repo = SqlDocumentRepo(s)
                await doc_repo.update_state(document_id, DocumentState.CHUNKING)
                await s.commit()

            chunk_specs = self.chunker.split(parsed)
            if not chunk_specs:
                _logger.warning("doc %s parsed to 0 chunks; marking READY (empty)", document_id)
                async with self._session_maker() as s:
                    doc_repo = SqlDocumentRepo(s)
                    kb_repo = SqlKnowledgeBaseRepo(s)
                    await doc_repo.update_state(document_id, DocumentState.READY, chunk_count=0)
                    await kb_repo.bump_counters(doc.kb_id, docs=1, chunks=0)
                    await s.commit()
                return

            async with self._session_maker() as s:
                chunk_repo = SqlChunkRepo(s)
                chunk_dicts: list[dict[str, object]] = [
                    {
                        "ordinal": c.ordinal,
                        "text": c.text,
                        "token_count": c.token_count,
                        "section_path": c.section_path,
                        "span_start": c.span_start,
                        "span_end": c.span_end,
                        "page": c.page,
                        "extra_metadata": c.extra_metadata,
                    }
                    for c in chunk_specs
                ]
                chunk_ids = await chunk_repo.bulk_insert(
                    document_id=document_id, kb_id=doc.kb_id, chunks=chunk_dicts
                )
                # Enqueue embedding jobs
                jobs_repo = SqlEmbeddingJobRepo(s)
                now = datetime.now(UTC)
                jobs = [
                    EmbeddingJob(
                        id=str(uuid.uuid4()),
                        kb_id=doc.kb_id,
                        document_id=document_id,
                        chunk_id=cid,
                        state=EmbeddingJobState.QUEUED,
                        enqueued_at=now,
                    )
                    for cid in chunk_ids
                ]
                await jobs_repo.enqueue_many(jobs)
                doc_repo = SqlDocumentRepo(s)
                await doc_repo.update_state(
                    document_id, DocumentState.INDEXING, chunk_count=len(chunk_ids)
                )
                await s.commit()

            # ── 3. INDEX (synchronous drain — keep it simple for v0)
            await self._drain_embedding_jobs(doc.kb_id, document_id, kb.embedding_dim)

            # ── 4. READY (or FAILED if any jobs failed)
            async with self._session_maker() as s:
                doc_repo = SqlDocumentRepo(s)
                jobs_repo = SqlEmbeddingJobRepo(s)
                kb_repo = SqlKnowledgeBaseRepo(s)
                progress = await jobs_repo.doc_progress(document_id)
                failed = progress.get(EmbeddingJobState.FAILED.value, 0)
                done = progress.get(EmbeddingJobState.DONE.value, 0)
                if failed > 0 and done == 0:
                    await doc_repo.update_state(
                        document_id,
                        DocumentState.FAILED,
                        error=f"all {failed} embedding jobs failed",
                        failed_chunk_count=failed,
                    )
                else:
                    await doc_repo.update_state(
                        document_id,
                        DocumentState.READY,
                        chunk_count=done + failed,
                        failed_chunk_count=failed,
                    )
                    await kb_repo.bump_counters(doc.kb_id, docs=1, chunks=done)
                await s.commit()

        except Exception as exc:
            _logger.exception("ingest failed for doc %s", document_id)
            async with self._session_maker() as s:
                doc_repo = SqlDocumentRepo(s)
                await doc_repo.update_state(
                    document_id, DocumentState.FAILED, error=str(exc)[:1000]
                )
                await s.commit()
            raise

    # ------------------------------------------------------------------
    # Embedding worker (sync drain for v0)
    # ------------------------------------------------------------------

    async def _drain_embedding_jobs(self, kb_id: str, document_id: str, expected_dim: int) -> None:
        """Pull jobs in batches and embed until none queued for this doc."""
        await self.vec_store.create_namespace(kb_id, expected_dim)
        while True:
            # Phase A: lease + read texts in one short tx, then COMMIT
            # so subsequent vec-store writes don't deadlock on the SQLite
            # writer lock (each session writes the same WAL file).
            async with self._session_maker() as s:
                jobs_repo = SqlEmbeddingJobRepo(s)
                chunk_repo = SqlChunkRepo(s)
                batch = await jobs_repo.lease(kb_id, limit=64)
                batch = [j for j in batch if j.document_id == document_id]
                if not batch:
                    await s.commit()
                    break
                chunks = await chunk_repo.get_many([j.chunk_id for j in batch])
                texts = [c.text for c in chunks]
                await s.commit()

            # Phase B: embed + vec-store write outside of any open tx
            try:
                vectors = await self.embedder.embed_texts(texts)
            except Exception as exc:
                async with self._session_maker() as s2:
                    await SqlEmbeddingJobRepo(s2).mark_failed(
                        [j.id for j in batch], f"embedder error: {exc}"
                    )
                    await s2.commit()
                continue
            items = list(zip([c.id for c in chunks], vectors, strict=True))
            await self.vec_store.upsert(kb_id, items)

            # Phase C: mark done in a third short tx
            async with self._session_maker() as s3:
                await SqlEmbeddingJobRepo(s3).mark_done([j.id for j in batch])
                await s3.commit()


__all__ = ["IngestError", "IngestOrchestrator"]
