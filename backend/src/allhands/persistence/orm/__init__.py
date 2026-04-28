"""SQLAlchemy ORM models. Kept flat + thin; mapping-only, no business logic."""

from allhands.persistence.orm import (
    channels_orm as _channels_orm,  # noqa: F401  single-line register: Wave 2 notification-channels tables
)
from allhands.persistence.orm import (
    knowledge_orm as _knowledge_orm,  # noqa: F401  single-line register: KB tables
)
from allhands.persistence.orm import (
    market_orm as _market_orm,  # noqa: F401  single-line register: Wave 2 market-data tables
)
from allhands.persistence.orm.base import Base
from allhands.persistence.orm.models import (
    AttachmentRow,
    ConfirmationRow,
    ConversationRow,
    EmployeeRow,
    LocalWorkspaceRow,
    MCPServerRow,
    MessageRow,
    SkillRow,
    ToolCallRow,
)

__all__ = [
    "AttachmentRow",
    "Base",
    "ConfirmationRow",
    "ConversationRow",
    "EmployeeRow",
    "LocalWorkspaceRow",
    "MCPServerRow",
    "MessageRow",
    "SkillRow",
    "ToolCallRow",
]
