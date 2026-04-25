"""First-principles connectivity & usability probes for LLM providers.

Built around a single insight: "connected" is NOT the same as "completed an
inference call". A model healthcheck must distinguish four orthogonal facts —

  1. Is the endpoint network-reachable?    (DNS / TCP / TLS)
  2. Is our credential accepted?           (auth_ok)
  3. Does this model name exist there?     (model resolution)
  4. Did it actually respond to a probe?   (model usable)

Anything else — slow cold-starts on thinking models, 429 quota, 5xx upstream
hiccups, weird parameter validation — is the model BEING reachable, just not
giving us a clean response right this second. Those failures must NOT be
classified as "not connected", or we mislead the user into thinking the
provider is down when it isn't.

Two probes here:

* `probe_endpoint(provider)` — GET `…/v1/models` (or Anthropic equivalent),
  no inference. Sub-second on healthy gateways. Tells us reachable + auth.

* `probe_model(provider, model_name)` — minimal chat call (max_tokens=1, one
  user message, zero optional params). Whitelist-style classifier: the only
  failure modes that flip `usable=false` are network / timeout / auth /
  model_not_found. EVERYTHING else (400 param error, 429 quota, 5xx, slow
  thinking-model TTFB) keeps `usable=true` because the server processed our
  request and replied — the model is reachable.

Frontend renders both. User sees "endpoint OK + model OK = green ✓",
"endpoint OK + model 429 = yellow with quota note", "endpoint 401 = red
auth", etc. — independent dimensions.
"""

from __future__ import annotations

import time
from dataclasses import asdict, dataclass
from typing import Any, Literal

import httpx

from allhands.core.provider import LLMProvider
from allhands.execution.llm_factory import probe_endpoint as _probe_endpoint_url

EndpointKind = Literal[
    "ok",
    "network",
    "timeout",
    "auth",
    "not_found",
    "server_error",
    "unknown",
]

ModelKind = Literal[
    "ok",
    "auth",
    "model_not_found",
    "network",
    "timeout",
    "rate_limit",
    "provider_error",
    "param_error",
    "unknown",
]

OverallStatus = Literal[
    "ok",
    "degraded",
    "endpoint_unreachable",
    "auth_failed",
    "model_unavailable",
]

# Budgets (seconds). Endpoint check is auth-only and should be fast; model
# check tolerates first-token latency on cold thinking models.
ENDPOINT_TIMEOUT_S = 8.0
MODEL_TIMEOUT_S = 12.0

# A successful model probe slower than this is "degraded" — connected but
# warning the user that real chat will be sluggish.
SLOW_THRESHOLD_MS = 5_000


@dataclass(frozen=True)
class EndpointProbe:
    """Result of a credentialed network reach test (no inference).

    `reachable` ↔ we got an HTTP response back at all (any status).
    `auth_ok`   ↔ status was not 401/403; None when the server didn't reply.
    """

    reachable: bool
    auth_ok: bool | None
    status_code: int | None
    latency_ms: int
    error_kind: EndpointKind
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class ModelProbe:
    """Result of a minimal chat call against a (provider, model) pair.

    The classifier is intentionally a SHORT WHITELIST of "really not usable"
    causes — most non-2xx HTTP statuses keep `usable=True` because the model
    being reachable enough to refuse our request still proves connectivity.
    """

    usable: bool
    classification: ModelKind
    status_code: int | None
    latency_ms: int
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# ---------------------------------------------------------------------------
# Endpoint probe
# ---------------------------------------------------------------------------


def _classify_endpoint_status(status: int) -> tuple[EndpointKind, bool | None]:
    if 200 <= status < 300:
        return "ok", True
    if status in (401, 403):
        return "auth", False
    if status == 404:
        # Some compat gateways don't expose /v1/models — we can't conclude
        # auth from a 404. Treat as "reachable but inconclusive".
        return "not_found", None
    if 500 <= status < 600:
        return "server_error", None
    return "unknown", None


def _classify_endpoint_exception(exc: BaseException) -> EndpointKind:
    if isinstance(exc, httpx.TimeoutException):
        return "timeout"
    if isinstance(
        exc,
        (
            httpx.ConnectError,
            httpx.ConnectTimeout,
            httpx.NetworkError,
        ),
    ):
        return "network"
    return "unknown"


