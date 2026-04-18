"""Regression tests for project-level design contracts (Tool First etc.).

Each class enforces one rule from `product/04-architecture.md` /
CLAUDE.md §3. A failure's assertion message points straight at the rule
that was violated.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import ClassVar

import pytest

REPO = Path(__file__).resolve().parents[2]
ROUTERS = REPO / "src" / "allhands" / "api" / "routers"


class TestL01ToolFirstBoundary:
    """L01 · Tool First · Agent 代表用户执行的写操作必须是 Meta Tool,不能开 REST CRUD。

    员工 / Skill / MCP 这类资源是 Lead Agent 主动管理的对象 → 它们的路由文件
    只允许 GET(只读浏览 + Bootstrap 引导)。出现 POST/PATCH/PUT/DELETE 就是
    绕过 Tool First 的护栏,违反 L01。

    豁免(允许写操作):
      - chat.py:对话流本身(创建会话、发消息)不是 Agent 代做的,是用户直接做
      - confirmations.py:Confirmation Gate 的用户回执
      - health.py:健康检查(只读)
      - models.py / providers.py:Gateway 复杂配置流程,按 Tool First 豁免
    """

    # 哪些路由文件是 "Agent 代表用户管理的资源",因此必须只读:
    AGENT_MANAGED_ROUTERS: ClassVar[list[str]] = ["employees.py", "skills.py", "mcp_servers.py"]

    WRITE_DECORATOR = re.compile(r"@router\.(post|patch|put|delete)\b", re.IGNORECASE)

    @pytest.mark.parametrize(
        "router_name",
        AGENT_MANAGED_ROUTERS,
        ids=lambda n: n,
    )
    def test_no_rest_write_ops_on_agent_managed_resource(self, router_name: str) -> None:
        path = ROUTERS / router_name
        if not path.exists():
            # Resource router doesn't exist yet — no violation possible. Once
            # someone adds it, this test will enforce the rule.
            pytest.skip(f"{router_name} not present yet")
        src = path.read_text(encoding="utf-8")
        matches = self.WRITE_DECORATOR.findall(src)
        assert not matches, (
            f"Tool First 违规:{router_name} 出现 REST 写操作 {matches}。"
            f" Agent 代表用户管理的资源(员工/Skill/MCP)必须走 Meta Tool,"
            f" 不能开 REST CRUD。详见 product/04-architecture.md § Tool 层。"
        )
