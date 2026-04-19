"""Employee domain model - unified React Agent.

Invariants:
  1. (tool_ids union expanded skill_ids) must be non-empty (enforced at service layer,
     since skill expansion needs SkillRegistry).
  2. 1 <= max_iterations <= 100
  3. is_lead_agent=True is globally unique (DB constraint + L6 validator).
  4. is_lead_agent=True must include core Meta Tools (L5 validator).
  5. name is a human-facing display name: 1..64 chars, no leading/trailing
     whitespace, no control chars, not a reserved role keyword. CJK / emoji /
     spaces in the middle are fine — employees are addressed by humans.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, Field, field_validator

_RESERVED_ROLE_NAMES = frozenset({"system", "user", "tool", "assistant"})
_MAX_NAME_LEN = 64


def is_valid_employee_name(name: str) -> bool:
    """Display-name validator.

    Rules:
      - 1 <= len(name) <= 64
      - no leading/trailing whitespace
      - no ASCII control characters (0x00-0x1F, 0x7F)
      - not a reserved role keyword (system/user/tool/assistant, case-insensitive)
    """
    if not name or len(name) > _MAX_NAME_LEN:
        return False
    if name != name.strip():
        return False
    if any(ord(c) < 0x20 or ord(c) == 0x7F for c in name):
        return False
    return name.lower() not in _RESERVED_ROLE_NAMES


NameStr = Annotated[str, Field(min_length=1, max_length=_MAX_NAME_LEN)]


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
    def _name_shape(cls, v: str) -> str:
        if not is_valid_employee_name(v):
            msg = (
                "Employee name must be 1..64 chars, no leading/trailing whitespace, "
                "no control chars, and not a reserved role keyword."
            )
            raise ValueError(msg)
        return v

    def has_any_capability(self) -> bool:
        """True if any tools or skills are attached.
        Full 'non-empty after skill expansion' check is done at service layer."""
        return bool(self.tool_ids or self.skill_ids)
