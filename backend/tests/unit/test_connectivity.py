"""Unit tests for `services.connectivity` — the first-principles probes.

Validates the two key contracts from the design:

  1. **Endpoint probe** classifies network/HTTP outcomes correctly:
       2xx → reachable, auth_ok=True
       401/403 → reachable, auth_ok=False
       5xx → reachable, auth_ok=None  (server-side issue, not auth)
       network/dns/timeout exceptions → reachable=False

  2. **Model probe** uses a STRICT WHITELIST: only network / timeout / auth /
     model_not_found flip `usable=False`. 400 / 422 / 429 / 5xx must keep
     `usable=True` because the server processed our request — that proves
     connectivity, even if THIS specific call had a problem.

This whitelist is the exact lesson the Qwen-thinking / MiniMax-on-DashScope
incident taught us: a vendor 400 over an unknown body field doesn't mean the
model is unreachable; it means our payload was wrong. Connectivity tests
must not conflate the two.
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from allhands.core.provider import LLMProvider
from allhands.services.connectivity import (
    SLOW_THRESHOLD_MS,
    overall_status,
    probe_endpoint,
    probe_model,
    to_legacy_shape,
)


def _provider(kind: str = "openai", base_url: str = "https://api.example.com/v1") -> LLMProvider:
    return LLMProvider(
        id="p1",
        name="P",
        kind=kind,  # type: ignore[arg-type]
        base_url=base_url,
        api_key="sk-test",
    )


def _client(handler: Any) -> httpx.AsyncClient:
    """Build an httpx.AsyncClient with a MockTransport — no real network."""
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


# ---------------------------------------------------------------------------
# Endpoint probe
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_endpoint_200_is_reachable_and_auth_ok() -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        assert req.method == "GET"
        # OpenAI compat path: /v1/models
        assert req.url.path.endswith("/models")
        # Bearer header is forwarded
        assert req.headers.get("Authorization") == "Bearer sk-test"
        return httpx.Response(200, json={"data": []})

    async with _client(handler) as c:
        r = await probe_endpoint(_provider(), http_client=c)

    assert r.reachable is True
    assert r.auth_ok is True
    assert r.status_code == 200
    assert r.error_kind == "ok"
    assert r.error is None


@pytest.mark.asyncio
async def test_endpoint_401_is_reachable_but_auth_failed() -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(401, text="invalid api key")

    async with _client(handler) as c:
        r = await probe_endpoint(_provider(), http_client=c)

    assert r.reachable is True
    assert r.auth_ok is False
    assert r.status_code == 401
    assert r.error_kind == "auth"


@pytest.mark.asyncio
async def test_endpoint_5xx_is_reachable_auth_unknown() -> None:
    """5xx tells us the server is up enough to fail — auth is undetermined."""

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(503, text="upstream down")

    async with _client(handler) as c:
        r = await probe_endpoint(_provider(), http_client=c)

    assert r.reachable is True
    assert r.auth_ok is None
    assert r.error_kind == "server_error"


@pytest.mark.asyncio
async def test_endpoint_network_error_is_unreachable() -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("Name or service not known")

    async with _client(handler) as c:
        r = await probe_endpoint(_provider(), http_client=c)

    assert r.reachable is False
    assert r.auth_ok is None
    assert r.status_code is None
    assert r.error_kind == "network"
    assert r.error is not None and "ConnectError" in r.error


@pytest.mark.asyncio
async def test_endpoint_timeout_classified_as_timeout() -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timeout")

    async with _client(handler) as c:
        r = await probe_endpoint(_provider(), http_client=c)

    assert r.reachable is False
    assert r.error_kind == "timeout"


@pytest.mark.asyncio
async def test_endpoint_anthropic_kind_uses_x_api_key() -> None:
    """Anthropic-compat speaks `x-api-key`, not Bearer."""
    captured: dict[str, str] = {}

    def handler(req: httpx.Request) -> httpx.Response:
        captured.update(dict(req.headers))
        return httpx.Response(200, json={})

    async with _client(handler) as c:
        await probe_endpoint(
            _provider(kind="anthropic", base_url="https://api.anthropic.com"),
            http_client=c,
        )

    assert captured.get("x-api-key") == "sk-test"
    assert "authorization" not in {k.lower() for k in captured}


# ---------------------------------------------------------------------------
# Model probe — whitelist classifier
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_model_200_is_usable() -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"choices": [{"message": {"role": "assistant", "content": "."}}]},
        )

    async with _client(handler) as c:
        r = await probe_model(_provider(), "gpt-4o-mini", http_client=c)

    assert r.usable is True
    assert r.classification == "ok"


@pytest.mark.asyncio
async def test_model_probe_body_is_minimal() -> None:
    """The whole point of the redesign: probe body has NO thinking, NO temp,
    NO top_p, NO system, NO stop, NO enable_thinking. Just messages +
    max_tokens=1. Anything else invites vendor-specific 400s."""
    captured: dict[str, Any] = {}

    def handler(req: httpx.Request) -> httpx.Response:
        import json

        captured.update(json.loads(req.content))
        return httpx.Response(200, json={})

    async with _client(handler) as c:
        await probe_model(_provider(), "gpt-4o-mini", http_client=c)

    assert set(captured.keys()) == {"model", "messages", "max_tokens"}
    assert captured["max_tokens"] == 1
    assert "thinking" not in captured
    assert "enable_thinking" not in captured
    assert "temperature" not in captured
    assert "top_p" not in captured


@pytest.mark.asyncio
async def test_model_400_still_usable() -> None:
    """A vendor 400 ('unknown field', 'invalid param') means the server
    processed our payload — connected, just complained. usable=True."""

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(400, text="enable_thinking is not a recognized parameter")

    async with _client(handler) as c:
        r = await probe_model(_provider(), "gpt-4o-mini", http_client=c)

    assert r.usable is True
    assert r.classification == "param_error"
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_model_429_still_usable() -> None:
    """Rate-limited = the server knows our key AND knows this model AND is
    actively gating — that's connected."""

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(429, text="too many requests")

    async with _client(handler) as c:
        r = await probe_model(_provider(), "gpt-4o-mini", http_client=c)

    assert r.usable is True
    assert r.classification == "rate_limit"


