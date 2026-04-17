"""Skill domain model - a bundle of tools + optional prompt fragment."""

from __future__ import annotations

from pydantic import BaseModel, Field


class Skill(BaseModel):
    id: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    description: str
    tool_ids: list[str] = Field(default_factory=list)
    prompt_fragment: str | None = None
    version: str = Field(..., description="semver")

    model_config = {"frozen": True}
