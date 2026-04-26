"""KnowledgeService end-to-end unit tests.

Covers the v0 happy path: create KB → upload markdown doc → ingest →
search returns the right chunk first. Plus the grant gate behavior used
by the agent-side `kb_create_document` Meta Tool.

Uses the mock embedder (`mock:hash-64`) so no API key is required and
results are deterministic.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine

from allhands.core import GrantScope
from allhands.persistence.orm.base import Base
from allhands.services.knowledge_service import KnowledgeService


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    eng = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # FTS5 virtual table + trigger (mirroring alembic 0024)
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
    maker = async_sessionmaker(engine, expire_on_commit=False)
    return KnowledgeService(maker, data_dir=tmp_path)


_SAMPLE_MD = b"""# Hybrid Retrieval

Brief overview of combining lexical and dense vector search techniques.

## RRF Fusion

Reciprocal Rank Fusion (RRF) is a parameter-free way to combine ranked
lists from BM25 and dense vector retrieval into a single ordered list.

## Reranking

The bge-reranker model improves precision-at-k on top of fused results,
at the cost of an extra inference pass per query.
"""


async def test_create_kb_defaults_to_mock_embedder(svc: KnowledgeService) -> None:
    kb = await svc.create_kb(name="brain")
    assert kb.embedding_model_ref.startswith("mock:hash-")
    assert kb.embedding_dim == 64
    assert kb.document_count == 0


async def test_upload_markdown_then_search_returns_relevant_chunk_first(
    svc: KnowledgeService,
) -> None:
    kb = await svc.create_kb(name="brain")
    doc = await svc.upload_document(
        kb.id, title="Survey", content_bytes=_SAMPLE_MD, filename="survey.md"
    )
    assert doc.state.value == "ready"
    assert doc.chunk_count >= 2

    # FTS-driven query — RRF Fusion section should win on "rrf"
    results = await svc.search(kb.id, "rrf")
    assert len(results) >= 1
    top = results[0]
    assert "RRF Fusion" in (top.chunk.section_path or "")
    assert top.chunk.text.lower().count("rrf") >= 1
    assert top.citation.startswith("doc ")


async def test_dedup_on_sha_returns_same_doc(svc: KnowledgeService) -> None:
    kb = await svc.create_kb(name="brain")
    a = await svc.upload_document(kb.id, title="dup", content_bytes=_SAMPLE_MD, filename="a.md")
    b = await svc.upload_document(
        kb.id, title="dup-again", content_bytes=_SAMPLE_MD, filename="b.md"
    )
    assert a.id == b.id


async def test_grant_gate_no_grant_then_grant(svc: KnowledgeService) -> None:
    kb = await svc.create_kb(name="brain")
    # No grant for emp_x → False
    assert await svc.has_write_grant(kb.id, employee_id="emp_x") is False
    await svc.grant_permission(kb.id, scope=GrantScope.WRITE, employee_id="emp_x")
    assert await svc.has_write_grant(kb.id, employee_id="emp_x") is True
    # Different principal still denied
    assert await svc.has_write_grant(kb.id, employee_id="emp_other") is False


async def test_list_documents_filters_by_title_prefix(svc: KnowledgeService) -> None:
    kb = await svc.create_kb(name="brain")
    await svc.upload_document(
        kb.id, title="alpha", content_bytes=b"# alpha\n\nbody", filename="a.md"
    )
    await svc.upload_document(kb.id, title="beta", content_bytes=b"# beta\n\nbody", filename="b.md")
    res = await svc.list_documents(kb.id, title_prefix="alp")
    assert len(res) == 1
    assert res[0].title == "alpha"


async def test_search_empty_query_returns_empty(svc: KnowledgeService) -> None:
    kb = await svc.create_kb(name="brain")
    assert await svc.search(kb.id, "") == []
    assert await svc.search(kb.id, "   ") == []


async def test_create_kb_honors_explicit_embedding_ref(svc: KnowledgeService) -> None:
    kb = await svc.create_kb(name="alt", embedding_model_ref="mock:hash-128")
    assert kb.embedding_model_ref == "mock:hash-128"
    assert kb.embedding_dim == 128


async def test_list_embedding_models_marks_mock_available_and_default(
    svc: KnowledgeService,
) -> None:
    opts = await svc.list_embedding_models()
    refs = [o.ref for o in opts]
    # Mock dims always present
    assert "mock:hash-64" in refs
    assert "mock:hash-256" in refs
    # OpenAI / aliyun present but conditional on creds
    assert any(o.ref.startswith("openai:") for o in opts)
    assert any(o.ref.startswith("aliyun:") for o in opts)
    # Mock is always available
    assert all(o.available for o in opts if o.ref.startswith("mock:"))
    # Default surfaces; in test env it's mock:hash-64
    defaults = [o for o in opts if o.is_default]
    assert len(defaults) == 1
    assert defaults[0].ref == "mock:hash-64"


def test_default_embedding_model_ref_pulled_from_settings() -> None:
    # Settings.kb_default_embedding_model_ref drives the default
    assert KnowledgeService.default_embedding_model_ref() == "mock:hash-64"


# ---------------------------------------------------------------------------
# ask_stream — frame protocol & multi-turn history
# ---------------------------------------------------------------------------


async def test_ask_stream_emits_sources_then_deltas_then_done(
    svc: KnowledgeService,
) -> None:
    """Streaming Ask must yield sources first, deltas in order, done last.

    We monkey-patch `_call_chat_llm_stream` so the test doesn't need a real
    LLMProvider. The contract under test is purely the framing.
    """
    kb = await svc.create_kb(name="brain")
    await svc.upload_document(kb.id, title="Survey", content_bytes=_SAMPLE_MD, filename="survey.md")

    async def fake_stream(*_args: object, **_kwargs: object):
        for piece, ref in [("Hello ", "fake:model"), ("world.", "")]:
            yield piece, ref

    # Bind patched method to instance via setattr (avoid mypy 'method assign')
    svc._call_chat_llm_stream = fake_stream  # type: ignore[method-assign]

    frames: list[dict] = []  # type: ignore[type-arg]
    async for f in svc.ask_stream(kb.id, "what is rrf"):
        frames.append(f)

    events = [f["event"] for f in frames]
    assert events[0] == "sources"
    assert events[-1] == "done"
    assert events.count("delta") == 2
    # Sources must be a non-empty list of citation dicts in order
    src = frames[0]["sources"]
    assert isinstance(src, list) and len(src) > 0
    assert src[0]["n"] == 1 and "chunk_id" in src[0]
    # Deltas in arrival order
    deltas = [f["text"] for f in frames if f["event"] == "delta"]
    assert deltas == ["Hello ", "world."]
    # Done frame carries model + latency
    done = frames[-1]
    assert done["used_model"] == "fake:model"
    assert isinstance(done["latency_ms"], (int, float)) and done["latency_ms"] >= 0


async def test_ask_stream_no_hits_yields_friendly_delta_then_done(
    svc: KnowledgeService,
) -> None:
    """Empty retrieval still completes with a single delta + done — the
    UI should never see a hanging stream just because the KB lacks the
    answer."""
    kb = await svc.create_kb(name="empty")
    frames: list[dict] = []  # type: ignore[type-arg]
    async for f in svc.ask_stream(kb.id, "anything"):
        frames.append(f)
    assert frames[0]["event"] == "sources"
    assert frames[0]["sources"] == []
    assert frames[1]["event"] == "delta"
    assert "知识库" in frames[1]["text"]
    assert frames[2]["event"] == "done"
    assert frames[2]["used_model"] is None


async def test_suggest_tags_returns_empty_when_no_provider(
    svc: KnowledgeService,
) -> None:
    kb = await svc.create_kb(name="brain")
    doc = await svc.upload_document(
        kb.id, title="Hybrid Retrieval", content_bytes=_SAMPLE_MD, filename="t.md"
    )
    assert await svc.suggest_tags_for_document(doc.id) == []


async def test_suggest_tags_parses_and_dedupes_llm_output(
    svc: KnowledgeService,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """LLM output may have wrapping #, quotes, numbering and dups; the
    service should normalise to a clean lowercase list ≤ max_tags."""
    kb = await svc.create_kb(name="brain")
    doc = await svc.upload_document(kb.id, title="t", content_bytes=_SAMPLE_MD, filename="t.md")

    async def fake(self, system, user, *, model_ref=None, history=None):
        return "1. #Retrieval\n- 'BM25'\nretrieval\n* re-ranking", "fake"

    # monkeypatch auto-restores after the test → doesn't leak the fake
    # method to the starter-questions / history tests below.
    monkeypatch.setattr(KnowledgeService, "_call_chat_llm", fake)
    tags = await svc.suggest_tags_for_document(doc.id, max_tags=3)
    assert tags == ["retrieval", "bm25", "re-ranking"]


async def test_reembed_all_processes_each_doc(svc: KnowledgeService) -> None:
    """reembed_all hits every doc · returns processed/succeeded/failed
    counters · per-doc errors don't abort the loop."""
    kb = await svc.create_kb(name="brain")
    await svc.upload_document(kb.id, title="A", content_bytes=_SAMPLE_MD, filename="a.md")
    await svc.upload_document(kb.id, title="B", content_bytes=b"# B\n\nbody", filename="b.md")
    res = await svc.reembed_all(kb.id)
    assert res["processed"] == 2
    assert res["succeeded"] == 2  # mock embedder always succeeds
    assert res["failed"] == 0


