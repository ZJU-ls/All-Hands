"""Backend tool: fetch_url — fetch a URL and return its text content."""

from __future__ import annotations

import httpx

from allhands.core import CostHint, Tool, ToolKind, ToolScope

TOOL = Tool(
    id="allhands.builtin.fetch_url",
    kind=ToolKind.BACKEND,
    name="fetch_url",
    description=("Fetch a URL and return its text content. Use for web pages or JSON APIs."),
    input_schema={
        "type": "object",
        "properties": {
            "url": {"type": "string", "description": "The URL to fetch."},
            "timeout": {"type": "integer", "default": 10, "description": "Timeout in seconds."},
        },
        "required": ["url"],
    },
    output_schema={"type": "object", "properties": {"content": {"type": "string"}}},
    scope=ToolScope.READ,
    requires_confirmation=False,
    cost_hint=CostHint(relative="low"),
)


async def execute(url: str, timeout: int = 10) -> dict[str, str]:  # noqa: ASYNC109
    async with httpx.AsyncClient(follow_redirects=True) as client:
        response = await client.get(url, timeout=timeout)
        response.raise_for_status()
        return {"content": response.text[:50000]}