@pytest.mark.asyncio
async def test_model_503_still_usable() -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(503, text="upstream down")

    async with _client(handler) as c:
        r = await probe_model(_provider(), "gpt-4o-mini", http_client=c)

    assert r.usable is True
    assert r.classification == "provider_error"


@pytest.mark.asyncio
async def test_model_401_marks_unusable() -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(401, text="invalid api key")

    async with _client(handler) as c:
        r = await probe_model(_provider(), "gpt-4o-mini", http_client=c)

    assert r.usable is False
    assert r.classification == "auth"


@pytest.mark.asyncio
async def test_model_404_marks_unusable_with_model_not_found() -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(404, text="The model `qwen3.6-fake` does not exist")

    async with _client(handler) as c:
        r = await probe_model(_provider(), "qwen3.6-fake", http_client=c)

    assert r.usable is False
    assert r.classification == "model_not_found"


@pytest.mark.asyncio
async def test_model_network_error_marks_unusable() -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    async with _client(handler) as c:
        r = await probe_model(_provider(), "gpt-4o-mini", http_client=c)

    assert r.usable is False
    assert r.classification == "network"


@pytest.mark.asyncio
async def test_model_timeout_marks_unusable() -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("read timed out")

    async with _client(handler) as c:
        r = await probe_model(_provider(), "gpt-4o-mini", http_client=c)

    assert r.usable is False
    assert r.classification == "timeout"


# ---------------------------------------------------------------------------
# overall_status reducer
# ---------------------------------------------------------------------------


def test_overall_status_ok_when_everything_healthy() -> None:
    from allhands.services.connectivity import EndpointProbe, ModelProbe

    e = EndpointProbe(True, True, 200, 100, "ok")
    m = ModelProbe(True, "ok", 200, 500)
    assert overall_status(e, m) == "ok"


def test_overall_status_degraded_when_model_slow() -> None:
    from allhands.services.connectivity import EndpointProbe, ModelProbe

    e = EndpointProbe(True, True, 200, 100, "ok")
    m = ModelProbe(True, "ok", 200, SLOW_THRESHOLD_MS + 100)
    assert overall_status(e, m) == "degraded"


def test_overall_status_endpoint_unreachable_short_circuits() -> None:
    from allhands.services.connectivity import EndpointProbe, ModelProbe

    e = EndpointProbe(False, None, None, 8000, "network")
    m = ModelProbe(True, "ok", 200, 1)  # would be irrelevant
    assert overall_status(e, m) == "endpoint_unreachable"


def test_overall_status_auth_failed_takes_precedence_over_model() -> None:
    from allhands.services.connectivity import EndpointProbe, ModelProbe

    e = EndpointProbe(True, False, 401, 50, "auth")
    m = ModelProbe(True, "ok", 200, 1)
    assert overall_status(e, m) == "auth_failed"


def test_overall_status_model_unavailable_when_endpoint_ok_but_model_unusable() -> None:
    from allhands.services.connectivity import EndpointProbe, ModelProbe

    e = EndpointProbe(True, True, 200, 100, "ok")
    m = ModelProbe(False, "model_not_found", 404, 200)
    assert overall_status(e, m) == "model_unavailable"


# ---------------------------------------------------------------------------
# Legacy shape — UI backward compat
# ---------------------------------------------------------------------------


def test_legacy_shape_preserves_top_level_fields() -> None:
    from allhands.services.connectivity import EndpointProbe, ModelProbe

    e = EndpointProbe(True, True, 200, 100, "ok")
    m = ModelProbe(True, "ok", 200, 500)
    payload = to_legacy_shape(model_name="gpt", endpoint=e, model=m, status="ok")

    # Old UI consumers
    assert payload["ok"] is True
    assert payload["model"] == "gpt"
    assert payload["latency_ms"] == 500
    assert payload["error"] is None
    assert payload["error_category"] is None
    # New structured fields
    assert payload["endpoint"]["status_code"] == 200
    assert payload["model_probe"]["classification"] == "ok"
    assert payload["status"] == "ok"
