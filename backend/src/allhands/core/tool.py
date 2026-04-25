"""Tool domain model.

Tools are the universal unit of capability. Three kinds:
  - BACKEND: side-effecting (DB, external API, file)
  - RENDER:  UI-instructing ({component, props})
  - META:    platform-reflexive (Lead Agent uses these to manage the platform)

All tools share the same schema and registration mechanism.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field


class ToolKind(StrEnum):
    BACKEND = "backend"
    RENDER = "render"
    META = "meta"


class ToolScope(StrEnum):
    READ = "read"
    WRITE = "write"
    IRREVERSIBLE = "irreversible"
    BOOTSTRAP = "bootstrap"


class CostHint(BaseModel):
    relative: Literal["low", "medium", "high"] = "low"
    note: str | None = None


class Tool(BaseModel):
    """The domain representation of a Tool. Executor is NOT bound here;
    L5 ToolRegistry maps (tool.id -> executor)."""

    id: str = Field(
        ..., min_length=1, description="Stable registry key, e.g. 'allhands.core.create_employee'"
    )
    kind: ToolKind
    name: str = Field(..., min_length=1)
    description: str = Field(..., min_length=1)
    input_schema: dict[str, object]
    output_schema: dict[str, object]
    scope: ToolScope
    requires_confirmation: bool = False
    requires_user_input: bool = False
    cost_hint: CostHint | None = None

    model_config = {"frozen": True}
