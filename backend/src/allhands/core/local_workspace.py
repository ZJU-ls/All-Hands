"""Local workspace · domain model.

A LocalWorkspace defines a directory on the host filesystem that the
``allhands.local-files`` skill is allowed to read / write / shell into.

Out-of-band note: paths must be **absolute, real, existing directories**.
The service layer is responsible for ``Path.resolve(strict=True)`` before
upsert so the stored ``root_path`` is canonical (no symlinks, no ``..``).
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints


class LocalWorkspace(BaseModel):
    id: str
    name: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    root_path: Annotated[str, StringConstraints(min_length=1, max_length=1024)]
    read_only: bool = False
    denied_globs: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
