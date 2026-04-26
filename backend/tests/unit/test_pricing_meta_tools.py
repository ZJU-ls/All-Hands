"""Pricing Meta Tools · L01 parity with REST router pricing.py."""

from __future__ import annotations

from allhands.core import ToolKind, ToolScope
from allhands.execution.tools.meta.pricing_tools import ALL_PRICING_META_TOOLS


def test_all_pricing_meta_tools_exported() -> None:
    ids = {t.id for t in ALL_PRICING_META_TOOLS}
    assert "allhands.meta.list_model_prices" in ids
    assert "allhands.meta.upsert_model_price" in ids
    assert "allhands.meta.delete_model_price_override" in ids


def test_pricing_meta_tools_kind_is_meta() -> None:
    for t in ALL_PRICING_META_TOOLS:
        assert t.kind == ToolKind.META, f"{t.id} kind must be META"


def test_write_scopes_require_confirmation() -> None:
    for t in ALL_PRICING_META_TOOLS:
        if t.scope in {ToolScope.WRITE, ToolScope.IRREVERSIBLE}:
            assert t.requires_confirmation is True, (
                f"{t.id} scope {t.scope} must set requires_confirmation=True"
            )


def test_upsert_requires_source_url() -> None:
    upsert = next(
        t for t in ALL_PRICING_META_TOOLS if t.id == "allhands.meta.upsert_model_price"
    )
    required = upsert.input_schema.get("required") or []
    assert "source_url" in required, (
        "source_url must be required — drives the audit trail and prevents "
        "the curator from setting a price without citing a primary source."
    )


def test_delete_requires_only_model_ref() -> None:
    delete = next(
        t
        for t in ALL_PRICING_META_TOOLS
        if t.id == "allhands.meta.delete_model_price_override"
    )
    required = delete.input_schema.get("required") or []
    assert required == ["model_ref"]
