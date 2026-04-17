"""Employee domain model - unified React Agent.

Invariants:
  1. (tool_ids union expanded skill_ids) must be non-empty (enforced at service layer,
     since skill expansion needs SkillRegistry).
  2. 1 <= max_iterations <= 100
  3. is_lead_agent=True is globally unique (DB constraint + L6 validator).
  4. is_lead_agent=True must include core Meta Tools (L5 validator).
  5. name matches /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints, field_validator

NameStr = Annotated[
    str,
    StringConstraints(pattern=r"^[A-Za-z][A-Za-z0-9_-]{0,63}$"),
]


class Employee(BaseModel):
    id: str
    name: NameStr
    description: str
    system_prompt: str = Field(..., min_length=1, max_length=20000)
    model_ref: str
    tool_ids: list[str] = Field(default_factory=list)
    skill_ids: list[str] = Field(default_factory=list)
    max_iterations: int = Field(default=10, ge=1, le=100)
    is_lead_agent: bool = False
    created_by: str
    created_at: datetime
    metadata: dict[str, object] = Field(default_factory=dict)

    @field_validator("name")
    @classmethod
    def _name_not_reserved(cls, v: str) -> str:
        if v.lower() in {"system", "user", "tool", "assistant"}:
            msg = "Employee name cannot be a reserved role keyword."
            raise ValueError(msg)
        return v

    def has_any_capability(self) -> bool:
        """True if any tools or skills are attached.
        Full 'non-empty after skill expansion' check is done at service layer."""
        return bool(self.tool_ids or self.skill_ids)


_NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,63}$")
"""Exposed so service/repository layers can validate names before construction."""


def is_valid_employee_name(name: str) -> bool:
    return bool(_NAME_RE.match(name))
