"""Stock-assistant skill tools (spec 2026-04-19-stock-assistant.md § 4).

Six tool declarations that compose the market + channel + triggers primitives.
Executors are no-ops in the registry: the Lead Agent reads each tool's
description (and the skill's `prompts/guidance.md`) to learn how to orchestrate
``list_holdings`` / ``get_quote`` / ``get_news`` / ``send_notification`` into
the final briefing / journal / anomaly-explanation output.

The first three tools are v0-production quality (schema + prompt + test
coverage); the last three are v0 skeletons — declared with the right shape
so the agent can still call them, but they return the string "v0 placeholder"
until a future iteration fills in real logic.
"""

from __future__ import annotations

from allhands.core import Tool, ToolKind, ToolScope

GENERATE_BRIEFING_TOOL = Tool(
    id="allhands.stock.generate_briefing",
    kind=ToolKind.META,
    name="generate_briefing",
    description=(
        "Compose an opening-bell briefing in markdown. Pipeline: "
        "(1) call list_watched + list_holdings; "
        "(2) call get_quote_batch for the union of their symbols — pre-market "
        "where available, else last close; "
        "(3) call get_news(symbol=None, since=24h) for macro headlines + "
        "get_news(symbol=h.symbol, since=24h) per holding; "
        "(4) call get_announcements per holding over the last 7d; "
        "(5) synthesize markdown with sections: 'Overnight overseas' "
        "(placeholder v0), 'Today's earnings calendar' (placeholder v0), "
        "'Holdings watchlist', 'Headline digest'. "
        "Call send_notification(topic='stock.briefing.daily', payload={title, body: markdown, severity: info}) "
        "when complete."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "date": {"type": "string", "format": "date", "description": "Defaults to today."},
            "topic": {"type": "string", "default": "stock.briefing.daily"},
        },
    },
    output_schema={
        "type": "object",
        "properties": {
            "markdown": {"type": "string"},
            "topic": {"type": "string"},
            "symbols": {"type": "array", "items": {"type": "string"}},
        },
    },
    scope=ToolScope.READ,
    requires_confirmation=False,
)

EXPLAIN_ANOMALY_TOOL = Tool(
    id="allhands.stock.explain_anomaly",
    kind=ToolKind.META,
    name="explain_anomaly",
    description=(
        "Explain why a symbol moved. Pipeline: "
        "(1) call get_news(symbol, since=2h) and get_announcements(symbol, since=7d); "
        "(2) call get_quote + get_bars around the anomaly window; "
        "(3) look at sibling symbols in the same tag (best-effort v0: only "
        "when the user tagged watched symbols); "
        "(4) produce a <=200-character 'hypothesis' with bullet-point evidence. "
        "Never state a forecast; frame every claim as 'consistent with …' "
        "or 'explained by …'. Return structured payload so the caller can "
        "tack the agent answer onto the same conversation."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "symbol": {"type": "string"},
            "from_price": {"type": "number"},
            "to_price": {"type": "number"},
            "window_s": {"type": "integer"},
        },
        "required": ["symbol"],
    },
    output_schema={
        "type": "object",
        "properties": {
            "symbol": {"type": "string"},
            "hypothesis": {"type": "string"},
            "evidence": {"type": "array", "items": {"type": "string"}},
        },
    },
    scope=ToolScope.READ,
    requires_confirmation=False,
)

