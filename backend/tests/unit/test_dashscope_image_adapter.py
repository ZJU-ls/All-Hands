"""DashScopeImageAdapter · wire-format + polling tests via httpx.MockTransport.

No real network; we hand-construct the upstream sequence:

  POST /services/aigc/text2image/image-synthesis  → 200 {task_id, PENDING}
  GET  /tasks/{id}                                → 200 {RUNNING}
  GET  /tasks/{id}                                → 200 {SUCCEEDED, results: [{url}]}
  GET  {url}                                      → 200 PNG bytes

The polling loop, terminal-status handling, base-url normalization,
size-format conversion, and content-policy block fallbacks are all
covered without spending a single API call.
"""

from __future__ import annotations

import base64

import httpx
import pytest

from allhands.core.image import ImageGenerationRequest
from allhands.core.model import Capability, LLMModel
from allhands.core.provider import LLMProvider
from allhands.execution.model_gateway.adapters.dashscope_image import (
    DashScopeImageAdapter,
    _to_dashscope_size,
)
from allhands.execution.model_gateway.adapters.openai_image import ImageProviderError

_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)
_PNG_BYTES = base64.b64decode(_PNG_B64)


def _provider(base_url: str = "https://dashscope.aliyuncs.com/api/v1") -> LLMProvider:
    return LLMProvider(
        id="bailian",
        name="百炼",
        kind="aliyun",
        base_url=base_url,
        api_key="sk-test-1234",
    )


def _model(name: str = "wanx-v1") -> LLMModel:
    return LLMModel(
        id="m-1",
        provider_id="bailian",
        name=name,
        capabilities=[Capability.IMAGE_GEN],
    )


# ─────────────────────────────────────────────────────────────────────
# Pure helpers
# ─────────────────────────────────────────────────────────────────────


def test_size_conversion() -> None:
    assert _to_dashscope_size("1024x1024") == "1024*1024"
    assert _to_dashscope_size("1024x1536") == "1024*1536"
    assert _to_dashscope_size("auto") == "1024*1024"


