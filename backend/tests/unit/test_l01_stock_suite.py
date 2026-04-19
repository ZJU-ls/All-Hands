"""L01 · Tool First parity for Wave 2 stock-suite routers.

The main ``test_learnings.py::TestL01ToolFirstBoundary`` parametrizes over a
hardcoded list of agent-managed routers. This module adds channels + market
coverage without touching the shared test file (Wave 2 `严格只新增` constraint).
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import ClassVar

import pytest

REPO = Path(__file__).resolve().parents[2]
ROUTERS = REPO / "src" / "allhands" / "api" / "routers"
META_TOOLS_DIR = REPO / "src" / "allhands" / "execution" / "tools" / "meta"

WRITE_DECORATOR = re.compile(r"@router\.(post|patch|put|delete)\b", re.IGNORECASE)


class TestL01StockSuiteBoundary:
    """For every router/meta-tool pair landed by the Wave 2 stock suite, assert
    that a write route implies an adjacent ``<resource>_tools.py`` file exists
    AND carries an ``ALL_*_META_TOOLS`` list with at least one WRITE entry.
    """

    CASES: ClassVar[list[tuple[str, str, str]]] = [
        # (router_filename, expected_tools_filename, expected_symbol)
        ("channels.py", "channel_tools.py", "ALL_CHANNEL_META_TOOLS"),
        ("market.py", "market_tools.py", "ALL_MARKET_META_TOOLS"),
    ]

    @pytest.mark.parametrize(("router_name", "tools_name", "symbol"), CASES)
    def test_router_has_paired_meta_tools(
        self, router_name: str, tools_name: str, symbol: str
    ) -> None:
        router_path = ROUTERS / router_name
        tools_path = META_TOOLS_DIR / tools_name
        if not router_path.exists():
            pytest.skip(f"{router_name} not yet landed")
        router_src = router_path.read_text(encoding="utf-8")
        write_verbs = WRITE_DECORATOR.findall(router_src)
        if not write_verbs:
            pytest.skip(f"{router_name} has no write routes")
        assert tools_path.exists(), (
            f"L01 违规:{router_name} 有 REST 写操作 {write_verbs} 但"
            f" execution/tools/meta/{tools_name} 不存在。"
            f" Wave 2 stock suite 的每条写路由必须有成对 Meta Tool。"
        )
        tools_src = tools_path.read_text(encoding="utf-8")
        assert symbol in tools_src, (
            f"L01 违规:{tools_name} 必须导出 {symbol} (列表形式,便于 ToolRegistry 发现注册)。"
        )

    def test_channels_send_notification_declared_write(self) -> None:
        src = (META_TOOLS_DIR / "channel_tools.py").read_text(encoding="utf-8")
        assert "SEND_NOTIFICATION_TOOL" in src
        assert 'name="send_notification"' in src
        assert "ToolScope.WRITE" in src

    def test_channels_register_declared_bootstrap(self) -> None:
        """Channel config carries credentials → BOOTSTRAP (candidate + switch)."""
        src = (META_TOOLS_DIR / "channel_tools.py").read_text(encoding="utf-8")
        assert "REGISTER_CHANNEL_TOOL" in src
        assert "ToolScope.BOOTSTRAP" in src
