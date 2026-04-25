"""Observatory family meta tools — trace + bootstrap status for Lead Agent.

Spec `docs/specs/agent-design/2026-04-18-observatory.md` § 7.

Four tools · three READ + one BOOTSTRAP. All exempt from L01 REST-parity
because they are orchestration reads (Traces are a read-only listing, spec
§ 3.1), but each mirrors a REST endpoint in ``api/routers/observatory.py``
so ``observatory.query_traces`` in chat and ``GET /api/observatory/traces``
on the page never drift.

Descriptions follow the V04 TodoWrite idiom (spec § 7.1): WHEN TO USE /
WHEN NOT TO USE / PARAMS in the body so the Lead Agent's router can pick
this over cockpit.get_workspace_summary without a tool-spec round-trip.
"""

from __future__ import annotations

from allhands.core import Tool, ToolKind, ToolScope

OBSERVATORY_QUERY_TRACES_TOOL = Tool(
    id="allhands.meta.observatory.query_traces",
    kind=ToolKind.META,
    name="observatory.query_traces",
    description=(
        "Query observability traces for this workspace. Returns one row per "
        "agent run with trace_id, employee, status, duration_s, tokens, "
        "started_at — sorted newest first.\n\n"
        "**WHEN TO USE**: The user asks analytic / historical questions — "
        "'how many runs did writer do this week', 'what's the P50 latency "
        "today', 'show me the failed runs in the last hour'. Lead Agent "
        "should prefer this over re-reading conversation history because "
        "every run is recorded here with uniform shape.\n\n"
        "**WHEN NOT TO USE**: User wants *current* live workspace state "
        "('what's running right now') — use cockpit.get_workspace_summary. "
        "User asks for one specific trace ('open trace abc123') — use "
        "observatory.get_trace. Observability is disabled (check "
        "observatory.get_status first if unsure; result will be [] but "
        "the user probably wants to know why).\n\n"
        "**PARAMS**: employee_id (optional), status ('ok' | 'failed'), "
        "since (ISO-8601), until (ISO-8601), limit (default 50, max 500)."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "employee_id": {"type": "string"},
            "status": {"type": "string", "enum": ["ok", "failed"]},
            "since": {"type": "string", "format": "date-time"},
            "until": {"type": "string", "format": "date-time"},
            "limit": {
                "type": "integer",
                "minimum": 1,
                "maximum": 500,
                "default": 50,
            },
        },
        "additionalProperties": False,
    },
    output_schema={
        "type": "object",
        "properties": {
            "traces": {"type": "array"},
            "count": {"type": "integer"},
        },
    },
    scope=ToolScope.READ,
    requires_confirmation=False,
)


OBSERVATORY_GET_TRACE_TOOL = Tool(
    id="allhands.meta.observatory.get_trace",
    kind=ToolKind.META,
    name="observatory.get_trace",
    description=(
        "Fetch a single trace by id with its summary row (employee, "
        "duration, tokens, status, started_at).\n\n"
        "**WHEN TO USE**: User referenced a specific trace id and wants "
        "the details ('what happened in run abc123'), or a follow-up on "
        "a trace_id returned by observatory.query_traces.\n\n"
        "**WHEN NOT TO USE**: You don't have a specific id yet (list first "
        "via observatory.query_traces). For the full Langfuse span tree / "
        "raw token stream, hand the user the trace_id and let them click "
        "through to the Langfuse UI on `/observatory`.\n\n"
        "**PARAMS**: trace_id (required)."
    ),
    input_schema={
        "type": "object",
        "properties": {"trace_id": {"type": "string", "minLength": 1}},
        "required": ["trace_id"],
        "additionalProperties": False,
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)


OBSERVATORY_GET_STATUS_TOOL = Tool(
    id="allhands.meta.observatory.get_status",
    kind=ToolKind.META,
    name="observatory.get_status",
    description=(
        "Return the observability flags currently in effect:\n"
        "- observability_enabled (always True · self-instrumented)\n"
        "- auto_title_enabled (LLM-summarised conversation titles)\n\n"
        "**WHEN TO USE**: Before answering 'is auto-title on' or 'are "
        "we tracing'. Self-instrumentation runs unconditionally so the "
        "answer to the latter is always yes; the field stays in the "
        "response for forward-compat.\n\n"
        "**WHEN NOT TO USE**: Broader 'is the platform healthy' questions "
        "— call cockpit.get_workspace_summary instead, which surfaces "
        "gateway / MCP / db / triggers component health alongside metrics.\n\n"
        "**PARAMS**: none."
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


ALL_OBSERVATORY_META_TOOLS = [
    OBSERVATORY_QUERY_TRACES_TOOL,
    OBSERVATORY_GET_TRACE_TOOL,
    OBSERVATORY_GET_STATUS_TOOL,
]
