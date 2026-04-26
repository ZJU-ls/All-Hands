"""Unit tests for the artifact-hallucination heuristic.

2026-04-26 · agent_loop._looks_like_artifact_hallucination 检测模型在
回复里说「这是一个 X / 我已经为你 X」但本轮没调 artifact_create 的情况 ·
触发后会注入 system message 让下一轮自我纠正。

这个 heuristic 是保守的:false positive 只是多一次 LLM 调用 · false
negative 让用户看到空空的制品面板(线上踩过一次,见 commit 65c5638
之后用户 「给我画个html展示你的架构和能力」 → 模型干打字不调工具)。
"""

from __future__ import annotations

import pytest

from allhands.execution.agent_loop import _looks_like_artifact_hallucination


@pytest.mark.parametrize(
    "text",
    [
        "这是一个为你定制的交互式 HTML 页面",
        "这是一个我刚刚创建的图表",
        "这是一个交互式仪表盘",
        "这是为你定制的报告",
        "我已经为你创建了一份方案",
        "我已为你生成 HTML",
        "我已经创建了一个 dashboard",
        "我为你创建了交互式可视化",
        "I've created an interactive HTML dashboard",
        "I have created a chart",
        "Here's the HTML page",
        "Here is the HTML you asked for",
        "以下是为你定制的方案",
        # 2026-04-26 · qwen3 在「用 html 展示...」请求下不调 tool 而是描述,
        # 用户截图原话「已为您生成"平台整体架构图"」
        '已为您生成"平台整体架构图"',
        "已为您创建一个交互式 HTML 页面",
        "已为您准备好",
        "已为你生成 HTML 页面",
        "为您生成了一份报告",
        "为你生成了示意图",
    ],
)
def test_known_hallucination_phrases_detected(text: str) -> None:
    assert _looks_like_artifact_hallucination(text), f"Should flag as hallucination: {text!r}"


@pytest.mark.parametrize(
    "text",
    [
        "好的,我帮你看看 list_employees。",  # 普通回复
        "我已激活 drawio 技能。",  # 「我已激活 X 技能」 不算幻觉(这是状态报告)
        "正在调用 artifact_create...",  # 这是 narration · 后面会真调
        "",  # 空文本
        "这",  # 太短
        "OK",
        "工具调用失败:database is locked",  # 错误信息
    ],
)
def test_innocent_phrases_not_flagged(text: str) -> None:
    assert not _looks_like_artifact_hallucination(text), (
        f"Should NOT flag as hallucination: {text!r}"
    )


def test_case_insensitive_english() -> None:
    assert _looks_like_artifact_hallucination("HERE'S THE HTML you wanted")
    assert _looks_like_artifact_hallucination("i've Created the dashboard")
