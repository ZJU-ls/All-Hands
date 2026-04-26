"""Unit tests for the web_search builtin tool."""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from allhands.config.settings import get_settings
from allhands.execution.tools.builtin import web_search


def _stub_settings(monkeypatch: pytest.MonkeyPatch, **overrides: Any) -> None:
    get_settings.cache_clear()
    for k, v in overrides.items():
        monkeypatch.setenv(k.upper(), str(v) if v is not None else "")


def test_tool_metadata_is_registerable() -> None:
    t = web_search.TOOL
    assert t.id == "allhands.builtin.web_search"
    assert t.name == "web_search"
    assert t.scope.value == "read"
    assert t.requires_confirmation is False
    assert "results" in (t.output_schema.get("properties") or {})


def test_pick_provider_auto_falls_back_to_ddg(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ALLHANDS_TAVILY_API_KEY", raising=False)
    monkeypatch.delenv("ALLHANDS_SERPER_API_KEY", raising=False)
    monkeypatch.setenv("ALLHANDS_WEB_SEARCH_PROVIDER", "auto")
    get_settings.cache_clear()
    assert web_search._pick_provider() == "duckduckgo"


def test_pick_provider_prefers_tavily_when_keyed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ALLHANDS_TAVILY_API_KEY", "tk-xxx")
    monkeypatch.setenv("ALLHANDS_WEB_SEARCH_PROVIDER", "auto")
    get_settings.cache_clear()
    assert web_search._pick_provider() == "tavily"


def test_unwrap_ddg_url_extracts_uddg() -> None:
    wrapped = "//duckduckgo.com/l/?uddg=https%3A%2F%2Fopenai.com%2Fpricing&rut=abc"
    assert web_search._unwrap_ddg_url(wrapped) == "https://openai.com/pricing"


def test_unwrap_ddg_url_passthrough_when_unwrapped() -> None:
    assert web_search._unwrap_ddg_url("https://example.com/x") == "https://example.com/x"


def test_strip_tags_unescapes_entities() -> None:
    assert web_search._strip_tags("<b>price &amp; cost</b>") == "price & cost"


@pytest.mark.asyncio
async def test_execute_uses_ddg_when_no_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ALLHANDS_TAVILY_API_KEY", raising=False)
    monkeypatch.delenv("ALLHANDS_SERPER_API_KEY", raising=False)
    monkeypatch.setenv("ALLHANDS_WEB_SEARCH_PROVIDER", "auto")
    get_settings.cache_clear()

    fake_html = (
        '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fopenai.com%2Fpricing">'
        "OpenAI Pricing</a>"
        '<a class="result__snippet">$2.50 input · $10.00 output per 1M tokens</a>'
    )

    async def fake_post(self: Any, url: str, **kw: Any) -> httpx.Response:
        return httpx.Response(200, text=fake_html, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    out = await web_search.execute("openai pricing")
    assert out["provider"] == "duckduckgo"
    assert out["results"][0]["url"] == "https://openai.com/pricing"
    assert "openai pricing" in out["results"][0]["title"].lower()
    assert "2.50" in out["results"][0]["snippet"]


@pytest.mark.asyncio
async def test_execute_tavily_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ALLHANDS_TAVILY_API_KEY", "tk-xxx")
    monkeypatch.setenv("ALLHANDS_WEB_SEARCH_PROVIDER", "auto")
    get_settings.cache_clear()

    payload = {
        "results": [
            {
                "title": "Anthropic Pricing",
                "url": "https://www.anthropic.com/pricing",
                "content": "Claude Opus 4.7 · $15 input · $75 output / 1M tokens",
            }
        ]
    }

    async def fake_post(self: Any, url: str, **kw: Any) -> httpx.Response:
        assert "tavily.com" in url
        return httpx.Response(200, json=payload, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    out = await web_search.execute("claude pricing", max_results=3)
    assert out["provider"] == "tavily"
    assert out["results"][0]["url"] == "https://www.anthropic.com/pricing"


@pytest.mark.asyncio
async def test_execute_caps_max_results(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ALLHANDS_TAVILY_API_KEY", raising=False)
    monkeypatch.delenv("ALLHANDS_SERPER_API_KEY", raising=False)
    get_settings.cache_clear()

    one_hit = (
        '<a class="result__a" href="https://example.com/1">A</a><a class="result__snippet">snip</a>'
    ) * 30  # 30 hits but we ask for 2

    async def fake_post(self: Any, url: str, **kw: Any) -> httpx.Response:
        return httpx.Response(200, text=one_hit, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    out = await web_search.execute("foo", max_results=2)
    assert len(out["results"]) == 2
