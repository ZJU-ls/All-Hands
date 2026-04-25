"""Backend tool: ask_user_question — ADR 0019 C3 clarification flow.

The tool defers via UserInputDeferred (wired in AgentLoop._permission_check
when ``requires_user_input=True``). After the user answers via the HTTP
endpoint, the pipeline merges the answers dict into the executor's input,
and this body simply echoes the structured payload so the LLM sees the
user's choices in tool-result form.
"""

from __future__ import annotations

from typing import Any

from allhands.core import CostHint, Tool, ToolKind, ToolScope

TOOL = Tool(
    id="allhands.builtin.ask_user_question",
    kind=ToolKind.BACKEND,
    name="ask_user_question",
    description=(
        "Ask the user 1-4 multiple-choice questions when truly ambiguous. "
        "NOT for every step. Each question has a label, description, and "
        "optional preview. The user picks an answer string per question."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "questions": {
                "type": "array",
                "minItems": 1,
                "maxItems": 4,
                "items": {
                    "type": "object",
                    "properties": {
                        "label": {"type": "string"},
                        "description": {"type": "string"},
                        "preview": {"type": "string"},
                    },
                    "required": ["label", "description"],
                },
            },
        },
        "required": ["questions"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
    requires_user_input=True,
    cost_hint=CostHint(relative="low"),
)


async def execute(
    *,
    questions: list[dict[str, Any]] | None = None,
    answers: dict[str, str] | None = None,
    **_: Any,
) -> dict[str, Any]:
    """Echo the questions + answers payload back to the LLM.

    The deferred signal injects ``answers`` (dict[label → answer]) before
    the pipeline calls this — the merge happens in
    ``tool_pipeline.execute_tool_use_iter``. When answers is missing
    (defensive path / direct call from tests) we return an empty dict.
    """
    return {"answers": answers or {}, "questions": questions or []}
