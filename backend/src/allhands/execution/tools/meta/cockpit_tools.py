"""Cockpit family meta tools — workspace-level observation + emergency brake.

See `docs/specs/agent-design/2026-04-18-cockpit.md` § 5.

Contract:
- `cockpit.get_workspace_summary` — READ, no confirmation. Lead calls this first
  when the user asks about workspace state instead of stitching list_employees /
  list_triggers answers together.
- `cockpit.pause_all_runs` — IRREVERSIBLE, requires confirmation. Cancels every
  active run and pauses the trigger executor; confirmation payload shows the
  reason so the human can weigh it before approving.
"""

from __future__ import annotations

from allhands.core import Tool, ToolKind, ToolScope

COCKPIT_GET_WORKSPACE_SUMMARY_TOOL = Tool(
    id="allhands.meta.cockpit.get_workspace_summary",
    kind=ToolKind.META,
    name="cockpit.get_workspace_summary",
    description=(
        "Get a single-snapshot summary of the workspace: how many employees, "
        "how many runs currently active, today's token usage, system health "
        "(gateway / MCP / langfuse / db / triggers), recent activity (last 20 "
        "events), and any runs currently waiting for user confirmation. "
        "Use this when the user asks 'what's running right now', 'is everything "
        "healthy', or similar status questions — answer from this summary "
        "instead of stitching list_employees / list_triggers separately."
    ),
    input_schema={
        "type": "object",
        "properties": {},
        "additionalProperties": False,
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)

COCKPIT_PAUSE_ALL_RUNS_TOOL = Tool(
    id="allhands.meta.cockpit.pause_all_runs",
    kind=ToolKind.META,
    name="cockpit.pause_all_runs",
    description=(
        "Emergency brake: cancel every currently-active run and pause the "
        "trigger executor. Active runs get a cancel signal; in-flight tool "
        "calls may not roll back. Call ONLY when the user explicitly asks to "
        "stop everything, or when you detect a runaway loop. This is "
        "IRREVERSIBLE as far as in-flight side effects are concerned."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "reason": {
                "type": "string",
                "description": "Why pausing; shown on cockpit and in the audit log.",
            },
        },
        "required": ["reason"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.IRREVERSIBLE,
    requires_confirmation=True,
)


ALL_COCKPIT_META_TOOLS = [
    COCKPIT_GET_WORKSPACE_SUMMARY_TOOL,
    COCKPIT_PAUSE_ALL_RUNS_TOOL,
]
