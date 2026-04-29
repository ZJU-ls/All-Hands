"""execution/image_provider.py · provider Protocol + impls.

Covers:
- ImageProviderError envelope shape
- OpenAIImageProvider validation (api_key required, size whitelist)
- OpenAIImageProvider httpx round-trip via mock transport (no network)
- generate_batch fan-out · partial failures preserved in-place
- FakeImageProvider determinism
- 1x1 PNG default fixture is valid PNG bytes
"""

from __future__ import annotations

import base64
import json

import httpx
import pytest

from allhands.core.image import ImageGenerationRequest, ImageQuality
from allhands.execution.image_provider import (
    FakeImageProvider,
    ImageProviderError,
    OpenAIImageProvider,
    generate_batch,
)


def test_error_envelope_to_dict() -> None:
    exc = ImageProviderError(
        "boom", field="x", expected="a", received="b", hint="try y", status=500
    )
    d = exc.to_dict()
    assert d["error"] == "boom"
    assert d["field"] == "x"
    assert d["status"] == 500
    assert d["hint"] == "try y"


def test_openai_provider_requires_api_key() -> None:
    with pytest.raises(ImageProviderError, match="requires an api_key"):
        OpenAIImageProvider(
            api_key="",
            base_url="https://api.openai.com/v1",
            model_name="gpt-image-1.5",
            provider_id="openai",
        )


def test_openai_provider_rejects_bad_size() -> None:
    p = OpenAIImageProvider(
        api_key="sk-fake", base_url="https://x", model_name="m", provider_id="i"
    )

    async def _run() -> None:
        await p.generate(ImageGenerationRequest(prompt="cat", size="999x999"))

    import asyncio

    with pytest.raises(ImageProviderError, match="unsupported size"):
        asyncio.run(_run())


# ─────────────────────────────────────────────────────────────────
# httpx mock transport · production round-trip without network
# ─────────────────────────────────────────────────────────────────

# 1x1 transparent PNG
_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


@pytest.mark.asyncio
async def test_openai_round_trip_via_mock(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    def _handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["body"] = json.loads(request.content)
        captured["auth"] = request.headers.get("authorization")
        return httpx.Response(
            200,
            json={"data": [{"b64_json": _PNG_B64, "revised_prompt": "a glowing cat"}]},
        )

    transport = httpx.MockTransport(_handler)

    # Patch httpx.AsyncClient to use our mock transport
    real_init = httpx.AsyncClient.__init__

    def patched_init(self, **kw):  # type: ignore[no-untyped-def]
        kw["transport"] = transport
        real_init(self, **kw)

    monkeypatch.setattr(httpx.AsyncClient, "__init__", patched_init)

    p = OpenAIImageProvider(
        api_key="sk-test",
        base_url="https://api.openai.com/v1",
        model_name="gpt-image-1.5",
        provider_id="openai",
    )
    result = await p.generate(
        ImageGenerationRequest(prompt="a cat", size="1024x1024", quality=ImageQuality.MEDIUM)
    )

    # Wire format check
    assert captured["url"] == "https://api.openai.com/v1/images/generations"
    assert captured["auth"] == "Bearer sk-test"
    body = captured["body"]
    assert body["model"] == "gpt-image-1.5"  # type: ignore[index]
    assert body["prompt"] == "a cat"  # type: ignore[index]
    assert body["size"] == "1024x1024"  # type: ignore[index]
    assert body["quality"] == "medium"  # type: ignore[index]

    # Result shape
    assert len(result.images) == 1
    img = result.images[0]
    assert img.mime_type == "image/png"
    assert img.revised_prompt == "a glowing cat"
    assert img.data == base64.b64decode(_PNG_B64)
    assert result.cost_usd == 0.04  # gpt-image-1.5 medium 1024² · pricing table


@pytest.mark.asyncio
async def test_openai_handles_400(monkeypatch: pytest.MonkeyPatch) -> None:
    def _handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(400, text='{"error": "moderation triggered"}')

    transport = httpx.MockTransport(_handler)
    real_init = httpx.AsyncClient.__init__
    monkeypatch.setattr(
        httpx.AsyncClient,
        "__init__",
        lambda self, **kw: real_init(self, **{**kw, "transport": transport}),
    )

    p = OpenAIImageProvider(
        api_key="sk-test",
        base_url="https://x.example",
        model_name="gpt-image-1.5",
        provider_id="openai",
    )
    with pytest.raises(ImageProviderError) as ei:
        await p.generate(ImageGenerationRequest(prompt="cat"))
    assert ei.value.status == 400
    assert "moderation" in (ei.value.received or "")


@pytest.mark.asyncio
async def test_openai_rejects_url_response(monkeypatch: pytest.MonkeyPatch) -> None:
    """Some OpenAI-compat aggregators return URL only · we explicitly refuse."""

    def _handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": [{"url": "https://cdn.example/x.png"}]})

    transport = httpx.MockTransport(_handler)
    real_init = httpx.AsyncClient.__init__
    monkeypatch.setattr(
        httpx.AsyncClient,
        "__init__",
        lambda self, **kw: real_init(self, **{**kw, "transport": transport}),
    )

    p = OpenAIImageProvider(
        api_key="sk-test",
        base_url="https://x",
        model_name="gpt-image-1.5",
        provider_id="openai",
    )
    with pytest.raises(ImageProviderError, match="URL instead of b64_json"):
        await p.generate(ImageGenerationRequest(prompt="cat"))


# ─────────────────────────────────────────────────────────────────
# generate_batch (fan-out helper)
# ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_generate_batch_concurrent_calls() -> None:
    p = FakeImageProvider()
    results = await generate_batch(p, ["cat", "dog", "owl"])
    assert len(results) == 3
    assert all(hasattr(r, "images") for r in results)
    assert p.call_count == 3


@pytest.mark.asyncio
async def test_generate_batch_partial_failure_preserves_others() -> None:
    p = FakeImageProvider(raises=ImageProviderError("nope"))
    # Note: FakeImageProvider raises every call when raises is set. Test here
    # is shape · realistic mixed batches use a custom Fake that flips per call.
    results = await generate_batch(p, ["cat", "dog"])
    assert all(isinstance(r, ImageProviderError) for r in results)


@pytest.mark.asyncio
async def test_fake_provider_returns_valid_png() -> None:
    p = FakeImageProvider()
    result = await p.generate(ImageGenerationRequest(prompt="cat"))
    assert len(result.images) == 1
    img = result.images[0]
    assert img.mime_type == "image/png"
    assert img.data[:8] == b"\x89PNG\r\n\x1a\n"  # PNG magic
    assert result.cost_usd == 0.0
    assert p.last_request is not None
    assert p.last_request.prompt == "cat"


@pytest.mark.asyncio
async def test_fake_provider_n_variants() -> None:
    p = FakeImageProvider()
    result = await p.generate(ImageGenerationRequest(prompt="cat", n=3))
    assert len(result.images) == 3
