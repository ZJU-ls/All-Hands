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
    MaxDispatchDepthExceeded,
    MaxIterationsReached,
    MCPHandshakeFailed,
    SubRunFailed,
    ToolNotFound,
)
from allhands.core.mcp import MCPHealth, MCPServer, MCPTransport
from allhands.core.model import LLMModel
from allhands.core.plan import AgentPlan, PlanStep, StepStatus
from allhands.core.provider import LLMProvider
from allhands.core.skill import Skill, SkillSource
from allhands.core.tool import CostHint, Tool, ToolKind, ToolScope
from allhands.core.trigger import (
    DEFAULT_MIN_INTERVAL_SECONDS,
    MIN_INTERVAL_SECONDS,
    EventEnvelope,
    EventPattern,
    TimerSpec,
    Trigger,
    TriggerAction,
    TriggerActionType,
    TriggerFire,
    TriggerFireSource,
    TriggerFireStatus,
    TriggerKind,
)

__all__ = [
    "DEFAULT_MIN_INTERVAL_SECONDS",
    "MIN_INTERVAL_SECONDS",
    "AgentPlan",
    "Confirmation",
    "ConfirmationExpired",
    "ConfirmationRejected",
    "ConfirmationStatus",
    "Conversation",
    "CostHint",
    "DomainError",
    "Employee",
    "EmployeeNotFound",
    "EventEnvelope",
    "EventPattern",
    "InteractionSpec",
    "InvariantViolation",
    "LLMModel",
    "LLMProvider",
    "MCPHandshakeFailed",
    "MCPHealth",
    "MCPServer",
    "MCPTransport",
    "MaxDispatchDepthExceeded",
    "MaxIterationsReached",
    "Message",
    "MessageRole",
    "PlanStep",
    "RenderPayload",
    "Skill",
    "SkillSource",
    "StepStatus",
    "SubRunFailed",
    "TimerSpec",
    "Tool",
    "ToolCall",
    "ToolCallStatus",
    "ToolKind",
    "ToolNotFound",
    "ToolScope",
    "Trigger",
    "TriggerAction",
    "TriggerActionType",
    "TriggerFire",
    "TriggerFireSource",
    "TriggerFireStatus",
    "TriggerKind",
]