DAILY_JOURNAL_TOOL = Tool(
    id="allhands.stock.daily_journal",
    kind=ToolKind.META,
    name="daily_journal",
    description=(
        "Generate end-of-day journal. Pipeline: "
        "(1) read holdings + any user-supplied trade list for the date; "
        "(2) fetch 1d bar + news per symbol; "
        "(3) produce markdown sections: 'Trades today' (if any), 'Holdings "
        "P&L delta', 'Decision postmortem' (compare intent vs. outcome; "
        "frame as 'right call' / 'possibly wrong' with evidence). "
        "Send via send_notification(topic='stock.journal.daily')."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "date": {"type": "string", "format": "date"},
            "orders": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "symbol": {"type": "string"},
                        "side": {"type": "string", "enum": ["buy", "sell"]},
                        "quantity": {"type": "integer"},
                        "price": {"type": "number"},
                        "reason": {"type": "string"},
                    },
                },
            },
            "topic": {"type": "string", "default": "stock.journal.daily"},
        },
    },
    output_schema={
        "type": "object",
        "properties": {"markdown": {"type": "string"}, "topic": {"type": "string"}},
    },
    scope=ToolScope.READ,
    requires_confirmation=False,
)

PORTFOLIO_HEALTH_TOOL = Tool(
    id="allhands.stock.portfolio_health",
    kind=ToolKind.META,
    name="portfolio_health",
    description=(
        "v0 skeleton. Reads holdings, computes concentration (HHI), sector "
        "distribution (via watched tags), rough correlation with CSI 300 over "
        "the last 60 sessions, and maximum drawdown. Returns a markdown "
        "health report. If any computation is missing data it labels the "
        "section 'v0 placeholder'."
    ),
    input_schema={"type": "object", "properties": {}},
    output_schema={
        "type": "object",
        "properties": {
            "markdown": {"type": "string"},
            "hhi": {"type": "number"},
            "max_drawdown": {"type": "number"},
        },
    },
    scope=ToolScope.READ,
    requires_confirmation=False,
)

SANITY_CHECK_ORDER_TOOL = Tool(
    id="allhands.stock.sanity_check_order",
    kind=ToolKind.META,
    name="sanity_check_order",
    description=(
        "v0 skeleton. Given an intended order, return a 1-10 rationality "
        "score plus a one-sentence advice. Pipeline: (1) fetch today's "
        "change_pct + 7d trade frequency; (2) compare the intended action "
        "against the current holdings concentration; (3) call explain_anomaly "
        "for context; (4) agent composes rating + advice. Always recommends "
        "'pause and re-read evidence' when rating <= 4."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "symbol": {"type": "string"},
            "side": {"type": "string", "enum": ["buy", "sell"]},
            "quantity": {"type": "integer", "minimum": 1},
            "price": {"type": "number"},
            "reason": {"type": "string"},
        },
        "required": ["symbol", "side", "quantity"],
    },
    output_schema={
        "type": "object",
        "properties": {
            "rating": {"type": "integer"},
            "advice": {"type": "string"},
            "concerns": {"type": "array", "items": {"type": "string"}},
        },
    },
    scope=ToolScope.READ,
    requires_confirmation=False,
)

SCREEN_BY_LOGIC_TOOL = Tool(
    id="allhands.stock.screen_by_logic",
    kind=ToolKind.META,
    name="screen_by_logic",
    description=(
        "Parse a natural-language stock-picking rule (e.g. 'PE<20 and 30d "
        "avg turnover<3% and revenue yoy>15%') into a ScreenCriteria, then "
        "call screen_stocks. Return the matched list together with the "
        "structured criteria so the user can iterate. v0 parses numeric "
        "inequalities and tag lists; richer expression languages land in v1."
    ),
    input_schema={
        "type": "object",
        "properties": {"logic": {"type": "string"}},
        "required": ["logic"],
    },
    output_schema={
        "type": "object",
        "properties": {
            "matches": {"type": "array"},
            "criteria_parsed": {"type": "object"},
        },
    },
    scope=ToolScope.READ,
    requires_confirmation=False,
)


ALL_STOCK_ASSISTANT_TOOLS = [
    GENERATE_BRIEFING_TOOL,
    EXPLAIN_ANOMALY_TOOL,
    DAILY_JOURNAL_TOOL,
    PORTFOLIO_HEALTH_TOOL,
    SANITY_CHECK_ORDER_TOOL,
    SCREEN_BY_LOGIC_TOOL,
]


__all__ = ["ALL_STOCK_ASSISTANT_TOOLS"]
