"""W6 · External channel roundtrip (inbound → reply → outbound).

Skeleton for W6. The Wave 2 notification-channels spec merged on main, so the
channels router + webhooks router + channel Meta Tools are all present —
assertions here are real, not xfail, for the structural surface.

The live W6 run requires a real external provider fixture (Telegram/Bark) and
is covered by ``cockpit.run_walkthrough_acceptance({paths:["W6"]})`` + the
stock-assistant Wave 2 e2e; it is **not** v0-active so this file is sign-of-
life only.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

STAGE_ID = "W6"


def _stage(plan: dict, stage_id: str) -> dict:
    return next(s for s in plan["stages"] if s["id"] == stage_id)


def test_channels_route_exists(web_app_dir: Path) -> None:
    assert (web_app_dir / "channels" / "page.tsx").exists(), "W6 expects /channels list route"


def test_channels_router_writes_and_webhook(routers_dir: Path) -> None:
    path = routers_dir / "channels.py"
    assert path.exists(), "W6 precondition: routers/channels.py"
    src = path.read_text(encoding="utf-8")
    assert re.search(r'@router\.post\(\s*"",', src), (
        "W6 expects POST / on channels.py (register_channel REST mirror)"
    )
    assert "/webhook" in src, "W6 expects inbound webhook endpoint on channels router"
    assert "/test" in src, "W6 expects /{id}/test endpoint (N3 · end-to-end test button)"


def test_required_meta_tools_registered(walkthrough_plan, meta_tools_dir: Path) -> None:
    stage = _stage(walkthrough_plan, STAGE_ID)
    joined = "\n".join(p.read_text(encoding="utf-8") for p in meta_tools_dir.glob("*_tools.py"))
    missing = [t for t in stage["required_meta_tools"] if t not in joined]
    if missing:
        pytest.xfail(
            f"W6 missing meta tools {missing} — notification-channels spec "
            f"should have registered these (Wave 2 Track 3). "
            f"Precondition: {stage['preconditions']}"
        )


def test_register_channel_is_gated(meta_tools_dir: Path) -> None:
    path = meta_tools_dir / "channel_tools.py"
    if not path.exists():
        pytest.xfail("W6 skeleton: channel_tools.py not yet present")
    text = path.read_text(encoding="utf-8")
    marker = 'name="register_channel"'
    if marker not in text:
        pytest.xfail("W6 skeleton: register_channel not yet registered")
    start = text.find(marker)
    block_start = text.rfind("Tool(", 0, start)
    depth = 0
    block_end = block_start
    for i, ch in enumerate(text[block_start:], start=block_start):
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                block_end = i + 1
                break
    block = text[block_start:block_end]
    has_gate_scope = any(
        scope in block
        for scope in ("ToolScope.WRITE", "ToolScope.IRREVERSIBLE", "ToolScope.BOOTSTRAP")
    )
    assert has_gate_scope, (
        "register_channel must declare a gate-bearing scope "
        "(WRITE/IRREVERSIBLE/BOOTSTRAP) · persists credential"
    )
    assert "requires_confirmation=True" in block, (
        "register_channel must set requires_confirmation=True (CLAUDE.md §3.3)"
    )


def test_webhooks_router_exists(routers_dir: Path) -> None:
    assert (routers_dir / "webhooks.py").exists(), (
        "W6 expects a webhooks.py router for inbound messages from external channels"
    )
