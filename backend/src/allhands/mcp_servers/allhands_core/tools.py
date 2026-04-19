"""Pure tool implementations for the allhands-core MCP server.

Kept separate from `server.py` so they can be unit-tested without booting
a stdio session. Each function returns JSON-serialisable Python data.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, tzinfo
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx

# ---------------------------------------------------------------------------
# Shared limits
# ---------------------------------------------------------------------------

MAX_FETCH_BYTES = 512 * 1024  # 512KiB — enough for most text, caps accidental DoS
MAX_FILE_BYTES = 256 * 1024
DEFAULT_FETCH_TIMEOUT = 10.0


class ToolError(RuntimeError):
    """Raised for user-recoverable tool failures (bad input, unreachable URL…).

    Kept separate from unexpected Python exceptions so `server.py` can surface
    the message cleanly while still letting real bugs bubble up as 500s.
    """


# ---------------------------------------------------------------------------
# fetch_url
# ---------------------------------------------------------------------------


async def fetch_url(url: str, timeout_seconds: float = DEFAULT_FETCH_TIMEOUT) -> dict[str, Any]:
    """HTTP GET → text. Caps body size; http(s) only."""
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise ToolError(f"unsupported url scheme: {parsed.scheme!r}")
    if not parsed.netloc:
        raise ToolError("url missing host")
    try:
        async with httpx.AsyncClient(timeout=timeout_seconds, follow_redirects=True) as client:
            resp = await client.get(url)
    except httpx.HTTPError as exc:
        raise ToolError(f"http error: {exc}") from exc

    content = resp.content[:MAX_FETCH_BYTES]
    truncated = len(resp.content) > MAX_FETCH_BYTES
    try:
        body = content.decode(resp.encoding or "utf-8", errors="replace")
    except LookupError:
        body = content.decode("utf-8", errors="replace")

    return {
        "status": resp.status_code,
        "url": str(resp.url),
        "body": body,
        "bytes": len(resp.content),
        "truncated": truncated,
        "content_type": resp.headers.get("content-type"),
    }


# ---------------------------------------------------------------------------
# read_text_file
# ---------------------------------------------------------------------------


def _read_file_sync(path: str, max_bytes: int) -> tuple[Path, int, bytes]:
    p = Path(path).expanduser()
    if not p.exists():
        raise ToolError(f"no such file: {path}")
    if not p.is_file():
        raise ToolError(f"not a regular file: {path}")
    return p, p.stat().st_size, p.read_bytes()[:max_bytes]


async def read_text_file(path: str, max_bytes: int = MAX_FILE_BYTES) -> dict[str, Any]:
    """Read a small UTF-8 text file. Refuses binary blobs and over-sized files."""
    if max_bytes <= 0 or max_bytes > MAX_FILE_BYTES:
        max_bytes = MAX_FILE_BYTES
    p, size, raw = await asyncio.to_thread(_read_file_sync, path, max_bytes)
    # Heuristic binary detection: null byte in the first chunk = binary.
    if b"\x00" in raw[:8192]:
        raise ToolError("file looks binary — refusing to read")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("utf-8", errors="replace")
    return {
        "path": str(p),
        "size_bytes": size,
        "text": text,
        "truncated": size > max_bytes,
    }


# ---------------------------------------------------------------------------
# now
# ---------------------------------------------------------------------------


def now(tz: str = "UTC") -> dict[str, Any]:
    """Current wall-clock time, rendered in the given IANA timezone."""
    zone: tzinfo
    if tz.upper() == "UTC":
        zone = UTC
    else:
        try:
            zone = ZoneInfo(tz)
        except ZoneInfoNotFoundError as exc:
            raise ToolError(f"unknown timezone: {tz}") from exc
    moment = datetime.now(zone)
    return {
        "tz": tz,
        "iso": moment.isoformat(),
        "unix": moment.timestamp(),
    }
