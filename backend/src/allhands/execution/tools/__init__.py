"""Tool discovery — call discover_builtin_tools(registry) at startup."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from allhands.core import Tool
    from allhands.execution.registry import ToolExecutor, ToolRegistry
from allhands.execution.tools.builtin.ask_user_question import (
    TOOL as ASK_USER_QUESTION_TOOL,
)
from allhands.execution.tools.builtin.ask_user_question import (
    execute as ask_user_question_execute,
)
from allhands.execution.tools.builtin.fetch_url import TOOL as FETCH_URL_TOOL
from allhands.execution.tools.builtin.fetch_url import execute as fetch_url_execute
from allhands.execution.tools.builtin.web_search import TOOL as WEB_SEARCH_TOOL
from allhands.execution.tools.builtin.web_search import execute as web_search_execute
from allhands.execution.tools.builtin.write_file import TOOL as WRITE_FILE_TOOL
from allhands.execution.tools.builtin.write_file import execute as write_file_execute
from allhands.execution.tools.meta.artifact_office import ALL_ARTIFACT_OFFICE_TOOLS
from allhands.execution.tools.meta.artifact_tools import ALL_ARTIFACT_TOOLS
from allhands.execution.tools.meta.channel_tools import (
    ALL_CHANNEL_META_TOOLS,  # single-line register: Wave 2 notification-channels
)
from allhands.execution.tools.meta.cockpit_tools import ALL_COCKPIT_META_TOOLS
from allhands.execution.tools.meta.conversation_tools import ALL_CONVERSATION_META_TOOLS
from allhands.execution.tools.meta.employee_tools import (
    ALL_META_TOOLS,
    CREATE_EMPLOYEE_TOOL,
    execute_create_employee,
)
from allhands.execution.tools.meta.knowledge_tools import ALL_KB_META_TOOLS
from allhands.execution.tools.meta.market_tools import (  # single-line register: Wave 2 market-data
    ALL_MARKET_META_TOOLS,
)
from allhands.execution.tools.meta.mcp_server_tools import ALL_MCP_SERVER_META_TOOLS
from allhands.execution.tools.meta.model_tools import ALL_MODEL_META_TOOLS
from allhands.execution.tools.meta.observatory_tools import ALL_OBSERVATORY_META_TOOLS
from allhands.execution.tools.meta.plan_tools import ALL_PLAN_TOOLS
from allhands.execution.tools.meta.pricing_tools import ALL_PRICING_META_TOOLS
from allhands.execution.tools.meta.provider_tools import ALL_PROVIDER_META_TOOLS
from allhands.execution.tools.meta.resolve_skill import RESOLVE_SKILL_TOOL
from allhands.execution.tools.meta.review_tools import ALL_REVIEW_META_TOOLS
from allhands.execution.tools.meta.skill_files import READ_SKILL_FILE_TOOL
from allhands.execution.tools.meta.skill_tools import ALL_SKILL_META_TOOLS
from allhands.execution.tools.meta.spawn_subagent import SPAWN_SUBAGENT_TOOL
from allhands.execution.tools.meta.stock_tools import (  # single-line register: Wave 2 stock-assistant
    ALL_STOCK_ASSISTANT_TOOLS,
)
from allhands.execution.tools.meta.task_tools import ALL_TASK_META_TOOLS
from allhands.execution.tools.meta.trigger_tools import ALL_TRIGGER_META_TOOLS
from allhands.execution.tools.render.bar_chart import TOOL as BAR_CHART_TOOL
from allhands.execution.tools.render.bar_chart import execute as bar_chart_execute
from allhands.execution.tools.render.callout import TOOL as CALLOUT_TOOL
from allhands.execution.tools.render.callout import execute as callout_execute
from allhands.execution.tools.render.cards import TOOL as CARDS_TOOL
from allhands.execution.tools.render.cards import execute as cards_execute
from allhands.execution.tools.render.code import TOOL as CODE_TOOL
from allhands.execution.tools.render.code import execute as code_execute
from allhands.execution.tools.render.diff import TOOL as DIFF_TOOL
from allhands.execution.tools.render.diff import execute as diff_execute
from allhands.execution.tools.render.kv import TOOL as KV_TOOL
from allhands.execution.tools.render.kv import execute as kv_execute
from allhands.execution.tools.render.line_chart import TOOL as LINE_CHART_TOOL
from allhands.execution.tools.render.line_chart import execute as line_chart_execute
from allhands.execution.tools.render.link_card import TOOL as LINK_CARD_TOOL
from allhands.execution.tools.render.link_card import execute as link_card_execute
from allhands.execution.tools.render.markdown_card import TOOL as MARKDOWN_CARD_TOOL
from allhands.execution.tools.render.markdown_card import execute as markdown_card_execute
from allhands.execution.tools.render.pie_chart import TOOL as PIE_CHART_TOOL
from allhands.execution.tools.render.pie_chart import execute as pie_chart_execute

# render_plan deprecated (2026-04-25 user feedback): the Approve/Reject/Edit
# gate-style card semantic conflicts with the new "make plan AND execute"
# default. Use plan_create + plan_view (plan_executors.py) instead. The
# render module file is retained for component registry compatibility but
# the tool is no longer registered with the ToolRegistry.
from allhands.execution.tools.render.stat import TOOL as STAT_TOOL
from allhands.execution.tools.render.stat import execute as stat_execute
from allhands.execution.tools.render.steps import TOOL as STEPS_TOOL
from allhands.execution.tools.render.steps import execute as steps_execute
from allhands.execution.tools.render.table import TOOL as TABLE_TOOL
from allhands.execution.tools.render.table import execute as table_execute
from allhands.execution.tools.render.timeline import TOOL as TIMELINE_TOOL
from allhands.execution.tools.render.timeline import execute as timeline_execute


async def _async_noop(**kwargs: object) -> dict[str, object]:
    return {}


_RENDER_TOOLS = (
    (MARKDOWN_CARD_TOOL, markdown_card_execute),
    (TABLE_TOOL, table_execute),
    (KV_TOOL, kv_execute),
    (CARDS_TOOL, cards_execute),
    (TIMELINE_TOOL, timeline_execute),
    (STEPS_TOOL, steps_execute),
    (CODE_TOOL, code_execute),
    (DIFF_TOOL, diff_execute),
    (CALLOUT_TOOL, callout_execute),
    (LINK_CARD_TOOL, link_card_execute),
    # render_plan removed 2026-04-25 — see import block comment above
    (STAT_TOOL, stat_execute),
    (LINE_CHART_TOOL, line_chart_execute),
    (BAR_CHART_TOOL, bar_chart_execute),
    (PIE_CHART_TOOL, pie_chart_execute),
)


# Meta tools with real executors. The default for meta tools is the no-op
# stub (they're driven through the service/REST path); these have tight,
# pure executors that shape their result into a render envelope or similar.
_META_TOOLS_WITH_EXECUTORS: tuple[tuple[Tool, ToolExecutor], ...] = (
    # I-0008: create_employee returns an EmployeeCard render envelope so Lead
    # chat renders the new employee inline without leaving /chat.
    (CREATE_EMPLOYEE_TOOL, execute_create_employee),
)

_META_EXECUTOR_TOOL_IDS = frozenset(t.id for t, _ in _META_TOOLS_WITH_EXECUTORS)


def discover_builtin_tools(
    registry: ToolRegistry,
    session_maker: Any | None = None,
    extra_executors: dict[str, Any] | None = None,
) -> None:
    """Register every builtin / render / meta tool on the registry.

    ``session_maker`` (E21): when provided, READ-scope meta tools (list_* /
    get_*) get real executors that open a fresh async session per invocation.
    When omitted — the pre-E21 path — they fall back to ``_async_noop`` and
    return ``{}``; that's the path Lead was on, and why Lead reported "0 of
    each" even though the DB clearly had records. Keep the ``None`` branch
    for unit tests that build registries without any DB.

    ``extra_executors``: optional ``{tool_id: executor}`` mapping injected
    from the ``api/`` layer for meta tools whose executors close over a
    service (e.g. ``SkillService`` for skill install). The ``execution/``
    layer cannot import from ``services/`` by the layered contract, so the
    caller constructs these executors and passes them in.
    """

    registry.register(FETCH_URL_TOOL, fetch_url_execute)
    registry.register(WEB_SEARCH_TOOL, web_search_execute)
    registry.register(WRITE_FILE_TOOL, write_file_execute)
    registry.register(ASK_USER_QUESTION_TOOL, ask_user_question_execute)
    for tool, executor in _RENDER_TOOLS:
        registry.register(tool, executor)
    for meta_tool, meta_executor in _META_TOOLS_WITH_EXECUTORS:
        registry.register(meta_tool, meta_executor)

    read_meta_executors: dict[str, Any] = {}
    if session_maker is not None:
        from allhands.execution.tools.meta.executors import READ_META_EXECUTORS

        for tool_id, factory in READ_META_EXECUTORS.items():
            read_meta_executors[tool_id] = factory(session_maker)

    for tool in (
        RESOLVE_SKILL_TOOL,
        READ_SKILL_FILE_TOOL,
        SPAWN_SUBAGENT_TOOL,
        *ALL_META_TOOLS,
        *ALL_PROVIDER_META_TOOLS,
        *ALL_MODEL_META_TOOLS,
        *ALL_SKILL_META_TOOLS,
        *ALL_MCP_SERVER_META_TOOLS,
        *ALL_PLAN_TOOLS,
        *ALL_TRIGGER_META_TOOLS,
        *ALL_ARTIFACT_TOOLS,
        *ALL_ARTIFACT_OFFICE_TOOLS,
        *ALL_COCKPIT_META_TOOLS,
        *ALL_TASK_META_TOOLS,
        *ALL_CONVERSATION_META_TOOLS,  # history panel · delete_conversation
        *ALL_CHANNEL_META_TOOLS,  # single-line register: Wave 2 notification-channels
        *ALL_MARKET_META_TOOLS,  # single-line register: Wave 2 market-data
        *ALL_STOCK_ASSISTANT_TOOLS,  # single-line register: Wave 2 stock-assistant
        *ALL_REVIEW_META_TOOLS,
        *ALL_OBSERVATORY_META_TOOLS,
        *ALL_PRICING_META_TOOLS,
        *ALL_KB_META_TOOLS,
    ):
        if tool.id in _META_EXECUTOR_TOOL_IDS:
            continue
        injected = extra_executors.get(tool.id) if extra_executors else None
        if injected is not None:
            registry.register(tool, injected)
            continue
        real_executor = read_meta_executors.get(tool.id)
        if real_executor is not None:
            registry.register(tool, real_executor)
        else:
            registry.register(tool, _async_noop)
