"""Embedder + vector primitives tests."""

from __future__ import annotations

import pytest

from allhands.execution.knowledge.embedder import Embedder, resolve_provider
from allhands.execution.knowledge.vector import cosine, normalize, pack_vector, unpack_vector


def test_pack_unpack_roundtrip_preserves_values() -> None:
    v = [0.1, -0.5, 0.9, 1.0]
    blob = pack_vector(v)
    assert len(blob) == 4 * 4
    back = unpack_vector(blob, 4)
    assert all(abs(a - b) < 1e-6 for a, b in zip(v, back, strict=True))


def test_normalize_returns_unit_length() -> None:
    out = normalize([3.0, 4.0])
    # 3-4-5 triangle → norm 5
    assert abs(out[0] - 0.6) < 1e-6
    assert abs(out[1] - 0.8) < 1e-6


def test_cosine_identical_vectors_is_one() -> None:
    v = normalize([1.0, 2.0, 3.0])
    assert abs(cosine(v, v) - 1.0) < 1e-6


def test_cosine_orthogonal_is_zero() -> None:
    a = [1.0, 0.0]
    b = [0.0, 1.0]
    assert abs(cosine(a, b)) < 1e-6


async def test_mock_embedder_is_deterministic_and_discriminative() -> None:
    provider = resolve_provider("mock:hash-64")
    emb = Embedder(model_ref="mock:hash-64", provider=provider)
    a, b = await emb.embed_texts(["hello world", "hello world"])
    (c,) = await emb.embed_texts(["完全无关的中文"])
    # identical text → identical vec
    assert cosine(a, b) > 0.999
    # different text → cosine should be much lower
    assert cosine(a, c) < 0.5


def test_resolve_provider_rejects_unknown_scheme() -> None:
    with pytest.raises(ValueError):
        resolve_provider("unsupported:foo")


def test_resolve_provider_mock_dim_parsed_from_ref() -> None:
    p = resolve_provider("mock:hash-128")
    assert p.dim == 128
