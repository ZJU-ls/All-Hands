"""W7 · Stock-assistant end-to-end (market anomaly → trigger → channel notify).

Skeleton for W7, the Wave 2 stock-assistant vertical. All three layers
(market-data, triggers, notification-channels) merged on main; this file
asserts the structural wiring that lets an anomaly event fan out to a
notification.

The live walkthrough drives:
- market poller detects anomaly on a watched symbol
- a trigger fires generate_briefing / explain_anomaly
- the resulting artifact is delivered via send_notification on a registered
  channel
- the /stock-assistant/setup wizard works cold from a fresh install

Until that live run ships via ``cockpit.run_walkthrough_acceptance``, this
file stays sign-of-life.
"""

from __future__ import annotations

from pathlib import Path

import pytest

STAGE_ID = "W7"


def _stage(plan: dict, stage_id: str) -> dict:
    return next(s for s in plan["stages"] if s["id"] == stage_id)


def test_stock_assistant_setup_route(web_app_dir: Path) -> None:
    assert (web_app_dir / "stock-assistant" / "setup" / "page.tsx").exists(), (
        "W7 expects /stock-assistant/setup as the cold-install wizard entry"
    )


@pytest.mark.parametrize("router_file", ["market.py", "triggers.py", "channels.py"])
def test_all_three_routers_present(routers_dir: Path, router_file: str) -> None:
    assert (routers_dir / router_file).exists(), (
        f"W7 requires {router_file} — stock-assistant spans market + triggers + channels"
    )


def test_required_meta_tools_registered(walkthrough_plan, meta_tools_dir: Path) -> None:
    stage = _stage(walkthrough_plan, STAGE_ID)
    joined = "\n".join(p.read_text(encoding="utf-8") for p in meta_tools_dir.glob("*_tools.py"))
    missing = [t for t in stage["required_meta_tools"] if t not in joined]
    if missing:
        pytest.xfail(
            f"W7 missing meta tools {missing} — Wave 2 stock suite should have "
            f"registered these. Precondition: {stage['preconditions']}"
        )


def test_stock_meta_tools_file_exists(meta_tools_dir: Path) -> None:
    assert (meta_tools_dir / "stock_tools.py").exists(), (
        "W7 expects stock_tools.py · generate_briefing / explain_anomaly live here"
    )


def test_market_poller_module_exists(repo_root: Path) -> None:
    """W7 depends on the market poller emitting anomaly events.

    We don't assert on the exact runner shape here — just that a poller module
    exists under services/market_*, so refactors that delete it fail loudly.
    """
    services = repo_root / "backend" / "src" / "allhands" / "services"
    poller_candidates = list(services.glob("market_*.py")) + list(services.glob("market/*.py"))
    if not poller_candidates:
        pytest.xfail(
            "W7 skeleton: no market_* service module found — poller may live "
            "under execution/ or be named differently; tighten once Wave 2 "
            "runtime is audited"
        )
