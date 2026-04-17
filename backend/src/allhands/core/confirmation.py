"""Confirmation domain model - the L4 guardrail gate."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel


class ConfirmationStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    EXPIRED = "expired"


class Confirmation(BaseModel):
    id: str
    tool_call_id: str
    rationale: str
    summary: str
    diff: dict[str, object] | None = None
    status: ConfirmationStatus
    created_at: datetime
    resolved_at: datetime | None = None
    expires_at: datetime
