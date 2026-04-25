"""AI-native single-turn streaming helpers.

Two surfaces, one job each:

- ``explain_skill_stream`` — turn a Skill's descriptor + prompt fragment +
  tool list into a "say-it-in-Chinese" Markdown explanation. The Skill
  panel hits this when the user clicks the 「解读」chip; the result tells
  them *what* the skill does, *when* to reach for it, and *what* it
  cannot do — without making them squint at YAML / Markdown source.

- ``compose_employee_prompt_stream`` — given a draft employee's
  ``name`` / ``description`` / picked Skills + MCP servers, draft a
  system_prompt the user can save as-is or tweak. The employee form's
  「✨ 生成」button pipes the stream back into the textarea live.

Both share one tiny invariant: **single-turn, no agent loop**. We don't
need react-graph / tools / gates / checkpointers for what is really a
classification + paraphrase task. ``ChatOpenAI``/``ChatAnthropic`` from
``execution.llm_factory.build_llm`` astream() is enough — each text
chunk is a string, the caller (router) wraps it as SSE.

Model picked via ``LLMProviderRepo.get_default()`` + its
``default_model``. The three-stage resolver lives in
``execution.model_resolution`` for the chat surface; here we always use
the workspace default — the user isn't picking a model, they're asking
"explain X" / "draft a prompt", and the platform should answer with
whatever the workspace standardised on.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from langchain_core.messages import HumanMessage

from allhands.core.errors import DomainError
from allhands.execution.llm_factory import build_llm
from allhands.i18n import t

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from allhands.core.mcp import MCPServer
    from allhands.core.skill import Skill
    from allhands.execution.registry import ToolRegistry
    from allhands.execution.skills import SkillRegistry
    from allhands.persistence.repositories import LLMProviderRepo, MCPServerRepo

log = logging.getLogger(__name__)


# Token cap for either prompt — well under 128k context for any provider
# and keeps cost predictable. The skills explainer barely touches this;
# the employee composer hits it only with very long descriptions.
_MAX_OUTPUT_TOKENS = 1200

# In-memory explanation cache. Clicks on the same skill re-use the result
# until the process restarts or the skill is reinstalled. v0 size cap is
# implicit (one entry per installed skill — at most a few hundred). When
# we need cross-process caching we can promote this to a column on the
# skills table; today the savings vs complexity argue against persistence.
_explain_cache: dict[str, str] = {}


# Market explanations live under their own keyspace ("market:<slug>") so
# the installed-skill cache stays clean and a market preview cache hit
# survives even if the user later installs the skill (we'll regenerate
# from richer data once installed).
def _market_cache_key(slug: str) -> str:
    return f"market:{slug}"


def invalidate_skill_explanation(skill_id: str) -> None:
    """Drop any cached explanation for this skill — call on update / reinstall."""
    _explain_cache.pop(skill_id, None)


def invalidate_market_explanation(slug: str) -> None:
    """Drop any cached explanation for this market entry."""
    _explain_cache.pop(_market_cache_key(slug), None)


def _format_tool_block(tool_ids: list[str], tool_registry: ToolRegistry | None) -> str:
    if not tool_ids:
        return "(无)"
    lines: list[str] = []
    for tid in tool_ids[:20]:
        if tool_registry is None:
            lines.append(f"- {tid}")
            continue
        try:
            tool, _executor = tool_registry.get(tid)
        except KeyError:
            lines.append(f"- {tid} (未注册)")
            continue
        desc = (tool.description or "").strip().splitlines()[0][:120]
        lines.append(f"- {tool.name} ({tid}) — {desc}")
    if len(tool_ids) > 20:
        lines.append(f"- … 还有 {len(tool_ids) - 20} 个工具")
    return "\n".join(lines)


def _build_skill_explain_prompt(skill: Skill, tool_block: str) -> str:
    fragment = (skill.prompt_fragment or "").strip()
    fragment_section = f"\n## 激活时注入的提示片段\n\n```\n{fragment}\n```\n" if fragment else ""
    return (
        "你是 allhands 平台的 AI 助手。下面这份「技能(Skill)」是平台员工(数字员工)"
        "在对话中可被激活的能力包。请用清晰、口语化的中文,帮用户一眼看懂它。\n\n"
        "---\n\n"
        f"## 技能元信息\n\n"
        f"- **名称:** {skill.name}\n"
        f"- **版本:** {skill.version}\n"
        f"- **来源:** {skill.source.value}\n"
        f"- **官方描述:** {skill.description}\n"
        f"{fragment_section}"
        f"\n## 它包含的工具\n\n{tool_block}\n\n"
        "---\n\n"
        "请用以下结构输出 Markdown(每段都要有,不要省略),控制在 250 字以内:\n\n"
        "### 一句话作用\n"
        "(用一句话告诉用户这个技能在干什么)\n\n"
        "### 典型场景\n"
        "(2-3 个具体的、能让用户产生'对,这就是我要的'感觉的场景。"
        "不要写'用于处理 X 任务'这种空话)\n\n"
        "### 不适合的情况\n"
        "(1-2 个。让用户清楚边界,而不是无脑给员工挂这个技能)\n\n"
        "### 工作机制\n"
        "(1-2 句。这个技能内部依赖哪些关键工具或外部服务,普通用户能听懂的层级)"
    )


_SKILL_MD_BODY_CAP = 6000


def _build_market_explain_prompt(
    *,
    name: str,
    description: str,
    version: str,
    source_url: str,
    skill_md: str,
) -> str:
    """Same four-section explainer contract as _build_skill_explain_prompt
    but fed from a market preview instead of an installed Skill domain
    object — we don't have tool_ids / prompt_fragment, only the raw
    SKILL.md README the maintainer wrote. Cap body at ~6KB so a long
    README doesn't blow the prompt budget; the model reads enough to
    understand the skill's intent.
    """
    body = (skill_md or "").strip()
    if len(body) > _SKILL_MD_BODY_CAP:
        body = body[:_SKILL_MD_BODY_CAP] + "\n\n…(SKILL.md 已截断,只取前 6KB 用于解读)"
    body_section = f"\n## SKILL.md 正文\n\n```markdown\n{body}\n```\n" if body else ""
    return (
        "你是 allhands 平台的 AI 助手。用户正在浏览**官方技能市场**,"
        "想快速判断下面这份还**没安装**的技能值不值得装。"
        "请用清晰、口语化的中文,帮 ta 一眼看懂它。\n\n"
        "---\n\n"
        f"## 市场元信息\n\n"
        f"- **名称:** {name}\n"
        f"- **版本:** {version}\n"
        f"- **官方描述:** {description}\n"
        f"- **来源:** {source_url}\n"
        f"{body_section}"
        "---\n\n"
        "请用以下结构输出 Markdown(每段都要有,不要省略),控制在 280 字以内:\n\n"
        "### 一句话作用\n"
        "(用一句话告诉用户这个技能在干什么)\n\n"
        "### 典型场景\n"
        "(2-3 个具体的、能让用户产生'对,这就是我要的'感觉的场景)\n\n"
        "### 不适合的情况\n"
        "(1-2 个。让用户清楚边界)\n\n"
        "### 装上之后能干啥\n"
        "(1-2 句。装到员工身上后,员工实际能调用的工具 / 工作方式 — "
        "从 SKILL.md 里能看出来什么就说什么,看不出来就说「安装后会引入若干工具,"
        "具体在详情页查看」)"
    )


def _build_compose_prompt_prompt(
    *,
    name: str,
    description: str,
    skills: list[Skill],
    mcp_servers: list[MCPServer],
) -> str:
    skill_lines = (
        "\n".join(f"- **{s.name}** — {s.description}" for s in skills) if skills else "(无)"
    )
    mcp_lines = (
        "\n".join(f"- **{m.name}** — {len(m.exposed_tool_ids)} 个工具" for m in mcp_servers)
        if mcp_servers
        else "(无)"
    )
    return (
        "你是 allhands 平台的 prompt 工程师。用户正在创建一个数字员工,"
        "请根据以下信号给他起草一份 system_prompt(中文)。\n\n"
        "---\n\n"
        f"## 员工基础信息\n\n- **名字:** {name or '(未填)'}\n- **职责描述:** {description or '(未填)'}\n"
        f"\n## 已挂载的技能\n\n{skill_lines}\n"
        f"\n## 已挂载的 MCP 服务器\n\n{mcp_lines}\n\n"
        "---\n\n"
        "## 输出要求\n\n"
        "直接输出 system_prompt 的内容(不要前置说明、不要 ``` 包裹、不要标题"
        "「以下是 ... 」),用第二人称对员工说话(「你是 ...」「你的工作流程是 ...」)。"
        "结构(用 Markdown 标题分段):\n\n"
        "### 你是谁\n(1-2 句角色设定 — 不要重复用户填的描述,而是把它'升华'一层)\n\n"
        "### 你的工作流程\n(3-5 步,每步说清要做什么 + 何时调用挂载的技能 / MCP)\n\n"
        "### 边界与原则\n(2-3 条:必须做什么 / 绝不做什么 / 何时把问题交回给用户)\n\n"
        "---\n\n"
        "字数控制在 400 字以内。挂载的技能和 MCP 必须至少被点名一次,"
        "让员工知道「我手上有什么」。如果用户没填描述,根据名字合理推测一种常见角色。"
    )


async def explain_skill_stream(
    skill: Skill,
    *,
    provider_repo: LLMProviderRepo,
    tool_registry: ToolRegistry | None = None,
) -> AsyncIterator[str]:
    """Stream a Markdown explanation of `skill` chunk-by-chunk.

    Cache hit → yield the cached text in one shot (still as an async
    iterator so the caller's SSE plumbing doesn't need a special path).
    """
    cached = _explain_cache.get(skill.id)
    if cached:
        yield cached
        return

    provider = await provider_repo.get_default()
    if provider is None:
        raise DomainError(t("errors.no_default_provider"))

    prompt_text = _build_skill_explain_prompt(
        skill, _format_tool_block(skill.tool_ids, tool_registry)
    )
    llm = _build_explainer_llm(provider, provider.default_model)

    chunks: list[str] = []
    async for chunk in llm.astream([HumanMessage(content=prompt_text)]):  # type: ignore[attr-defined]
        # LangChain's chunk objects carry .content which is either a string
        # or a list of content blocks (Anthropic). We surface plain text
        # only — the explainer doesn't need tool_use / thinking blocks.
        text = _chunk_text(chunk)
        if text:
            chunks.append(text)
            yield text

    full = "".join(chunks).strip()
    if full:
        _explain_cache[skill.id] = full


async def explain_market_skill_stream(
    *,
    slug: str,
    name: str,
    description: str,
    version: str,
    source_url: str,
    skill_md: str,
    provider_repo: LLMProviderRepo,
) -> AsyncIterator[str]:
    """Stream a Markdown explanation for an **uninstalled** market skill.

    Same contract as ``explain_skill_stream`` but sourced from the GitHub
    market preview — we don't have tool_ids / prompt_fragment yet, only
    the raw SKILL.md the maintainer wrote, so the prompt asks the model
    to ground its answer in that body. Cached under ``market:<slug>``;
    cache lifetime = process lifetime (no programmatic invalidation
    upstream — market entries are fetched fresh from GitHub each time
    so a true edit shows up after a process restart, which matches user
    expectation for a list that's already 5-min-cached at the source).
    """
    key = _market_cache_key(slug)
    cached = _explain_cache.get(key)
    if cached:
        yield cached
        return

    provider = await provider_repo.get_default()
    if provider is None:
        raise DomainError(t("errors.no_default_provider"))

    prompt_text = _build_market_explain_prompt(
        name=name,
        description=description,
        version=version,
        source_url=source_url,
        skill_md=skill_md,
    )
    llm = _build_explainer_llm(provider, provider.default_model)

    chunks: list[str] = []
    async for chunk in llm.astream([HumanMessage(content=prompt_text)]):  # type: ignore[attr-defined]
        text = _chunk_text(chunk)
        if text:
            chunks.append(text)
            yield text

    full = "".join(chunks).strip()
    if full:
        _explain_cache[key] = full


async def compose_employee_prompt_stream(
    *,
    name: str,
    description: str,
    skill_ids: list[str],
    mcp_server_ids: list[str],
    provider_repo: LLMProviderRepo,
    skill_registry: SkillRegistry,
    mcp_repo: MCPServerRepo | None,
) -> AsyncIterator[str]:
    """Stream a draft system_prompt back to the caller.

    Resolves skill_ids and mcp_server_ids to their domain objects so the
    composer prompt can reference them by name and description. Unknown
    ids are silently dropped — the caller's UI typically prevents picking
    invalid ones, and a strict-fail here would block the user from
    iterating on the form.
    """
    provider = await provider_repo.get_default()
    if provider is None:
        raise DomainError(t("errors.no_default_provider"))

    skills: list[Skill] = []
    for sid in skill_ids:
        s = skill_registry.get(sid)
        if s is not None:
            skills.append(s)

    mcp_servers: list[MCPServer] = []
    if mcp_repo is not None and mcp_server_ids:
        try:
            all_mcp = await mcp_repo.list_all()
            wanted = set(mcp_server_ids)
            mcp_servers = [m for m in all_mcp if m.id in wanted]
        except Exception:
            log.exception("compose_prompt · mcp.list_all failed; continuing without")

    prompt_text = _build_compose_prompt_prompt(
        name=name, description=description, skills=skills, mcp_servers=mcp_servers
    )
    llm = _build_explainer_llm(provider, provider.default_model)

    async for chunk in llm.astream([HumanMessage(content=prompt_text)]):  # type: ignore[attr-defined]
        text = _chunk_text(chunk)
        if text:
            yield text


def _build_explainer_llm(provider: object, model_name: str) -> object:
    """Build an LLM bound for explainer use — thinking explicitly OFF.

    Without this, models with reasoning channels (Anthropic Extended
    Thinking, Qwen3, DeepSeek-R1, GLM-Z1) stream a long ``thinking`` /
    ``reasoning_content`` block first that we don't surface. The user
    sees a blank panel for 20-60s and assumes it hung. The explainer
    surfaces are short paraphrase tasks — reasoning is wasted latency.

    For Anthropic-kind providers we wire ``thinking=False`` into the
    constructor (``ChatAnthropic.thinking`` is read at payload-build
    time; .bind() doesn't propagate — see llm_factory docstring).
    For OpenAI-compat providers we ``.bind(extra_body=...)`` since the
    enable_thinking flag is a vendor extension that travels via
    ``extra_body`` (Qwen / DashScope) or ``reasoning_effort`` (DeepSeek).
    Setting both is harmless on providers that ignore the field.
    """
    # Duck-typed `provider` keeps this helper callable from unit tests
    # without dragging the full LLMProvider domain dance into them.
    kind = getattr(provider, "kind", "openai")
    if kind == "anthropic":
        return build_llm(provider, model_name, thinking=False).bind(  # type: ignore[arg-type]
            max_tokens=_MAX_OUTPUT_TOKENS
        )
    base = build_llm(provider, model_name)  # type: ignore[arg-type]
    return base.bind(
        max_tokens=_MAX_OUTPUT_TOKENS,
        # Qwen3 / DashScope: enable_thinking lives in extra_body.
        # DeepSeek-R1 honours reasoning_effort="none". OpenAI-classic
        # ignores both. Belt-and-braces for the heterogeneous
        # OpenAI-compat fleet our users plug in.
        extra_body={"enable_thinking": False},
        reasoning_effort="none",
    )


def _chunk_text(chunk: object) -> str:
    """Extract plain text from a LangChain stream chunk.

    Anthropic's ``ChatAnthropic`` yields chunks whose ``.content`` is a
    list of content blocks (``{"type": "text", "text": "..."}`` or
    ``{"type": "thinking", ...}``). OpenAI's ``ChatOpenAI`` yields
    plain-string ``.content``. We surface text only — thinking / tool_use
    blocks aren't useful for the explainer surfaces.
    """
    content = getattr(chunk, "content", None)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        out: list[str] = []
        for block in content:
            if isinstance(block, dict):
                if block.get("type") == "text":
                    text = block.get("text")
                    if isinstance(text, str):
                        out.append(text)
            elif isinstance(block, str):
                out.append(block)
        return "".join(out)
    return ""
