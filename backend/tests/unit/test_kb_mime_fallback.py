"""Mime fallback regression — generic octet-stream from multipart upload
must not trump filename-based detection. The old behavior failed every
.md / .pdf upload from curl + browsers that didn't set a specific mime.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine

from allhands.persistence.orm.base import Base
from allhands.services.knowledge_service import KnowledgeService


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    eng = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.exec_driver_sql(
            "CREATE VIRTUAL TABLE kb_chunks_fts USING fts5("
            "text, kb_id UNINDEXED, content='kb_chunks', content_rowid='id', "
            "tokenize='unicode61 remove_diacritics 2')"
        )
        await conn.exec_driver_sql(
            "CREATE TRIGGER kb_chunks_ai AFTER INSERT ON kb_chunks BEGIN "
            "INSERT INTO kb_chunks_fts(rowid, text, kb_id) "
            "VALUES (new.id, new.text, new.kb_id); END"
        )
    yield eng
    await eng.dispose()


@pytest.fixture
def svc(engine: AsyncEngine, tmp_path: Path) -> KnowledgeService:
    return KnowledgeService(async_sessionmaker(engine, expire_on_commit=False), data_dir=tmp_path)


async def test_octet_stream_falls_back_to_filename_detect(svc: KnowledgeService) -> None:
    kb = await svc.create_kb(name="brain")
    doc = await svc.upload_document(
        kb.id,
        title="readme",
        content_bytes=b"# Title\n\nThis paragraph is intentionally long enough to clear the chunker's min-chunk threshold so the assertion on chunk_count >= 1 holds even after the heading-aware path filters tiny sections.",
        filename="readme.md",
        mime_type="application/octet-stream",  # the bug case
    )
    assert doc.state.value == "ready", f"state was {doc.state} err={doc.state_error}"
    assert doc.mime_type == "text/markdown"
    assert doc.chunk_count >= 1


async def test_explicit_mime_is_respected(svc: KnowledgeService) -> None:
    kb = await svc.create_kb(name="brain")
    doc = await svc.upload_document(
        kb.id,
        title="r",
        content_bytes=b"# Heading\n\nThis explicit-mime path body must be long enough that the chunker keeps it after min-chunk-chars filtering.",
        filename="r.unknown",
        mime_type="text/markdown",
    )
    assert doc.state.value == "ready"
    assert doc.mime_type == "text/markdown"


async def test_no_filename_no_mime_defaults_text(svc: KnowledgeService) -> None:
    kb = await svc.create_kb(name="brain")
    doc = await svc.upload_document(
        kb.id,
        title="x",
        content_bytes=b"This is a plain text body long enough to survive the chunker minimum threshold and become at least one indexed chunk.",
        filename=None,
        mime_type=None,
    )
    assert doc.state.value == "ready"
    assert doc.mime_type == "text/plain"
