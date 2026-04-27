"""Meta tools for the model-pricing overlay.

Pair with REST routes in ``api/routers/pricing.py`` (L01 Tool First parity).
The Lead Agent (or a dedicated ``price-curator`` employee) can use these to:
- audit the current prices visible to the cost estimator
- correct one when a provider changes their published price
- remove an override to fall back to the code seed

WRITE tools require confirmation — pricing affects every cost number on the
observatory page; we want a human in the loop unless the user explicitly
auto-approves the curator employee.
"""

from __future__ import annotations

from allhands.core import Tool, ToolKind, ToolScope

LIST_MODEL_PRICES_TOOL = Tool(
    id="allhands.meta.list_model_prices",
    kind=ToolKind.META,
    name="list_model_prices",
    description=(
        "List every per-model token price the platform knows about. Returns "
        "one row per model with input/output USD per 1M tokens, source "
        "('code' = built-in seed, 'db' = runtime overlay), and the citation "
        "URL + note when source is 'db'.\n\n"
        "**WHEN TO USE**: User asks 'what prices are we using', 'check the "
        "Anthropic prices', or before calling upsert_model_price so you "
        "know whether you're updating an override or creating one.\n\n"
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

UPSERT_MODEL_PRICE_TOOL = Tool(
    id="allhands.meta.upsert_model_price",
    kind=ToolKind.META,
    name="upsert_model_price",
    description=(
        "Create or update a per-model price override (DB row · wins over "
        "code seed). Provide the full ``model_ref`` (e.g. "
        "``openai/gpt-4o-mini``), USD per 1M tokens for input + output, and "
        "the ``source_url`` you read the price from (REQUIRED — drives the "
        "audit trail in the UI).\n\n"
        "**WHEN TO USE**: A provider changed their pricing and the seed is "
        "stale, or the model isn't in the seed at all. Pair with "
        "``web_search`` + ``fetch_url`` when curating from a public page.\n\n"
        "**PARAMS**: model_ref (string), input_per_million_usd (number), "
        "output_per_million_usd (number), source_url (string), "
        "note (string, optional)."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "model_ref": {"type": "string", "minLength": 1},
            "input_per_million_usd": {"type": "number", "minimum": 0},
            "output_per_million_usd": {"type": "number", "minimum": 0},
            "source_url": {
                "type": "string",
                "minLength": 1,
                "description": "Citation URL — provider's pricing page or PR.",
            },
            "note": {"type": "string"},
        },
        "required": [
            "model_ref",
            "input_per_million_usd",
            "output_per_million_usd",
            "source_url",
        ],
    },
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=True,
)

DELETE_MODEL_PRICE_OVERRIDE_TOOL = Tool(
    id="allhands.meta.delete_model_price_override",
    kind=ToolKind.META,
    name="delete_model_price_override",
    description=(
        "Remove a DB-overlay row for ``model_ref``. After deletion the cost "
        "estimator falls back to the code seed (or 0 if no seed exists).\n\n"
        "**WHEN TO USE**: Override turned out to be wrong, or the seed value "
        "matches the upstream page again and the override is no longer "
        "needed. Read with list_model_prices first to confirm a DB row "
        "exists — deleting a non-existent override is a no-op.\n\n"
        "**PARAMS**: model_ref (string)."
    ),
    input_schema={
        "type": "object",
        "properties": {"model_ref": {"type": "string", "minLength": 1}},
        "required": ["model_ref"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=True,
)


ALL_PRICING_META_TOOLS: list[Tool] = [
    LIST_MODEL_PRICES_TOOL,
    UPSERT_MODEL_PRICE_TOOL,
    DELETE_MODEL_PRICE_OVERRIDE_TOOL,
]