async def probe_endpoint(
    provider: LLMProvider,
    *,
    http_client: httpx.AsyncClient | None = None,
    timeout_s: float = ENDPOINT_TIMEOUT_S,
) -> EndpointProbe:
    """Pure auth + network reach check. Does NOT call any inference endpoint.

    Returns a structured result the UI can render without further parsing.
    """
    url, headers = _probe_endpoint_url(provider)
    started = time.perf_counter()
    client = http_client or httpx.AsyncClient(timeout=timeout_s)
    owns = http_client is None
    try:
        try:
            resp = await client.get(url, headers=headers)
        except Exception as exc:
            return EndpointProbe(
                reachable=False,
                auth_ok=None,
                status_code=None,
                latency_ms=int((time.perf_counter() - started) * 1000),
                error_kind=_classify_endpoint_exception(exc),
                error=f"{type(exc).__name__}: {exc!s}"[:300],
            )
        latency_ms = int((time.perf_counter() - started) * 1000)
        kind, auth_ok = _classify_endpoint_status(resp.status_code)
        return EndpointProbe(
            reachable=True,
            auth_ok=auth_ok,
            status_code=resp.status_code,
            latency_ms=latency_ms,
            error_kind=kind,
            error=(None if kind == "ok" else f"HTTP {resp.status_code}: {resp.text[:200]}"),
        )
    finally:
        if owns:
            await client.aclose()


# ---------------------------------------------------------------------------
# Model probe — minimal inference, whitelist classifier
# ---------------------------------------------------------------------------


def _model_minimal_body(provider: LLMProvider, model_name: str) -> dict[str, Any]:
    """Smallest possible chat body — no thinking / temp / top_p / system.

    The whole point is to surface ONLY connectivity failures. Optional fields
    invite vendor-specific 400s that have nothing to do with reachability.
    """
    if getattr(provider, "kind", "openai") == "anthropic":
        return {
            "model": model_name,
            "messages": [{"role": "user", "content": "."}],
            "max_tokens": 1,
        }
    return {
        "model": model_name,
        "messages": [{"role": "user", "content": "."}],
        "max_tokens": 1,
    }


def _model_url(provider: LLMProvider) -> str:
    base = (provider.base_url or "").rstrip("/")
    if getattr(provider, "kind", "openai") == "anthropic":
        if not base:
            base = "https://api.anthropic.com"
        return base + ("/messages" if base.endswith("/v1") else "/v1/messages")
    if not base:
        base = "https://api.openai.com/v1"
    return base + "/chat/completions"


def _model_headers(provider: LLMProvider) -> dict[str, str]:
    if getattr(provider, "kind", "openai") == "anthropic":
        h = {"Content-Type": "application/json", "anthropic-version": "2023-06-01"}
        if provider.api_key:
            h["x-api-key"] = provider.api_key
        return h
    h = {"Content-Type": "application/json"}
    if provider.api_key:
        h["Authorization"] = f"Bearer {provider.api_key}"
    return h


def _classify_model_status(status: int, body_text: str) -> tuple[ModelKind, bool]:
    """Return (classification, usable). Whitelist: only NETWORK / AUTH /
    MODEL_NOT_FOUND flip usable=False. Everything else stays usable=True.
    """
    if 200 <= status < 300:
        return "ok", True
    if status in (401, 403):
        return "auth", False
    if status == 404:
        # Distinguish "model name doesn't exist on this provider" (a real
        # connectivity failure for THIS model) from "endpoint path 404"
        # (already covered by endpoint probe). Body text usually mentions
        # "model" when it's the former.
        if "model" in body_text.lower():
            return "model_not_found", False
        return "model_not_found", False
    if status == 429:
        # Rate-limited: the server is reachable AND knows our key AND knows
        # this model. Not "unconnected" — connected and busy.
        return "rate_limit", True
    if status in (400, 422):
        # Body validation. Connectivity is proven; the probe payload may
        # have hit a vendor-specific quirk. Still usable.
        return "param_error", True
    if 500 <= status < 600:
        return "provider_error", True
    return "unknown", True


