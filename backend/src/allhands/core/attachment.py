"""Attachment · domain model.

User-uploaded file (image / pdf / doc / etc.) referenced by a chat message
via ImageBlock or FileBlock. Stored content-addressed on disk under
``data/attachments/<sha256[:2]>/<sha256>.<ext>`` so duplicate uploads
collapse to one row + one file.

Distinct from Artifact (agent-produced output): Artifact has versions /
provenance / pin / appears in /artifacts; Attachment is just incoming bytes,
no version chain, no /artifacts listing.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class AttachmentKind(StrEnum):
    IMAGE = "image"
    FILE = "file"


class Attachment(BaseModel):
    id: str
    sha256: str = Field(..., min_length=64, max_length=64)
    mime: str
    filename: str
    size_bytes: int = Field(..., ge=0)
    storage_path: str
    width: int | None = None  # images only
    height: int | None = None
    conversation_id: str | None = None
    uploaded_by: str = "user"
    extracted_text: str | None = None  # pdf/docx/etc. text projection
    extracted_at: datetime | None = None
    created_at: datetime

    @property
    def kind(self) -> AttachmentKind:
        return AttachmentKind.IMAGE if self.mime.startswith("image/") else AttachmentKind.FILE