@pytest.mark.asyncio
async def test_size_above_wanx_cap_rejected_with_hint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Real-LLM soak found wanx tops out at 1440 per dim. Pre-flight
    rejection saves a 4-5s round trip and gives the agent a structured
    envelope it can act on (ADR 0021)."""

    def _handler(req: httpx.Request) -> httpx.Response:  # pragma: no cover
        raise AssertionError("should not reach DashScope")

    _patch_httpx(monkeypatch, httpx.MockTransport(_handler))
    a = DashScopeImageAdapter(poll_interval_seconds=0.0)
    with pytest.raises(ImageProviderError, match="wanx"):
        await a.generate(
            ImageGenerationRequest(prompt="cat", size="1536x1024"),
            provider=_provider(),
            model=_model(),
        )


# ─────────────────────────────────────────────────────────────────────
# Mock transport scaffolding
# ─────────────────────────────────────────────────────────────────────


def _build_handler(*, post_payload: dict, poll_sequence: list[dict], png: bytes = _PNG_BYTES):
    """Returns a handler that walks through the sequence in order."""
    state = {"poll_index": 0, "captured_post": None}

    def _handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if request.method == "POST" and "image-synthesis" in url:
            state["captured_post"] = {
                "url": url,
                "headers": dict(request.headers),
                "body": request.content.decode(),
            }
            return httpx.Response(200, json=post_payload)
        if request.method == "GET" and "/tasks/" in url:
            i = state["poll_index"]
            state["poll_index"] = i + 1
            if i >= len(poll_sequence):
                raise AssertionError(
                    f"poll sequence exhausted (index {i}, have {len(poll_sequence)})"
                )
            return httpx.Response(200, json=poll_sequence[i])
        if request.method == "GET":
            # Image download
            return httpx.Response(200, content=png)
        raise AssertionError(f"unexpected request: {request.method} {url}")

    return _handler, state


def _patch_httpx(monkeypatch: pytest.MonkeyPatch, transport: httpx.MockTransport) -> None:
    real = httpx.AsyncClient.__init__
    monkeypatch.setattr(
        httpx.AsyncClient,
        "__init__",
        lambda self, **kw: real(self, **{**kw, "transport": transport}),
    )


# ─────────────────────────────────────────────────────────────────────
# supports() shape tests
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_supports_only_aliyun_kind() -> None:
    a = DashScopeImageAdapter()
    assert await a.supports(provider=_provider(), model=_model()) is True
    openai = LLMProvider(id="o", name="o", kind="openai", base_url="https://x", api_key="k")
    assert await a.supports(provider=openai, model=_model()) is False


@pytest.mark.asyncio
async def test_supports_any_aliyun_image_model() -> None:
    """Post-2026-05-05 the adapter trusts the registry (capabilities on
    LLMModel) rather than name-substring matching. Any model whose
    provider.kind=='aliyun' passes — it's the user's job to mark a
    non-image model as non-image at registration time. Misclassification
    surfaces as a clear server error from the upstream API instead of
    a confusing "no adapter accepts" message."""
    a = DashScopeImageAdapter()
    assert await a.supports(provider=_provider(), model=_model("wanx-v1")) is True
    assert await a.supports(provider=_provider(), model=_model("wan2.5-t2i-preview")) is True
    assert await a.supports(provider=_provider(), model=_model("wan2.7-image-pro")) is True
    # Registry trust: even a name without "wan" gets accepted, the gateway
    # routes by capability + provider.kind.
    assert await a.supports(provider=_provider(), model=_model("flux-dev")) is True


# ─────────────────────────────────────────────────────────────────────
# Happy path: POST → poll-pending → poll-success → download
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_full_flow_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    handler, state = _build_handler(
        post_payload={
            "output": {"task_id": "t-123", "task_status": "PENDING"},
            "request_id": "r-1",
        },
        poll_sequence=[
            {"output": {"task_id": "t-123", "task_status": "PENDING"}},
            {"output": {"task_id": "t-123", "task_status": "RUNNING"}},
            {
                "output": {
                    "task_id": "t-123",
                    "task_status": "SUCCEEDED",
                    "results": [{"url": "https://oss/img1.png"}],
                }
            },
        ],
    )
    _patch_httpx(monkeypatch, httpx.MockTransport(handler))

    a = DashScopeImageAdapter(poll_interval_seconds=0.0, poll_timeout_seconds=10)
    result = await a.generate(
        ImageGenerationRequest(prompt="一只可爱的橘猫", size="1024x1024"),
        provider=_provider(),
        model=_model(),
    )

    assert len(result.images) == 1
    img = result.images[0]
    assert img.data == _PNG_BYTES
    assert img.mime_type == "image/png"
    assert result.model_used == "wanx-v1"
    assert result.provider_id == "bailian"

    captured = state["captured_post"]
    assert captured["url"].endswith("/services/aigc/text2image/image-synthesis")
    assert "Bearer sk-test-1234" in captured["headers"]["authorization"]
    assert captured["headers"]["x-dashscope-async"] == "enable"
    # Body uses DashScope's asterisk-size format
    assert "1024*1024" in captured["body"]
    assert "一只可爱的橘猫" in captured["body"]


# ─────────────────────────────────────────────────────────────────────
# base_url normalization · accept the 3 common forms
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "configured_base",
    [
        "https://dashscope.aliyuncs.com/api/v1",  # native
        "https://dashscope.aliyuncs.com/compatible-mode/v1",  # OpenAI-compat (chat use)
        "https://dashscope.aliyuncs.com",  # bare
    ],
)
async def test_base_url_normalized(monkeypatch: pytest.MonkeyPatch, configured_base: str) -> None:
    handler, state = _build_handler(
        post_payload={"output": {"task_id": "t1", "task_status": "PENDING"}},
        poll_sequence=[
            {
                "output": {
                    "task_id": "t1",
                    "task_status": "SUCCEEDED",
                    "results": [{"url": "https://oss/img.png"}],
                }
            }
        ],
    )
    _patch_httpx(monkeypatch, httpx.MockTransport(handler))

    a = DashScopeImageAdapter(poll_interval_seconds=0.0)
    await a.generate(
        ImageGenerationRequest(prompt="cat"),
        provider=_provider(configured_base),
        model=_model(),
    )
    assert state["captured_post"]["url"].startswith("https://dashscope.aliyuncs.com/api/v1")


# ─────────────────────────────────────────────────────────────────────
# Failure cases
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_post_400_surfaces_envelope(monkeypatch: pytest.MonkeyPatch) -> None:
    def _handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(400, text='{"code":"InvalidParameter","message":"bad model"}')

    _patch_httpx(monkeypatch, httpx.MockTransport(_handler))
    a = DashScopeImageAdapter(poll_interval_seconds=0.0)
    with pytest.raises(ImageProviderError) as ei:
        await a.generate(ImageGenerationRequest(prompt="cat"), provider=_provider(), model=_model())
    assert ei.value.status == 400
    assert "InvalidParameter" in (ei.value.received or "")


@pytest.mark.asyncio
async def test_no_task_id_surfaces_envelope(monkeypatch: pytest.MonkeyPatch) -> None:
    def _handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"output": {}, "request_id": "r"})

    _patch_httpx(monkeypatch, httpx.MockTransport(_handler))
    a = DashScopeImageAdapter(poll_interval_seconds=0.0)
    with pytest.raises(ImageProviderError, match="no task_id"):
        await a.generate(ImageGenerationRequest(prompt="cat"), provider=_provider(), model=_model())


@pytest.mark.asyncio
async def test_task_failed_surfaces_envelope(monkeypatch: pytest.MonkeyPatch) -> None:
    handler, _ = _build_handler(
        post_payload={"output": {"task_id": "t1", "task_status": "PENDING"}},
        poll_sequence=[
            {
                "output": {
                    "task_id": "t1",
                    "task_status": "FAILED",
                    "message": "moderation triggered",
                }
            }
        ],
    )
    _patch_httpx(monkeypatch, httpx.MockTransport(handler))
    a = DashScopeImageAdapter(poll_interval_seconds=0.0)
    with pytest.raises(ImageProviderError, match="FAILED"):
        await a.generate(ImageGenerationRequest(prompt="cat"), provider=_provider(), model=_model())


@pytest.mark.asyncio
async def test_poll_timeout_surfaces_envelope(monkeypatch: pytest.MonkeyPatch) -> None:
    """Force the deadline to expire by feeding pending-only responses."""
    pending = {"output": {"task_id": "t1", "task_status": "PENDING"}}
    handler, _ = _build_handler(post_payload=pending, poll_sequence=[pending] * 50)
    _patch_httpx(monkeypatch, httpx.MockTransport(handler))
    a = DashScopeImageAdapter(poll_timeout_seconds=0.05, poll_interval_seconds=0.01)
    with pytest.raises(ImageProviderError, match="timed out"):
        await a.generate(ImageGenerationRequest(prompt="cat"), provider=_provider(), model=_model())


@pytest.mark.asyncio
async def test_content_policy_block_all_surfaces_envelope(monkeypatch: pytest.MonkeyPatch) -> None:
    """Task succeeds but every result has a code (= blocked) → all images dropped."""
    handler, _ = _build_handler(
        post_payload={"output": {"task_id": "t1", "task_status": "PENDING"}},
        poll_sequence=[
            {
                "output": {
                    "task_id": "t1",
                    "task_status": "SUCCEEDED",
                    "results": [{"code": "DataInspectionFailed", "message": "blocked"}],
                }
            }
        ],
    )
    _patch_httpx(monkeypatch, httpx.MockTransport(handler))
    a = DashScopeImageAdapter(poll_interval_seconds=0.0)
    with pytest.raises(ImageProviderError, match="content policy"):
        await a.generate(ImageGenerationRequest(prompt="cat"), provider=_provider(), model=_model())


@pytest.mark.asyncio
async def test_no_api_key_envelope() -> None:
    a = DashScopeImageAdapter(poll_interval_seconds=0.0)
    p = LLMProvider(id="x", name="x", kind="aliyun", base_url="https://y", api_key="")
    with pytest.raises(ImageProviderError, match="api_key"):
        await a.generate(ImageGenerationRequest(prompt="cat"), provider=p, model=_model())
