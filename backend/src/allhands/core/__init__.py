"""Core domain models (L4).

This package depends only on pydantic + stdlib. Never import frameworks here.
See product/04-architecture.md for full specifications.
"""

from allhands.core.confirmation import Confirmation, ConfirmationStatus
from allhands.core.conversation import (
    Conversation,
    InteractionSpec,
    Message,
    MessageRole,
    RenderPayload,
    ToolCall,
    ToolCallStatus,
)
from allhands.core.employee import Employee
from allhands.core.errors import (
    ConfirmationExpired,
    ConfirmationRejected,
    DomainError,
    EmployeeNotFound,
    InvariantViolation,
    MaxIterationsReached,
    MCPHandshakeFailed,
    ToolNotFound,
)
from allhands.core.mcp import MCPHealth, MCPServer, MCPTransport
from allhands.core.provider import LLMProvider
from allhands.core.skill import Skill
from allhands.core.tool import CostHint, Tool, ToolKind, ToolScope

__all__ = [
    "Confirmation",
    "ConfirmationExpired",
    "ConfirmationRejected",
    "ConfirmationStatus",
    "Conversation",
    "CostHint",
    "DomainError",
    "Employee",
    "EmployeeNotFound",
    "InteractionSpec",
    "InvariantViolation",
    "LLMProvider",
    "MCPHandshakeFailed",
    "MCPHealth",
    "MCPServer",
    "MCPTransport",
    "MaxIterationsReached",
    "Message",
    "MessageRole",
    "RenderPayload",
    "Skill",
    "Tool",
    "ToolCall",
    "ToolCallStatus",
    "ToolKind",
    "ToolNotFound",
    "ToolScope",
]
