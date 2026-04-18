"""Tool discovery — call discover_builtin_tools(registry) at startup."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from allhands.execution.registry import ToolRegistry
from allhands.execution.tools.builtin.fetch_url import TOOL as FETCH_URL_TOOL
from allhands.execution.tools.builtin.fetch_url import execute as fetch_url_execute
from allhands.execution.tools.builtin.write_file import TOOL as WRITE_FILE_TOOL
from allhands.execution.tools.builtin.write_file import execute as write_file_execute
from allhands.execution.tools.meta.employee_tools import ALL_META_TOOLS
from allhands.execution.tools.meta.mcp_server_tools import ALL_MCP_SERVER_META_TOOLS
from allhands.execution.tools.meta.model_tools import ALL_MODEL_META_TOOLS
from allhands.execution.tools.meta.plan_tools import ALL_PLAN_TOOLS
from allhands.execution.tools.meta.provider_tools import ALL_PROVIDER_META_TOOLS
from allhands.execution.tools.meta.skill_tools import ALL_SKILL_META_TOOLS
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


def discover_builtin_tools(registry: ToolRegistry) -> None:
    registry.register(FETCH_URL_TOOL, fetch_url_execute)
    registry.register(WRITE_FILE_TOOL, write_file_execute)
    for tool, executor in _RENDER_TOOLS:
        registry.register(tool, executor)
    for tool in (
        *ALL_META_TOOLS,
        *ALL_PROVIDER_META_TOOLS,
        *ALL_MODEL_META_TOOLS,
        *ALL_SKILL_META_TOOLS,
        *ALL_MCP_SERVER_META_TOOLS,
        *ALL_PLAN_TOOLS,
        *ALL_TRIGGER_META_TOOLS,
    ):
        registry.register(tool, _async_noop)
