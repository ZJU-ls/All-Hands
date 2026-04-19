"""W1 · Bootstrap · from zero to usable.

Sign-of-life only — a live browser run is done by
``cockpit.run_walkthrough_acceptance`` (spec §3.3). Here we assert the
structural preconditions so the W1 story *can* be clicked through:

1. /gateway route exists on the web side.
2. Providers + Models routers have write verbs (REST path is real).
3. ``chat_test_model`` exposes a run-the-model endpoint (N3 parity bone).
4. Each required Meta Tool (Lead's chat path) appears under
   ``execution/tools/meta/``.
5. ``create_provider`` and ``create_model`` are declared ``scope=WRITE`` so the
   Confirmation Gate is wired — otherwise Lead can silently mutate state.

A failure here means the Bootstrap flow is missing a piece **even before** we
try to click it.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

WRITE_VERB = re.compile(r"@router\.(post|patch|put|delete)\b", re.IGNORECASE)
STAGE_ID = "W1"


def _stage(plan: dict, stage_id: str) -> dict:
    return next(s for s in plan["stages"] if s["id"] == stage_id)


def test_entry_route_is_realized(walkthrough_plan, web_app_dir: Path) -> None:
    stage = _stage(walkthrough_plan, STAGE_ID)
    seg = stage["entry_route"].strip("/")
    target = web_app_dir / seg / "page.tsx" if seg else web_app_dir / "page.tsx"
    assert target.exists(), (
        f"W1 entry route {stage['entry_route']} needs {target.relative_to(web_app_dir.parent)}"
    )


@pytest.mark.parametrize("router_file", ["providers.py", "models.py"])
def test_write_routes_exist(routers_dir: Path, router_file: str) -> None:
    src = (routers_dir / router_file).read_text(encoding="utf-8")
    assert WRITE_VERB.search(src), (
        f"W1 precondition broken: {router_file} has no write verbs "
        f"(bootstrap requires creating providers + models via REST)"
    )


def test_models_router_has_test_endpoint(routers_dir: Path) -> None:
    """N3 · Test parity: the ``test`` button must really call the model.

    W1 ends with a live hello-world chat, so the Gateway's test flow has to
    exercise the real LLM path — not just a fake 200. The router exposes the
    test verb; a live run exercises it via chrome-devtools MCP.
    """
    src = (routers_dir / "models.py").read_text(encoding="utf-8")
    # Any of: /test, /chat-test, /test-chat — spec §3.1 just says "test button"
    has_test = re.search(r'@router\.(post|get)\([^)]*["\']/[^)"\']*test', src, re.IGNORECASE)
    assert has_test, (
        "W1 expects models.py to expose a test endpoint (e.g. /{id}/test) — "
        "Gateway's 'test model' button is N3's evidence"
    )


def test_bootstrap_meta_tools_registered(walkthrough_plan, meta_tools_dir: Path) -> None:
    stage = _stage(walkthrough_plan, STAGE_ID)
    joined = "\n".join(p.read_text(encoding="utf-8") for p in meta_tools_dir.glob("*_tools.py"))
    for tool in stage["required_meta_tools"]:
        assert tool in joined, (
            f"W1 bootstrap tool '{tool}' not found in any meta/*_tools.py — "
            f"Lead Agent cannot Do The Thing via chat (Tool-First breach)"
        )


@pytest.mark.parametrize("tool_name", ["create_provider", "create_model"])
def test_bootstrap_write_tools_go_through_gate(meta_tools_dir: Path, tool_name: str) -> None:
    """WRITE-scope Meta Tools must declare ``requires_confirmation=True``.

    If a create_* tool slips through as READ or auto-approve, Lead can mutate
    state without the Confirmation Gate — CLAUDE.md §3.3 violation.
    """
    # Find the meta tool block that contains this name.
    for path in meta_tools_dir.glob("*_tools.py"):
        text = path.read_text(encoding="utf-8")
        if f'name="{tool_name}"' not in text:
            continue
        # Isolate the Tool(...) literal that contains this name so we don't
        # accidentally read a neighbouring tool's scope.
        start = text.find(f'name="{tool_name}"')
        # Walk back to the nearest "Tool(" and forward to the matching ")".
        block_start = text.rfind("Tool(", 0, start)
        assert block_start != -1, f"no Tool(...) opener before {tool_name}"
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
        assert "ToolScope.WRITE" in block or "ToolScope.IRREVERSIBLE" in block, (
            f"{tool_name} must be WRITE/IRREVERSIBLE scope (bootstrap mutates state)"
        )
        assert "requires_confirmation=True" in block, (
            f"{tool_name} must set requires_confirmation=True "
            f"(CLAUDE.md §3.3 + spec §3.7.2 · write without gate = P0 red)"
        )
        return
    pytest.fail(f"meta tool {tool_name!r} not found under meta/*_tools.py")