async def test_chunks_missing_embeddings_is_zero_with_mock(
    svc: KnowledgeService,
) -> None:
    """Mock embedder always populates `chunk.embedding`, so a freshly
    ingested KB should have 0 chunks-missing-embeddings — the banner
    won't fire in the happy path."""
    kb = await svc.create_kb(name="brain")
    await svc.upload_document(kb.id, title="t", content_bytes=_SAMPLE_MD, filename="t.md")
    assert await svc.get_chunks_missing_embeddings(kb.id) == 0


async def test_get_kb_health_aggregates_and_buckets(
    svc: KnowledgeService,
) -> None:
    """Health snapshot: totals match KB row · daily_doc_counts has the
    requested length, oldest first, today rightmost · top_tags counts
    occurrences across all docs · mime_breakdown sorted desc."""
    kb = await svc.create_kb(name="brain")
    await svc.upload_document(
        kb.id, title="A", content_bytes=_SAMPLE_MD, filename="a.md", tags=["x", "y"]
    )
    await svc.upload_document(
        kb.id, title="B", content_bytes=b"# B\n\nbody", filename="b.md", tags=["x"]
    )
    h = await svc.get_kb_health(kb.id, days=7)

    assert h["doc_count"] == 2
    assert h["chunk_count"] >= 2  # at least one chunk per doc
    assert h["token_sum"] > 0
    assert h["last_activity"] is not None

    daily = h["daily_doc_counts"]
    assert len(daily) == 7
    # Today bucket (rightmost) should hold both freshly-uploaded docs
    assert daily[-1]["count"] == 2
    # Oldest bucket should be empty
    assert daily[0]["count"] == 0
    # Bucket dates monotonically increasing
    dates = [d["date"] for d in daily]
    assert dates == sorted(dates)

    # x appears in both docs → most frequent tag
    assert h["top_tags"][0] == {"tag": "x", "count": 2}

    # Both mime types present
    mimes = {b["mime"] for b in h["mime_breakdown"]}
    assert any("markdown" in m or "plain" in m for m in mimes)


