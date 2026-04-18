"""Artifact domain (L4) — long-lived agent-produced products.

See `docs/specs/agent-design/2026-04-18-artifacts-skill.md` for full scope.

Artifacts are content with independent identity: a user can come back next week,
find the report by id, edit it, download it, share it. They live separately
from conversation messages — multiple conversations can reference the same
artifact.

Each update bumps `version` and spawns an `ArtifactVersion` row carrying the
historical content. Soft-delete via `deleted_at`; hard delete is not a v0
feature (see spec § 10).

TEXT_KINDS store content inline in `content`; BINARY_KINDS store on disk via
`file_path` (relative to `backend/data/artifacts/`). The distinction is
load-bearing — DB blobs for text keep diff rendering cheap; on-disk binary
keeps rows small and streams well.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class ArtifactKind(StrEnum):
    MARKDOWN = "markdown"
    CODE = "code"
    HTML = "html"
    IMAGE = "image"
    DATA = "data"
    MERMAID = "mermaid"


TEXT_KINDS: frozenset[ArtifactKind] = frozenset(
    {
        ArtifactKind.MARKDOWN,
        ArtifactKind.CODE,
        ArtifactKind.HTML,
        ArtifactKind.DATA,
        ArtifactKind.MERMAID,
    }
)
BINARY_KINDS: frozenset[ArtifactKind] = frozenset({ArtifactKind.IMAGE})


class Artifact(BaseModel):
    id: str = Field(..., min_length=1)
    workspace_id: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1, max_length=256)
    kind: ArtifactKind
    mime_type: str = Field(..., min_length=1, max_length=128)
    content: str | None = None
    file_path: str | None = None
    size_bytes: int = Field(..., ge=0)
    version: int = Field(..., ge=1)
    pinned: bool = False
    deleted_at: datetime | None = None
    created_by_run_id: str | None = None
    created_by_employee_id: str | None = None
    conversation_id: str | None = None
    created_at: datetime
    updated_at: datetime
    extra_metadata: dict[str, object] = Field(default_factory=dict)

    model_config = {"frozen": True}


class ArtifactVersion(BaseModel):
    id: str = Field(..., min_length=1)
    artifact_id: str = Field(..., min_length=1)
    version: int = Field(..., ge=1)
    content: str | None = None
    file_path: str | None = None
    diff_from_prev: str | None = None
    created_at: datetime

    model_config = {"frozen": True}
