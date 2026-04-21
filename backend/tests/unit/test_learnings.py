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
        "triggers.py",
        "tasks.py",
    ]

    # Known gaps being filled by plan `2026-04-18-gateway-skill-mcp.md`.
    # These routers have REST writes but their Meta Tool files are still being authored.
    # Entries must be removed when the plan's corresponding task lands the tool file.
    # Empty = full parity enforced.
    KNOWN_GAP_ROUTERS: ClassVar[set[str]] = set()

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


class TestL06CapabilityDiscovery:
    """L06 · Capability-discovery 硬性先行(2026-04-21):

    用户反馈触发:用户在聊天里说"我想要一个画图员工",Lead 直接按训练
    数据编出"方案 A DALL·E / 方案 B matplotlib"两套方案,完全没调
    `list_providers/list_skills/list_mcp_servers/list_employees`,导致
    忽略用户其实已经装好的 `algorithmic-art` skill + provider。

    修复:`lead_agent.md` 必须包含一节明确规定"能力类问题"→ **先并行
    调 list_* 再回答",并禁止在未调用 list_* 的前提下以"平台目前没配
    任何 …"开头。本测试用静态扫描钉住这一节,防止未来改掉。
    """

    PROMPT_PATH: ClassVar[Path] = (
        REPO / "src" / "allhands" / "execution" / "prompts" / "lead_agent.md"
    )

    REQUIRED_SNIPPETS: ClassVar[list[str]] = [
        "Capability-discovery protocol",
        "list_providers",
        "list_skills",
        "list_mcp_servers",
        "list_employees",
        "Before writing anything visible to the user",
    ]

    def test_prompt_has_capability_discovery_section(self) -> None:
        assert self.PROMPT_PATH.exists(), f"Lead Agent prompt 文件不存在:{self.PROMPT_PATH}"
        src = self.PROMPT_PATH.read_text(encoding="utf-8")
        missing = [s for s in self.REQUIRED_SNIPPETS if s not in src]
        assert not missing, (
            f"L06 违规:lead_agent.md 缺少 capability-discovery 强制条款。"
            f"缺失的关键词:{missing}。"
            f"用户已反馈过一次:Lead 不调 list_* 就凭空编'方案 A/B'"
            f"(2026-04-21)。这一节是硬规则,不要删。"
        )
