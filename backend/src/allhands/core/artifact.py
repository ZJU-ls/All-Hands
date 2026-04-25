"""Artifact domain (L4) — long-lived agent-produced products.

See `docs/specs/agent-design/2026-04-18-artifacts-skill.md` for full scope.

Artifacts are content with independent identity: a user can come back next week,
find the report by id, edit it, download it, share it. They live separately
from conversation messages — multiple conversations can reference the same
artifact.

Each update bumps `version` and spawns an `ArtifactVersion` row carrying the
historical file_path so history is addressable by version number.

**2026-04-25 storage refactor:** all kinds (text + binary) now live on disk
under ``backend/data/artifacts/<workspace>/<artifact_id>/v<N>.<ext>``;
the DB row only carries metadata + ``file_path``.

**2026-04-25 v2 schema (Git-style):** richer metadata to support cross-conv /
cross-employee browsing, tagging, audit. New fields default-safe so old rows
project as-is — no backfill migration needed.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field


class ArtifactKind(StrEnum):
    MARKDOWN = "markdown"
    CODE = "code"
    HTML = "html"
    IMAGE = "image"
    DATA = "data"
    MERMAID = "mermaid"
    # 2026-04-25 · drawio diagrams · embedded via diagrams.net iframe.
    # Stored as XML (.drawio extension, application/vnd.jgraph.mxfile mime).
    DRAWIO = "drawio"


# Retained for backward-compat with callers that still branch on "is this
# rendered as text or binary upstream"; storage no longer uses these splits.
# DRAWIO is a TEXT kind (XML body); the renderer happens to embed an iframe.
TEXT_KINDS: frozenset[ArtifactKind] = frozenset(
    {
        ArtifactKind.MARKDOWN,
        ArtifactKind.CODE,
        ArtifactKind.HTML,
        ArtifactKind.DATA,
        ArtifactKind.MERMAID,
        ArtifactKind.DRAWIO,
    }
)
BINARY_KINDS: frozenset[ArtifactKind] = frozenset({ArtifactKind.IMAGE})


ArtifactStatus = Literal["draft", "published", "archived"]


class Artifact(BaseModel):
    id: str = Field(..., min_length=1)
    workspace_id: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1, max_length=256)
    kind: ArtifactKind
    mime_type: str = Field(..., min_length=1, max_length=128)
    # All artifacts now reference a file under data/artifacts/. NOT NULL.
    file_path: str = Field(..., min_length=1, max_length=512)
    size_bytes: int = Field(..., ge=0)
    version: int = Field(..., ge=1)
    pinned: bool = False
    deleted_at: datetime | None = None
    # Provenance — who / where / when this came from. All nullable so
    # legacy rows (or hand-uploaded artifacts) project gracefully.
    created_by_run_id: str | None = None
    created_by_employee_id: str | None = None
    conversation_id: str | None = None
    created_at: datetime
    updated_at: datetime

    # ------- v2 metadata (2026-04-25 · Git-style extensibility) -------
    # User-facing summary one-liner shown in lists. Optional · auto-fill
    # via LLM in P2 future.
    description: str | None = None
    # LLM-generated longer summary. Filled lazily (P2).
    summary: str | None = None
    # Free-form tags · UI filter chip. JSON list of lowercase strings.
    tags: list[str] = Field(default_factory=list)
    # Structured key:value labels (e.g. ``{"project": "design", "stage": "v0"}``).
    # Lets future workflows attach scoped metadata without schema changes.
    labels: dict[str, str] = Field(default_factory=dict)
    # Lifecycle. ``draft`` (in progress) → ``published`` (canonical) →
    # ``archived`` (kept for history but hidden from default lists).
    status: ArtifactStatus = "published"
    # Last user / agent open · for "recently accessed" sort + activity decay.
    last_accessed_at: datetime | None = None
    # Counters (cheap to maintain, expensive to derive). Safe-by-default 0.
    view_count: int = 0
    edit_count: int = 0

    extra_metadata: dict[str, object] = Field(default_factory=dict)

    model_config = {"frozen": True}


class ArtifactVersion(BaseModel):
    id: str = Field(..., min_length=1)
    artifact_id: str = Field(..., min_length=1)
    version: int = Field(..., ge=1)
    file_path: str = Field(..., min_length=1, max_length=512)
    diff_from_prev: str | None = None
    created_at: datetime

    # ------- v2 metadata -------
    # "Commit message" — why this version was created. Filled by:
    #   - artifact_create: "initial"
    #   - artifact_update: caller may pass; otherwise "(no message)"
    #   - rollback: "回退到 v{N}"
    # Optional / nullable so legacy rows project as-is.
    change_message: str | None = None
    # The version this one was forked from. Set when rollback creates a
    # new version (parent_version = source we copied content from).
    # NULL for normal incremental updates and the initial v1.
    parent_version: int | None = None
    # Provenance. Mirrors Artifact.created_by_* but per-version, so the
    # audit trail can answer "who edited v3 specifically".
    created_by_run_id: str | None = None
    created_by_employee_id: str | None = None
    # User-driven edits go through PATCH /artifacts/{id}; we don't have
    # a logged-in user model yet, so this stays None until auth lands.
    created_by_user: str | None = None
    # Snapshot of size at write time (audit signal for "diff weight").
    size_bytes: int = 0

    model_config = {"frozen": True}
