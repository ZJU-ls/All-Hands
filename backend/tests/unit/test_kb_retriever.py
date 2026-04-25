"""Retriever / RRF tests — deterministic without DB."""

from __future__ import annotations

from allhands.execution.knowledge.retriever import _RankedList, rrf_fuse


def test_rrf_picks_chunk_top_in_both_lists() -> None:
    # chunk 2 ranks 2 in list a, rank 1 in list b → should win
    a = _RankedList(items=[(1, 10.0), (2, 8.0), (3, 6.0)], weight=1.0)
    b = _RankedList(items=[(2, 9.0), (4, 7.0), (1, 5.0)], weight=1.0)
    fused = rrf_fuse([a, b])
    fused_ids = [cid for cid, _ in fused]
    assert fused_ids[0] == 2


def test_rrf_weight_skews_winner() -> None:
    a = _RankedList(items=[(1, 10.0), (2, 9.0)], weight=10.0)
    b = _RankedList(items=[(2, 10.0), (1, 9.0)], weight=1.0)
    # a is heavily weighted → its rank-1 (chunk 1) should win
    fused = rrf_fuse([a, b])
    assert fused[0][0] == 1


def test_rrf_handles_disjoint_lists() -> None:
    a = _RankedList(items=[(1, 10.0)], weight=1.0)
    b = _RankedList(items=[(2, 10.0)], weight=1.0)
    fused = rrf_fuse([a, b])
    # Both chunks present, equal scores
    assert {cid for cid, _ in fused} == {1, 2}
    assert fused[0][1] == fused[1][1]
