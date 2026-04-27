"""Backend tool: web_search — keyless DDG default + optional Tavily/Serper.

Why three providers in one tool: most self-deploy users have *no* search API
key, so DDG-HTML keeps the platform usable out of the box. Tavily / Serper
are opt-in via env (``TAVILY_API_KEY`` / ``SERPER_API_KEY``); when set, they
override DDG because they're more reliable and cite cleanly.

Output is the same shape across providers:
``{"results": [{"title", "url", "snippet"}, …], "provider": "..."}``.

Scope ``READ`` · no confirmation. Tool intentionally returns *links + snippets*
rather than the page content — pair with ``fetch_url`` to actually read a hit.
"""

from __future__ import annotations

import html
import re
import urllib.parse
from typing import Any

import httpx

from allhands.config.settings import get_settings
from allhands.core import CostHint, Tool, ToolKind, ToolScope

TOOL = Tool(
    id="allhands.builtin.web_search",
    kind=ToolKind.BACKEND,
    name="web_search",
    description=(
        "Search the public web and return [{title, url, snippet}]. Use to find "
        "primary sources (e.g. an LLM provider's pricing page) before calling "
        "fetch_url. Picks the configured provider; falls back to keyless DDG."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Search query."},
            "max_results": {
                "type": "integer",
                "minimum": 1,
                "maximum": 20,
                "description": "Cap on results (default from settings).",
            },
        },
        "required": ["query"],
    },
    output_schema={
        "type": "object",
        "properties": {
            "results": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "url": {"type": "string"},
                        "snippet": {"type": "string"},
                    },
                },
            },
            "provider": {"type": "string"},
        },
    },
    scope=ToolScope.READ,
    requires_confirmation=False,
    cost_hint=CostHint(relative="low"),
)


def _pick_provider() -> str:
    s = get_settings()
    p = (s.web_search_provider or "auto").lower()
    if p == "auto":
        if s.tavily_api_key:
            return "tavily"
        if s.serper_api_key:
            return "serper"
        return "duckduckgo"
    return p


async def _search_tavily(query: str, n: int) -> list[dict[str, str]]:
    s = get_settings()
    if not s.tavily_api_key:
        return []
    async with httpx.AsyncClient(timeout=s.web_search_timeout_seconds) as client:
        r = await client.post(
            "https://api.tavily.com/search",
            json={
                "api_key": s.tavily_api_key,
                "query": query,
                "max_results": n,
                "search_depth": "basic",
            },
        )
        r.raise_for_status()
        data = r.json()
    out: list[dict[str, str]] = []
    for hit in (data.get("results") or [])[:n]:
        out.append(
            {
                "title": str(hit.get("title") or ""),
                "url": str(hit.get("url") or ""),
                "snippet": str(hit.get("content") or "")[:400],
            }
        )
    return out


async def _search_serper(query: str, n: int) -> list[dict[str, str]]:
    s = get_settings()
    if not s.serper_api_key:
        return []
    async with httpx.AsyncClient(timeout=s.web_search_timeout_seconds) as client:
        r = await client.post(
            "https://google.serper.dev/search",
            headers={"X-API-KEY": s.serper_api_key, "Content-Type": "application/json"},
            json={"q": query, "num": n},
        )
        r.raise_for_status()
        data = r.json()
    out: list[dict[str, str]] = []
    for hit in (data.get("organic") or [])[:n]:
        out.append(
            {
                "title": str(hit.get("title") or ""),
                "url": str(hit.get("link") or ""),
                "snippet": str(hit.get("snippet") or "")[:400],
            }
        )
    return out


_DDG_RESULT_RE = re.compile(
    r'<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)</a>'
    r".*?"
    r'<a[^>]+class="result__snippet"[^>]*>(.*?)</a>',
    re.DOTALL,
)


def _strip_tags(s: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", s)).strip()


def _unwrap_ddg_url(href: str) -> str:
    """DDG HTML wraps URLs in ``//duckduckgo.com/l/?uddg=<encoded>``. Unwrap."""
    if href.startswith("//"):
        href = "https:" + href
    if "duckduckgo.com/l/" in href:
        q = urllib.parse.urlparse(href).query
        params = urllib.parse.parse_qs(q)
        if "uddg" in params:
            return urllib.parse.unquote(params["uddg"][0])
    return href


async def _search_duckduckgo(query: str, n: int) -> list[dict[str, str]]:
    s = get_settings()
    async with httpx.AsyncClient(
        timeout=s.web_search_timeout_seconds, follow_redirects=True
    ) as client:
        r = await client.post(
            "https://html.duckduckgo.com/html/",
            data={"q": query},
            headers={"User-Agent": "Mozilla/5.0 (allhands web_search)"},
        )
        r.raise_for_status()
        body = r.text
    out: list[dict[str, str]] = []
    for m in _DDG_RESULT_RE.finditer(body):
        if len(out) >= n:
            break
        href, title, snip = m.group(1), m.group(2), m.group(3)
        url = _unwrap_ddg_url(href)
        out.append(
            {
                "title": _strip_tags(title)[:200],
                "url": url,
                "snippet": _strip_tags(snip)[:400],
            }
        )
    return out


async def execute(query: str, max_results: int | None = None) -> dict[str, Any]:
    s = get_settings()
    n = max_results or s.web_search_max_results
    n = max(1, min(20, n))
    provider = _pick_provider()

    if provider == "tavily":
        results = await _search_tavily(query, n)
        if results:
            return {"results": results, "provider": "tavily"}
    elif provider == "serper":
        results = await _search_serper(query, n)
        if results:
            return {"results": results, "provider": "serper"}

    # Final fallback: keyless DDG. Always tried last so a misconfigured key
    # doesn't silently kill search.
    results = await _search_duckduckgo(query, n)
    return {"results": results, "provider": "duckduckgo"}
