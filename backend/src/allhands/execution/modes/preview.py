"""Preset type + expansion algorithm (contract §4.2)."""

from __future__ import annotations

from pydantic import BaseModel, Field


class Preset(BaseModel):
    """A UI/contract-layer recipe that expands into existing Employee columns.

    Presets are **never** persisted (red line §3.2). They only exist in the
    API DTO + service expansion path + frontend form-default logic.
    """

    id: str
    friendly_name_zh: str
    tool_ids_base: list[str] = Field(default_factory=list)
    skill_ids_whitelist: list[str] = Field(default_factory=list)
    max_iterations: int = Field(ge=1, le=10000)


class PresetPreview(BaseModel):
    """Output of the expansion algorithm — exactly the 3 persisted columns."""

    tool_ids: list[str]
    skill_ids: list[str]
    max_iterations: int


def _dedupe(ids: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for x in ids:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def compose_preview(
    preset: Preset,
    *,
    custom_tool_ids: list[str] | None = None,
    custom_skill_ids: list[str] | None = None,
    custom_max_iterations: int | None = None,
) -> PresetPreview:
    """Apply contract §4.2 to a preset + user overrides.

    - tool_ids: preset base ALWAYS on; custom list appended (dedup preserved).
    - skill_ids: user's explicit list replaces the whitelist; absent → whitelist.
    - max_iterations: user's value wins; absent → preset default.
    """
    tool_ids = _dedupe([*preset.tool_ids_base, *(custom_tool_ids or [])])
    skill_ids = (
        _dedupe(list(custom_skill_ids))
        if custom_skill_ids is not None
        else list(preset.skill_ids_whitelist)
    )
    max_iterations = (
        custom_max_iterations if custom_max_iterations is not None else preset.max_iterations
    )
    return PresetPreview(tool_ids=tool_ids, skill_ids=skill_ids, max_iterations=max_iterations)
