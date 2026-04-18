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


META_TOOLS_DIR = REPO / "src" / "allhands" / "execution" / "tools" / "meta"


class TestL01ToolFirstBoundary:
    """L01 · Tool First(**2026-04-18 扩展版**):

    原规则"Agent-managed 资源不能开 REST 写操作"在 2026-04-18 被用户反转。
    新规则:**允许** REST 写操作(UI 独立页要用),**但**必须在
    `execution/tools/meta/` 下存在同名语义的 Meta Tool —— 让 Lead Agent
    通过对话能做 UI 上能做的每件事(全知全能)。

    两个入口必须成对:
      - `@router.post("/")` on employees.py → meta tool `create_employee`
      - `@router.delete("/{id}")`           → meta tool `delete_employee`
      - `@router.post("/{id}/test")`        → meta tool `test_*` 语义工具

    该测试不枚举所有 (REST, Tool) 对,而是 smoke 级检查:
      (1) Agent-managed 路由里存在的每种写动词(post/patch/put/delete)
      (2) 在 meta_tools 目录里至少有一个 tool 文件 *_tools.py 与该资源同族
    """

    AGENT_MANAGED_ROUTERS: ClassVar[list[str]] = [
        "employees.py",
        "skills.py",
        "mcp_servers.py",
        "providers.py",
        "models.py",
    ]

    # Known gaps being filled by plan `2026-04-18-gateway-skill-mcp.md`.
    # These routers have REST writes but their Meta Tool files are still being authored.
    # Entries must be removed when the plan's corresponding task lands the tool file.
    KNOWN_GAP_ROUTERS: ClassVar[set[str]] = {"providers.py", "models.py"}

    WRITE_DECORATOR = re.compile(r"@router\.(post|patch|put|delete)\b", re.IGNORECASE)

    @pytest.mark.parametrize(
        "router_name",
        AGENT_MANAGED_ROUTERS,
        ids=lambda n: n,
    )
    def test_agent_managed_resource_has_meta_tools(self, router_name: str) -> None:
        path = ROUTERS / router_name
        if not path.exists():
            pytest.skip(f"{router_name} not present yet")
        src = path.read_text(encoding="utf-8")
        write_verbs = self.WRITE_DECORATOR.findall(src)
        if not write_verbs:
            return

        resource_stem = router_name.removesuffix(".py").rstrip("s")
        candidate = META_TOOLS_DIR / f"{resource_stem}_tools.py"
        plural = META_TOOLS_DIR / f"{router_name.removesuffix('.py')}_tools.py"

        if router_name in self.KNOWN_GAP_ROUTERS:
            if candidate.exists() or plural.exists():
                pytest.fail(
                    f"{router_name} 已有对应 Meta Tool,请把它从 KNOWN_GAP_ROUTERS "
                    f"移除 —— plan 2026-04-18-gateway-skill-mcp.md 对应任务完成。"
                )
            pytest.xfail(
                f"{router_name} 暂缺 Meta Tool;由 plan 2026-04-18-gateway-skill-mcp.md "
                f"任务补齐后应从 KNOWN_GAP_ROUTERS 移除。"
            )

        assert candidate.exists() or plural.exists(), (
            f"L01 违规:{router_name} 有 REST 写操作 {write_verbs} 但"
            f" execution/tools/meta/ 下找不到对应 tool 文件"
            f" ({candidate.name} 或 {plural.name})。"
            f" Agent-managed 资源的每个 UI 写操作必须有对应 Meta Tool,"
            f" 让 Lead Agent 通过对话也能做同样的事(Tool First 扩展 · L01 2026-04-18)。"
        )
