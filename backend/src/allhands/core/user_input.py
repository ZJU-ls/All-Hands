"""UserInput domain model · ADR 0019 C3 · clarification flow."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class UserInputStatus(StrEnum):
    PENDING = "pending"
    ANSWERED = "answered"
    EXPIRED = "expired"


class UserInputQuestion(BaseModel):
    label: str = Field(..., min_length=1)
    description: str
    preview: str | None = None


class UserInput(BaseModel):
    id: str
    tool_call_id: str
    questions: list[UserInputQuestion]
    answers: dict[str, str] = Field(default_factory=dict)
    status: UserInputStatus = UserInputStatus.PENDING
    created_at: datetime
    expires_at: datetime
