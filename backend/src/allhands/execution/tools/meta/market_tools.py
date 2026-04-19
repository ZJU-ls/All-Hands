"""Market Meta Tools — spec § 7.

Mirror the REST router one-to-one. Most are READ (quotes / bars / news /
search / screen). Writes are watched / holdings CRUD + poller thresholds.
Holdings CRUD + CSV import go through ConfirmationGate; watched list add is
auto-approved because it has no downstream safety impact.
"""

from __future__ import annotations

from allhands.core import Tool, ToolKind, ToolScope

GET_QUOTE_TOOL = Tool(
    id="allhands.meta.get_quote",
    kind=ToolKind.META,
    name="get_quote",
    description=(
        "Fetch the live quote for a single symbol (SSE:600519 / SZSE:000001 "
        "format). Returns last, change, change_pct, open/high/low, volume, ts."
    ),
    input_schema={
        "type": "object",
        "properties": {"symbol": {"type": "string"}},
        "required": ["symbol"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)

GET_QUOTE_BATCH_TOOL = Tool(
    id="allhands.meta.get_quote_batch",
    kind=ToolKind.META,
    name="get_quote_batch",
    description="Fetch live quotes for up to 50 symbols at once.",
    input_schema={
        "type": "object",
        "properties": {
            "symbols": {
                "type": "array",
                "items": {"type": "string"},
                "maxItems": 50,
            },
        },
        "required": ["symbols"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)

GET_BARS_TOOL = Tool(
    id="allhands.meta.get_bars",
    kind=ToolKind.META,
    name="get_bars",
    description=(
        "Fetch OHLCV bars. interval ∈ {1m,5m,15m,30m,1h,1d}. Dates default "
        "to last 30 days. Cached in market_snapshots per (symbol,interval,ts)."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "symbol": {"type": "string"},
            "interval": {
                "type": "string",
                "enum": ["1m", "5m", "15m", "30m", "1h", "1d"],
            },
            "start": {"type": "string", "format": "date-time"},
            "end": {"type": "string", "format": "date-time"},
        },
        "required": ["symbol", "interval"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)

GET_NEWS_TOOL = Tool(
    id="allhands.meta.get_news",
    kind=ToolKind.META,
    name="get_news",
    description=(
        "Fetch recent news items. Omit `symbol` for market-wide headlines. "
        "`since` defaults to last 24h. Cached by (symbol,date) for 1 day."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "symbol": {"type": "string"},
            "since": {"type": "string", "format": "date-time"},
            "limit": {"type": "integer", "minimum": 1, "maximum": 200, "default": 50},
        },
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)

GET_ANNOUNCEMENTS_TOOL = Tool(
    id="allhands.meta.get_announcements",
    kind=ToolKind.META,
    name="get_announcements",
    description=(
        "Fetch recent regulatory announcements for a symbol. Kinds: 财报/分红/重大事项/停复牌/其他."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "symbol": {"type": "string"},
            "since": {"type": "string", "format": "date-time"},
            "limit": {"type": "integer", "minimum": 1, "maximum": 200, "default": 50},
        },
        "required": ["symbol"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)

SEARCH_SYMBOL_TOOL = Tool(
    id="allhands.meta.search_symbol",
    kind=ToolKind.META,
    name="search_symbol",
    description="Search A-share symbols by code or name (partial match).",
    input_schema={
        "type": "object",
        "properties": {
            "query": {"type": "string"},
            "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 10},
        },
        "required": ["query"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)

SCREEN_STOCKS_TOOL = Tool(
    id="allhands.meta.screen_stocks",
    kind=ToolKind.META,
    name="screen_stocks",
    description=(
        "Run a stock screen. v0 accepts partial criteria (pe_lt/pe_gt/pb_lt/"
        "turnover_mean_lt/revenue_yoy_gt/tags). Providers narrow to what they "
        "support and fall through on NotSupported."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "pe_lt": {"type": "number"},
            "pe_gt": {"type": "number"},
            "pb_lt": {"type": "number"},
            "turnover_mean_lt": {"type": "number"},
            "revenue_yoy_gt": {"type": "number"},
            "tags": {"type": "array", "items": {"type": "string"}},
            "limit": {"type": "integer", "minimum": 1, "maximum": 500, "default": 50},
        },
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)

LIST_WATCHED_TOOL = Tool(
    id="allhands.meta.list_watched",
    kind=ToolKind.META,
    name="list_watched",
    description="List all symbols on the watchlist (not positions — see list_holdings).",
    input_schema={"type": "object", "properties": {}},
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)

ADD_WATCHED_TOOL = Tool(
    id="allhands.meta.add_watched",
    kind=ToolKind.META,
    name="add_watched",
    description="Add a symbol to the watchlist. Auto-approved (read-only side effect).",
    input_schema={
        "type": "object",
        "properties": {
            "symbol": {"type": "string"},
            "name": {"type": "string"},
            "tag": {"type": "string"},
        },
        "required": ["symbol", "name"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=False,
)

REMOVE_WATCHED_TOOL = Tool(
    id="allhands.meta.remove_watched",
    kind=ToolKind.META,
    name="remove_watched",
    description="Remove a symbol from the watchlist.",
    input_schema={
        "type": "object",
        "properties": {"symbol": {"type": "string"}},
        "required": ["symbol"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=False,
)

LIST_HOLDINGS_TOOL = Tool(
    id="allhands.meta.list_holdings",
    kind=ToolKind.META,
    name="list_holdings",
    description="List every held position (symbol, quantity, avg_cost, opened_at).",
    input_schema={"type": "object", "properties": {}},
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)

ADD_HOLDING_TOOL = Tool(
    id="allhands.meta.add_holding",
    kind=ToolKind.META,
    name="add_holding",
    description=(
        "Record a new position. Requires user confirmation — positions drive "
        "P&L calc and anomaly severity, so a typo can mis-route an alert."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "symbol": {"type": "string"},
            "name": {"type": "string"},
            "quantity": {"type": "integer", "minimum": 0},
            "avg_cost": {"type": "number"},
            "opened_at": {"type": "string", "format": "date-time"},
            "notes": {"type": "string"},
        },
        "required": ["symbol", "name", "quantity", "avg_cost"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=True,
)

UPDATE_HOLDING_TOOL = Tool(
    id="allhands.meta.update_holding",
    kind=ToolKind.META,
    name="update_holding",
    description="Update an existing holding's quantity / avg_cost / notes.",
    input_schema={
        "type": "object",
        "properties": {
            "symbol": {"type": "string"},
            "quantity": {"type": "integer", "minimum": 0},
            "avg_cost": {"type": "number"},
            "notes": {"type": "string"},
        },
        "required": ["symbol"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=True,
)

REMOVE_HOLDING_TOOL = Tool(
    id="allhands.meta.remove_holding",
    kind=ToolKind.META,
    name="remove_holding",
    description="Delete a holding row. IRREVERSIBLE — the historical P&L trail is gone.",
    input_schema={
        "type": "object",
        "properties": {"symbol": {"type": "string"}},
        "required": ["symbol"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.IRREVERSIBLE,
    requires_confirmation=True,
)

IMPORT_HOLDINGS_CSV_TOOL = Tool(
    id="allhands.meta.import_holdings_csv",
    kind=ToolKind.META,
    name="import_holdings_csv",
    description=(
        "Replace the holdings list from a CSV (columns: symbol,name,quantity,"
        "avg_cost[,opened_at,notes]). Existing holdings are wiped — confirm "
        "carefully."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "csv_content": {"type": "string", "description": "Full CSV text"},
        },
        "required": ["csv_content"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=True,
)

SET_POLLER_THRESHOLDS_TOOL = Tool(
    id="allhands.meta.set_poller_thresholds",
    kind=ToolKind.META,
    name="set_poller_thresholds",
    description=(
        "Override the anomaly thresholds used by market-ticker-poller — "
        "sudden_spike_pct / sudden_drop_pct / crash_pct / limit_up_pct / "
        "volume_spike_sigma / window_seconds."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "sudden_spike_pct": {"type": "number"},
            "sudden_drop_pct": {"type": "number"},
            "crash_pct": {"type": "number"},
            "limit_up_pct": {"type": "number"},
            "volume_spike_sigma": {"type": "number"},
            "window_seconds": {"type": "integer", "minimum": 5},
        },
    },
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=True,
)


ALL_MARKET_META_TOOLS = [
    GET_QUOTE_TOOL,
    GET_QUOTE_BATCH_TOOL,
    GET_BARS_TOOL,
    GET_NEWS_TOOL,
    GET_ANNOUNCEMENTS_TOOL,
    SEARCH_SYMBOL_TOOL,
    SCREEN_STOCKS_TOOL,
    LIST_WATCHED_TOOL,
    ADD_WATCHED_TOOL,
    REMOVE_WATCHED_TOOL,
    LIST_HOLDINGS_TOOL,
    ADD_HOLDING_TOOL,
    UPDATE_HOLDING_TOOL,
    REMOVE_HOLDING_TOOL,
    IMPORT_HOLDINGS_CSV_TOOL,
    SET_POLLER_THRESHOLDS_TOOL,
]


__all__ = ["ALL_MARKET_META_TOOLS"]
