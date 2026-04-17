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
from allhands.execution.tools.render.markdown_card import TOOL as MARKDOWN_CARD_TOOL
from allhands.execution.tools.render.markdown_card import execute as markdown_card_execute


async def _async_noop(**kwargs: object) -> dict[str, object]:
    return {}


def discover_builtin_tools(registry: ToolRegistry) -> None:
    registry.register(FETCH_URL_TOOL, fetch_url_execute)
    registry.register(WRITE_FILE_TOOL, write_file_execute)
    registry.register(MARKDOWN_CARD_TOOL, markdown_card_execute)
    for tool in ALL_META_TOOLS:
        registry.register(tool, _async_noop)
