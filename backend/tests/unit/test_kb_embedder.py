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


async def test_embedder_respects_provider_max_batch_size() -> None:
    """When a provider declares max_batch_size (e.g. aliyun caps at 10),
    the embedder must chunk down to it even when EmbedderConfig.batch_size
    is larger. Regression for the 2026-04-28 bug:
        '<400> InternalError.Algo.InvalidParameter: ...
         batch size is invalid, it should not be larger than 10'
    """
    from allhands.execution.knowledge.embedder import (
        EmbedderConfig,
        EmbeddingProvider,
    )

    seen: list[int] = []

    async def capped_embed(texts: list[str]) -> list[list[float]]:
        seen.append(len(texts))
        return [normalize([0.1] * 4) for _ in texts]

    provider = EmbeddingProvider(
        name="aliyun:text-embedding-v4",
        dim=4,
        embed=capped_embed,
        max_batch_size=10,
    )
    emb = Embedder(
        model_ref=provider.name,
        provider=provider,
        config=EmbedderConfig(batch_size=64),
    )
    await emb.embed_texts([f"text {i}" for i in range(25)])
    # 25 / 10 → batches of 10, 10, 5
    assert seen == [10, 10, 5]


def test_resolve_provider_aliyun_sets_max_batch_10() -> None:
    """resolve_provider must wire max_batch_size=10 for aliyun/bailian
    schemes so the upstream batch-of-10 cap is honoured automatically."""

    class _S:
        dashscope_api_key = "fake"

    p = resolve_provider("aliyun:text-embedding-v4", settings_lookup=lambda: _S())
    assert p.max_batch_size == 10
    p2 = resolve_provider("bailian:text-embedding-v3", settings_lookup=lambda: _S())
    assert p2.max_batch_size == 10


def test_resolve_provider_openai_no_batch_cap() -> None:
    """OpenAI doesn't have such a cap; provider must leave it None."""

    class _S:
        openai_api_key = "fake"

    p = resolve_provider("openai:text-embedding-3-small", settings_lookup=lambda: _S())
    assert p.max_batch_size is None