def _classify_model_exception(exc: BaseException) -> ModelKind:
    if isinstance(exc, httpx.TimeoutException):
        return "timeout"
    if isinstance(exc, (httpx.ConnectError, httpx.ConnectTimeout, httpx.NetworkError)):
        return "network"
    return "unknown"


async def probe_model(
    provider: LLMProvider,
    model_name: str,
    *,
    http_client: httpx.AsyncClient | None = None,
    timeout_s: float = MODEL_TIMEOUT_S,
) -> ModelProbe:
    """Send the smallest possible chat request and classify the outcome.

    Whitelist policy: only a tiny set of failure modes flip `usable=False`.
    A 400/429/500 means the server processed our request — that's enough to
    say the model is reachable.
    """
    url = _model_url(provider)
    body = _model_minimal_body(provider, model_name)
    headers = _model_headers(provider)
    started = time.perf_counter()
    client = http_client or httpx.AsyncClient(timeout=timeout_s)
    owns = http_client is None
    try:
        try:
            resp = await client.post(url, headers=headers, json=body)
        except Exception as exc:
            return ModelProbe(
                usable=False,
                classification=_classify_model_exception(exc),
                status_code=None,
                latency_ms=int((time.perf_counter() - started) * 1000),
                error=f"{type(exc).__name__}: {exc!s}"[:300],
            )
        latency_ms = int((time.perf_counter() - started) * 1000)
        text_snippet = resp.text[:300] if resp.status_code >= 400 else ""
        kind, usable = _classify_model_status(resp.status_code, text_snippet)
        return ModelProbe(
            usable=usable,
            classification=kind,
            status_code=resp.status_code,
            latency_ms=latency_ms,
            error=(None if kind == "ok" else f"HTTP {resp.status_code}: {text_snippet}"),
        )
    finally:
        if owns:
            await client.aclose()


# ---------------------------------------------------------------------------
# Combined ping result — what `/api/models/{id}/ping` returns
# ---------------------------------------------------------------------------


def overall_status(endpoint: EndpointProbe, model: ModelProbe) -> OverallStatus:
    """Reduce two probes into one summary the UI can color-code.

    Order matters:
      1. endpoint not reachable          → endpoint_unreachable
      2. endpoint says auth invalid      → auth_failed
      3. model probe says unusable       → model_unavailable
      4. model usable but slow           → degraded
      5. otherwise                       → ok
    """
    if not endpoint.reachable:
        return "endpoint_unreachable"
    if endpoint.auth_ok is False:
        return "auth_failed"
    if not model.usable:
        if model.classification == "auth":
            return "auth_failed"
        return "model_unavailable"
    if model.latency_ms > SLOW_THRESHOLD_MS:
        return "degraded"
    return "ok"


def to_legacy_shape(
    *,
    model_name: str,
    endpoint: EndpointProbe,
    model: ModelProbe,
    status: OverallStatus,
) -> dict[str, Any]:
    """Backward-compat top-level fields older clients still read.

    Keeps `ok` / `latency_ms` / `error` / `error_category` working alongside
    the new structured `endpoint` / `model` / `status`.
    """
    legacy_category = {
        "ok": None,
        "auth": "auth",
        "model_not_found": "model_not_found",
        "network": "connection",
        "timeout": "timeout",
        "rate_limit": "rate_limit",
        "provider_error": "provider_error",
        "param_error": "provider_error",
        "unknown": "unknown",
    }
    is_ok = status in ("ok", "degraded")
    error: str | None = None
    error_category: str | None = None
    if not is_ok:
        if status == "endpoint_unreachable":
            error_category = (
                "connection"
                if endpoint.error_kind == "network"
                else ("timeout" if endpoint.error_kind == "timeout" else "provider_error")
            )
            error = endpoint.error or "endpoint unreachable"
        elif status == "auth_failed":
            error_category = "auth"
            error = endpoint.error or model.error or "auth failed"
        elif status == "model_unavailable":
            error_category = legacy_category.get(model.classification) or "unknown"
            error = model.error or "model unavailable"
    return {
        "ok": is_ok,
        "model": model_name,
        "latency_ms": model.latency_ms or endpoint.latency_ms,
        "error": error,
        "error_category": error_category,
        "endpoint": endpoint.to_dict(),
        "model_probe": model.to_dict(),
        "status": status,
    }
