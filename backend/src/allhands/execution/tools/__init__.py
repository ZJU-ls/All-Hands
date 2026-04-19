"""Tool discovery — call discover_builtin_tools(registry) at startup."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from allhands.core import Tool
    from allhands.execution.registry import ToolExecutor, ToolRegistry
from allhands.execution.tools.builtin.fetch_url import TOOL as FETCH_URL_TOOL
from allhands.execution.tools.builtin.fetch_url import execute as fetch_url_execute
from allhands.execution.tools.builtin.write_file import TOOL as WRITE_FILE_TOOL
from allhands.execution.tools.builtin.write_file import execute as write_file_execute
from allhands.execution.tools.meta.artifact_tools import ALL_ARTIFACT_TOOLS
from allhands.execution.tools.meta.channel_tools import (
    ALL_CHANNEL_META_TOOLS,  # single-line register: Wave 2 notification-channels
)
from allhands.execution.tools.meta.cockpit_tools import ALL_COCKPIT_META_TOOLS
from allhands.execution.tools.meta.employee_tools import (
    ALL_META_TOOLS,
    CREATE_EMPLOYEE_TOOL,
    execute_create_employee,
)
from allhands.execution.tools.meta.market_tools import (  # single-line register: Wave 2 market-data
    ALL_MARKET_META_TOOLS,
)
from allhands.execution.tools.meta.mcp_server_tools import ALL_MCP_SERVER_META_TOOLS
from allhands.execution.tools.meta.model_tools import ALL_MODEL_META_TOOLS
from allhands.execution.tools.meta.observatory_tools import ALL_OBSERVATORY_META_TOOLS
from allhands.execution.tools.meta.plan_tools import ALL_PLAN_TOOLS
from allhands.execution.tools.meta.provider_tools import ALL_PROVIDER_META_TOOLS
from allhands.execution.tools.meta.review_tools import ALL_REVIEW_META_TOOLS
from allhands.execution.tools.meta.skill_tools import ALL_SKILL_META_TOOLS
from allhands.execution.tools.meta.stock_tools import (  # single-line register: Wave 2 stock-assistant
    ALL_STOCK_ASSISTANT_TOOLS,
)
from allhands.execution.tools.meta.task_tools import ALL_TASK_META_TOOLS
from allhands.execution.tools.meta.trigger_tools import ALL_TRIGGER_META_TOOLS
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
from allhands.execution.tools.render.link_card import TOOL as LINK_CARD_TOOL
from allhands.execution.tools.render.link_card import execute as link_card_execute
from allhands.execution.tools.render.markdown_card import TOOL as MARKDOWN_CARD_TOOL
from allhands.execution.tools.render.markdown_card import execute as markdown_card_execute
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


def discover_builtin_tools(registry: ToolRegistry) -> None:
    registry.register(FETCH_URL_TOOL, fetch_url_execute)
    registry.register(WRITE_FILE_TOOL, write_file_execute)
    for tool, executor in _RENDER_TOOLS:
        registry.register(tool, executor)
    for meta_tool, meta_executor in _META_TOOLS_WITH_EXECUTORS:
        registry.register(meta_tool, meta_executor)
    for tool in (
        *ALL_META_TOOLS,
        *ALL_PROVIDER_META_TOOLS,
        *ALL_MODEL_META_TOOLS,
        *ALL_SKILL_META_TOOLS,
        *ALL_MCP_SERVER_META_TOOLS,
        *ALL_PLAN_TOOLS,
        *ALL_TRIGGER_META_TOOLS,
        *ALL_ARTIFACT_TOOLS,
        *ALL_COCKPIT_META_TOOLS,
        *ALL_TASK_META_TOOLS,
        *ALL_CHANNEL_META_TOOLS,  # single-line register: Wave 2 notification-channels
        *ALL_MARKET_META_TOOLS,  # single-line register: Wave 2 market-data
        *ALL_STOCK_ASSISTANT_TOOLS,  # single-line register: Wave 2 stock-assistant
        *ALL_REVIEW_META_TOOLS,
        *ALL_OBSERVATORY_META_TOOLS,
    ):
        if tool.id in _META_EXECUTOR_TOOL_IDS:
            continue
        registry.register(tool, _async_noop)
