"""Skill guidance.md 质量 lint

每份 guidance.md 必须包含 5 大章节,确保 LLM 能从同一种结构里
快速定位「什么时候用 / 怎么用 / 示例 / 注意 / 出错怎么办」。

写新 skill 包时漏写哪一段,这个测试会立即报错,迫使作者补齐。

5 大章节(中英文标题二选一即可):
- 何时调用 / When to call
- 典型工作流 / 工作流 / Workflow
- 调用示例 / Example / Usage
- 常见坑 / Pitfalls
- 失败时怎么办 / Failure / Recovery / Troubleshooting

不强制 markdown 标题层级,只要文档里出现关键词即可。
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

NEW_PACKS = (
    # 2026-04-25 round-2 spec 新增的 6 个
    "triggers_management",
    "channels_management",
    "task_management",
    "market_data",
    "observatory",
    "review_gates",
    # 2026-04-26 round-17 升格的 5 个老 admin 包(原本格式不统一)
    "team_management",
    "model_management",
    "skill_management",
    "mcp_management",
    "cockpit_admin",
)

SKILLS_ROOT = Path(__file__).resolve().parents[2] / "skills" / "builtin"


SECTION_PATTERNS: dict[str, re.Pattern[str]] = {
    "何时调用": re.compile(r"何时调用|When to call", re.IGNORECASE),
    "工作流": re.compile(r"工作流|workflow|流程", re.IGNORECASE),
    "示例": re.compile(r"调用示例|示例|example|usage", re.IGNORECASE),
    "坑": re.compile(r"坑|pitfall|常见错误|gotcha", re.IGNORECASE),
    "失败处理": re.compile(r"失败|failure|recovery|troubleshoot|怎么办", re.IGNORECASE),
}


@pytest.mark.parametrize("pack", NEW_PACKS)
def test_guidance_has_all_five_sections(pack: str) -> None:
    text = (SKILLS_ROOT / pack / "prompts" / "guidance.md").read_text()
    missing = [label for label, pattern in SECTION_PATTERNS.items() if not pattern.search(text)]
    assert not missing, (
        f"{pack}/prompts/guidance.md 缺少章节: {missing}. "
        f"每份 skill guidance 必须包含 5 大章节(何时调用 / 工作流 / "
        f"示例 / 常见坑 / 失败处理),让 LLM 找信息时结构一致。"
    )


@pytest.mark.parametrize("pack", NEW_PACKS)
def test_guidance_has_runnable_example(pack: str) -> None:
    """示例段落必须包含可识别的工具调用模式 — 至少一个 ``tool_name(...)`` 或
    fenced code block · 确保 LLM 能直接抄参考写法。"""
    text = (SKILLS_ROOT / pack / "prompts" / "guidance.md").read_text()
    has_code_block = "```" in text
    has_func_call = bool(re.search(r"\w+\([^)]*\)", text))
    assert has_code_block or has_func_call, (
        f"{pack}: guidance.md 没有 code block 或 tool 调用样例 · 加一段 ```...``` 让 LLM 照抄"
    )


@pytest.mark.parametrize("pack", NEW_PACKS)
def test_guidance_has_failure_table_or_list(pack: str) -> None:
    """失败处理段落必须有结构化(表格 / 列表) · 不能是大段散文。"""
    text = (SKILLS_ROOT / pack / "prompts" / "guidance.md").read_text()
    # locate the failure-handling section
    failure_idx = -1
    for line in text.splitlines():
        if SECTION_PATTERNS["失败处理"].search(line) and line.startswith(("##", "###")):
            failure_idx = text.find(line)
            break
    if failure_idx == -1:
        pytest.skip("test_guidance_has_all_five_sections 已捕获缺章节情况")
    after = text[failure_idx:]
    # accept markdown table OR bulleted list of cases
    has_table = "|" in after and "---" in after
    has_bullets = bool(re.search(r"^\s*[-*]\s", after, re.MULTILINE))
    assert has_table or has_bullets, f"{pack}: 失败处理段落应该是表格或列表 · 帮 LLM 快速对症下药"
