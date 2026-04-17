"""API protocol schemas. Kept in sync with web/lib/protocol.ts."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel


class CreateConversationRequest(BaseModel):
    employee_id: str


class ConversationResponse(BaseModel):
    id: str
    employee_id: str
    title: str | None = None
    created_at: str


class SendMessageRequest(BaseModel):
    content: str


class ConfirmationDecisionRequest(BaseModel):
    decision: Literal["approve", "reject"]


class ConfirmationResponse(BaseModel):
    id: str
    tool_call_id: str
    summary: str
    rationale: str
    diff: dict[str, Any] | None = None
    status: str
    created_at: str
    expires_at: str


class ErrorResponse(BaseModel):
    code: str
    message: str
