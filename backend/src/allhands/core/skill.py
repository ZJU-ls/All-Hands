"""Skill domain model — a bundle of tools + optional prompt fragment.

A Skill is installed from one of four sources:

- BUILTIN: shipped with allhands at dev time, bootstrapped via seed_skills()
- GITHUB:  cloned from a public GitHub repo at install time
- MARKET:  installed via curated marketplace (resolves to a GitHub URL)
- LOCAL:   user-uploaded .zip extracted into data/skills/<slug>/
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class SkillSource(StrEnum):
    BUILTIN = "builtin"
    GITHUB = "github"
    MARKET = "market"
    LOCAL = "local"


class Skill(BaseModel):
    id: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    description: str
    tool_ids: list[str] = Field(default_factory=list)
    prompt_fragment: str | None = None
    version: str = Field(..., description="semver")

    source: SkillSource = SkillSource.BUILTIN
    source_url: str | None = None
    installed_at: datetime | None = None
    path: str | None = None

    model_config = {"frozen": True}