async def test_get_kb_health_empty_kb(svc: KnowledgeService) -> None:
    kb = await svc.create_kb(name="empty")
    h = await svc.get_kb_health(kb.id, days=14)
    assert h["doc_count"] == 0
    assert h["chunk_count"] == 0
    assert h["token_sum"] == 0
    assert h["last_activity"] is None
    assert all(d["count"] == 0 for d in h["daily_doc_counts"])
    assert h["top_tags"] == []
    assert h["mime_breakdown"] == []


async def test_update_document_tags_add_remove_replace(
    svc: KnowledgeService,
) -> None:
    """Three-shape API: add / remove / replace mutate tag list as
    advertised. Add is a dedup union; remove drops only listed; replace
    overrides wholesale."""
    kb = await svc.create_kb(name="brain")
    doc = await svc.upload_document(
        kb.id, title="t", content_bytes=b"# t\n\nx", filename="t.md", tags=["a", "b"]
    )
    after_add = await svc.update_document_tags(doc.id, add=["c", "a"])
    assert after_add.tags == ["a", "b", "c"]
    after_rm = await svc.update_document_tags(doc.id, remove=["b"])
    assert after_rm.tags == ["a", "c"]
    after_replace = await svc.update_document_tags(doc.id, replace=["only", "two"])
    assert after_replace.tags == ["only", "two"]


