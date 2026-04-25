"""Unit tests for services.ai_explainer.

We don't actually call an LLM here — that's what integration / live runs
verify. These tests pin the **prompt-shape contract** (the meta-prompt
contains the right signals so a real model has what it needs) and the
cache invariants. If someone refactors the prompt builders into a
template engine later, these tests stay valid as long as the wires are.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, ClassVar
from unittest.mock import AsyncMock

import pytest

from allhands.core.errors import DomainError
from allhands.core.mcp import MCPServer, MCPTransport
from allhands.core.skill import Skill, SkillSource
from allhands.services import ai_explainer
from allhands.services.ai_explainer import (
    _build_compose_prompt_prompt,
    _build_skill_explain_prompt,
    _format_tool_block,
)


def _skill(
    *,
    sid: str = "skill.demo",
    name: str = "Demo Skill",
    desc: str = "Does demo things",
    tool_ids: list[str] | None = None,
    fragment: str | None = None,
) -> Skill:
    return Skill(
        id=sid,
        name=name,
        description=desc,
        tool_ids=tool_ids or [],
        prompt_fragment=fragment,
        version="1.0.0",
        source=SkillSource.BUILTIN,
        source_url=None,
        installed_at=datetime(2026, 4, 25, 12, 0, 0),
        path=None,
    )


def _mcp(mid: str, name: str, tool_count: int = 3) -> MCPServer:
    return MCPServer(
        id=mid,
        name=name,
        transport=MCPTransport.STDIO,
        config={"command": "x"},
        enabled=True,
        exposed_tool_ids=[f"t{i}" for i in range(tool_count)],
    )


class TestSkillExplainPrompt:
    def test_includes_name_description_version(self) -> None:
        prompt = _build_skill_explain_prompt(_skill(), tool_block="(无)")
        assert "Demo Skill" in prompt
        assert "Does demo things" in prompt
        assert "1.0.0" in prompt
        assert "builtin" in prompt

    def test_omits_fragment_section_when_empty(self) -> None:
        prompt = _build_skill_explain_prompt(_skill(fragment=None), tool_block="(无)")
        assert "激活时注入的提示片段" not in prompt

    def test_includes_fragment_when_present(self) -> None:
        prompt = _build_skill_explain_prompt(
            _skill(fragment="使用此技能时,先做 X 再做 Y。"),
            tool_block="(无)",
        )
        assert "激活时注入的提示片段" in prompt
        assert "使用此技能时" in prompt

    def test_pins_required_output_sections(self) -> None:
        """Prompt must ask for the four-section structure the UI renders."""
        prompt = _build_skill_explain_prompt(_skill(), tool_block="(无)")
        for header in ("一句话作用", "典型场景", "不适合的情况", "工作机制"):
            assert header in prompt, f"prompt missing section header: {header}"


class TestComposePromptPrompt:
    def test_includes_picked_skills_by_name(self) -> None:
        skills = [
            _skill(sid="s1", name="搜资讯", desc="抓 Google News"),
            _skill(sid="s2", name="改 PR", desc="GitHub PR review"),
        ]
        prompt = _build_compose_prompt_prompt(
            name="新闻员",
            description="盯每日 AI 新闻并做摘要",
            skills=skills,
            mcp_servers=[],
        )
        assert "新闻员" in prompt
        assert "盯每日 AI 新闻" in prompt
        assert "搜资讯" in prompt
        assert "改 PR" in prompt

    def test_handles_empty_inputs_gracefully(self) -> None:
        prompt = _build_compose_prompt_prompt(name="", description="", skills=[], mcp_servers=[])
        # Should still render — placeholders + structure intact, no crash.
        assert "(未填)" in prompt
        assert "(无)" in prompt
        assert "你是谁" in prompt

    def test_includes_mcp_server_names(self) -> None:
        prompt = _build_compose_prompt_prompt(
            name="x",
            description="",
            skills=[],
            mcp_servers=[_mcp("m1", "Slack")],
        )
        assert "Slack" in prompt


class TestFormatToolBlock:
    def test_no_tools(self) -> None:
        assert _format_tool_block([], None) == "(无)"

    def test_no_registry_just_lists_ids(self) -> None:
        out = _format_tool_block(["a.b", "c.d"], None)
        assert "- a.b" in out
        assert "- c.d" in out

    def test_truncates_above_20_tools(self) -> None:
        ids = [f"t{i}" for i in range(25)]
        out = _format_tool_block(ids, None)
        assert "还有 5 个工具" in out


class TestExplainSkillStream:
    @pytest.mark.asyncio
    async def test_cache_hit_replays_without_calling_llm(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        skill = _skill(sid="skill.cached")
        ai_explainer._explain_cache[skill.id] = "已缓存的解读"

        provider_repo = AsyncMock()
        provider_repo.get_default.return_value = None  # would raise if called

        chunks: list[str] = []
        async for chunk in ai_explainer.explain_skill_stream(skill, provider_repo=provider_repo):
            chunks.append(chunk)
        assert "".join(chunks) == "已缓存的解读"
        provider_repo.get_default.assert_not_called()
        ai_explainer.invalidate_skill_explanation(skill.id)

    @pytest.mark.asyncio
    async def test_no_default_provider_raises_domain_error(self) -> None:
        skill = _skill(sid="skill.no-cache")
        ai_explainer.invalidate_skill_explanation(skill.id)
        provider_repo = AsyncMock()
        provider_repo.get_default.return_value = None

        with pytest.raises(DomainError):
            async for _ in ai_explainer.explain_skill_stream(skill, provider_repo=provider_repo):
                pass


class TestComposeEmployeePromptStream:
    @pytest.mark.asyncio
    async def test_no_default_provider_raises(self) -> None:
        provider_repo = AsyncMock()
        provider_repo.get_default.return_value = None

        skill_registry = type("R", (), {"get": lambda self, _id: None})()

        with pytest.raises(DomainError):
            async for _ in ai_explainer.compose_employee_prompt_stream(
                name="x",
                description="y",
                skill_ids=[],
                mcp_server_ids=[],
                provider_repo=provider_repo,
                skill_registry=skill_registry,
                mcp_repo=None,
            ):
                pass


class TestInvalidateCache:
    def test_pop_works_for_unknown_id(self) -> None:
        # Should be a no-op, not raise.
        ai_explainer.invalidate_skill_explanation("does-not-exist")


class TestStreamYieldsChunks:
    """Smoke-test the LLM streaming path with a fake astream — just to
    make sure ``_chunk_text`` extracts content from both string and
    list-of-blocks shapes.
    """

    @pytest.mark.asyncio
    async def test_chunk_text_extracts_string_content(self) -> None:
        from allhands.services.ai_explainer import _chunk_text

        class _C:
            content = "hi"

        assert _chunk_text(_C()) == "hi"

    @pytest.mark.asyncio
    async def test_chunk_text_extracts_anthropic_block_list(self) -> None:
        from allhands.services.ai_explainer import _chunk_text

        class _C:
            content: ClassVar[list[dict[str, str]]] = [
                {"type": "text", "text": "hi"},
                {"type": "thinking", "text": "x"},
            ]

        assert _chunk_text(_C()) == "hi"

    @pytest.mark.asyncio
    async def test_chunk_text_returns_empty_for_unknown_shape(self) -> None:
        from allhands.services.ai_explainer import _chunk_text

        class _C:
            content: Any = None

        assert _chunk_text(_C()) == ""
