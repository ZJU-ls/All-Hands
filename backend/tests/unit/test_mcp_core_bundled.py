"""allhands-core bundled MCP server — unit tests for the three tools.

Validates the pure-Python tool implementations in
`allhands.mcp_servers.allhands_core.tools`. The stdio server wrapper is
just a thin FastMCP decorator layer, so exercising the functions
directly is enough to cover every branch.

Covers:
  - fetch_url: success body decoding + truncation flag + scheme guard
  - read_text_file: size cap + binary refusal + missing-file error
  - now: known tz + unknown tz error
"""

from __future__ import annotations

from pathlib import Path
from typing import ClassVar

import httpx
import pytest

from allhands.mcp_servers.allhands_core import tools as t


@pytest.mark.asyncio
async def test_fetch_url_returns_body(monkeypatch: pytest.MonkeyPatch) -> None:
    class _Resp:
        status_code = 200
        headers: ClassVar[dict[str, str]] = {"content-type": "text/plain"}
        encoding = "utf-8"
        url = "http://example.com/hello"
        content = b"hello world"

    class _Client:
        def __init__(self, *_: object, **__: object) -> None:
            pass

        async def __aenter__(self) -> _Client:
            return self

        async def __aexit__(self, *exc: object) -> None:
            return None

        async def get(self, _url: str) -> _Resp:
            return _Resp()

    monkeypatch.setattr(httpx, "AsyncClient", _Client)

    result = await t.fetch_url("http://example.com/hello")
    assert result["status"] == 200
    assert result["body"] == "hello world"
    assert result["truncated"] is False
    assert result["bytes"] == len(b"hello world")


@pytest.mark.asyncio
async def test_fetch_url_truncates_oversize(monkeypatch: pytest.MonkeyPatch) -> None:
    big = b"x" * (t.MAX_FETCH_BYTES + 10)

    class _Resp:
        status_code = 200
        headers: ClassVar[dict[str, str]] = {"content-type": "text/plain"}
        encoding = "utf-8"
        url = "http://example.com/big"
        content = big

    class _Client:
        async def __aenter__(self) -> _Client:
            return self

        async def __aexit__(self, *exc: object) -> None:
            return None

        async def get(self, _url: str) -> _Resp:
            return _Resp()

    monkeypatch.setattr(httpx, "AsyncClient", lambda *a, **k: _Client())

    result = await t.fetch_url("http://example.com/big")
    assert result["truncated"] is True
    assert len(result["body"]) == t.MAX_FETCH_BYTES


@pytest.mark.asyncio
async def test_fetch_url_rejects_non_http_scheme() -> None:
    with pytest.raises(t.ToolError, match="unsupported url scheme"):
        await t.fetch_url("file:///etc/passwd")


@pytest.mark.asyncio
async def test_read_text_file_returns_text(tmp_path: Path) -> None:
    p = tmp_path / "hi.txt"
    p.write_text("hi there\n", encoding="utf-8")
    result = await t.read_text_file(str(p))
    assert result["text"] == "hi there\n"
    assert result["size_bytes"] == p.stat().st_size
    assert result["truncated"] is False


@pytest.mark.asyncio
async def test_read_text_file_refuses_binary(tmp_path: Path) -> None:
    p = tmp_path / "blob.bin"
    p.write_bytes(b"\x00\x01\x02binary")
    with pytest.raises(t.ToolError, match="binary"):
        await t.read_text_file(str(p))


@pytest.mark.asyncio
async def test_read_text_file_missing() -> None:
    with pytest.raises(t.ToolError, match="no such file"):
        await t.read_text_file("/nonexistent/path/should-not-exist.xyz")


def test_now_utc_returns_iso() -> None:
    r = t.now("UTC")
    assert r["tz"] == "UTC"
    # ISO-8601 with timezone suffix (UTC → "+00:00" or trailing "Z" from certain stdlibs).
    assert "T" in r["iso"]
    assert r["iso"].endswith("+00:00") or r["iso"].endswith("Z")
    assert isinstance(r["unix"], float)


def test_now_rejects_unknown_tz() -> None:
    with pytest.raises(t.ToolError, match="unknown timezone"):
        t.now("Nowhere/Madeup")