async def test_suggest_starter_questions_falls_back_when_no_chat_provider(
    svc: KnowledgeService,
) -> None:
    """No chat provider → graceful '<title> 里讲了什么?' fallback rather
    than raising; UI counts on this so the chip row never disappears
    just because /gateway is empty."""
    kb = await svc.create_kb(name="brain")
    await svc.upload_document(
        kb.id, title="Hybrid Retrieval", content_bytes=_SAMPLE_MD, filename="a.md"
    )
    qs = await svc.suggest_starter_questions(kb.id, limit=2)
    assert isinstance(qs, list)
    assert len(qs) == 1  # only one doc → one fallback question
    assert "Hybrid Retrieval" in qs[0]


async def test_suggest_starter_questions_empty_kb_returns_empty(
    svc: KnowledgeService,
) -> None:
    kb = await svc.create_kb(name="empty")
    assert await svc.suggest_starter_questions(kb.id) == []


async def test_suggest_starter_questions_uses_llm_and_caches(
    svc: KnowledgeService,
) -> None:
    kb = await svc.create_kb(name="brain")
    await svc.upload_document(
        kb.id, title="Hybrid Retrieval", content_bytes=_SAMPLE_MD, filename="a.md"
    )

    calls: list[int] = []

    async def fake(self, system, user, *, model_ref=None, history=None):
        calls.append(1)
        return (
            "RRF 怎么工作?\nbge-reranker 提升多少?\n关键词命中和向量召回有什么差?",
            "fake",
        )

    KnowledgeService._call_chat_llm = fake  # type: ignore[method-assign,assignment]
    qs1 = await svc.suggest_starter_questions(kb.id, limit=3)
    qs2 = await svc.suggest_starter_questions(kb.id, limit=3)
    assert (
        qs1
        == qs2
        == [
            "RRF 怎么工作?",
            "bge-reranker 提升多少?",
            "关键词命中和向量召回有什么差?",
        ]
    )
    assert len(calls) == 1, "second call must hit the cache"


async def test_ask_history_appended_into_messages(svc: KnowledgeService) -> None:
    """When ``history`` is passed, prior turns must reach the chat model
    as alternating Human/AI messages between the system and the new user
    turn — that's what makes follow-ups resolvable ("what about X?")."""
    kb = await svc.create_kb(name="brain")
    await svc.upload_document(kb.id, title="Survey", content_bytes=_SAMPLE_MD, filename="survey.md")

    captured: dict[str, object] = {}

    async def fake_call(self, system, user, *, model_ref=None, history=None):
        captured["system"] = system
        captured["user"] = user
        captured["history"] = history
        return "answer", "fake:model"

    KnowledgeService._call_chat_llm = fake_call  # type: ignore[method-assign,assignment]
    out = await svc.ask(
        kb.id,
        "what about reranking?",
        history=[
            {"role": "user", "content": "what is rrf?"},
            {"role": "assistant", "content": "RRF is a fusion method [1]."},
        ],
    )
    assert out["used_model"] == "fake:model"
    assert captured["history"] == [
        {"role": "user", "content": "what is rrf?"},
        {"role": "assistant", "content": "RRF is a fusion method [1]."},
    ]
    # System prompt mentions multi-turn citation rule
    assert "多轮" in str(captured["system"])
