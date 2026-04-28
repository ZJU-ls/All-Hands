"""Attachment REST endpoints — chat-message uploads.

POST   /api/attachments              multipart upload, dedup by sha256
GET    /api/attachments/{id}         metadata
GET    /api/attachments/{id}/content raw bytes (Content-Disposition: inline)
GET    /api/attachments/{id}/thumbnail   image thumbnail (server-cached)
DELETE /api/attachments/{id}         remove (file kept for now; GC later)
"""

from __future__ import annotations

import io
from pathlib import Path
from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import (
    AsyncSession,  # noqa: TC002 — runtime-needed for FastAPI Depends
)

from allhands.api.deps import get_session
from allhands.config import get_settings
from allhands.i18n import t
from allhands.persistence.sql_repos import SqlAttachmentRepo
from allhands.services.attachment_service import (
    AttachmentService,
    AttachmentServiceError,
)

if TYPE_CHECKING:
    from allhands.core import Attachment

router = APIRouter(prefix="/attachments", tags=["attachments"])


class AttachmentResponse(BaseModel):
    id: str
    sha256: str
    mime: str
    filename: str
    size_bytes: int
    width: int | None
    height: int | None
    conversation_id: str | None
    kind: str
    created_at: str


def _to_response(att: Attachment) -> AttachmentResponse:
    return AttachmentResponse(
        id=att.id,
        sha256=att.sha256,
        mime=att.mime,
        filename=att.filename,
        size_bytes=att.size_bytes,
        width=att.width,
        height=att.height,
        conversation_id=att.conversation_id,
        kind=att.kind.value,
        created_at=att.created_at.isoformat(),
    )


def _service(session: AsyncSession) -> AttachmentService:
    settings = get_settings()
    storage_root = Path(settings.data_dir) / "attachments"
    return AttachmentService(repo=SqlAttachmentRepo(session), storage_root=storage_root)


@router.post("", response_model=AttachmentResponse, status_code=201)
async def upload(
    file: UploadFile = File(...),
    conversation_id: str | None = Form(None),
    session: AsyncSession = Depends(get_session),
) -> AttachmentResponse:
    data = await file.read()
    try:
        att = await _service(session).upload(
            data=data,
            filename=file.filename or "upload.bin",
            mime=file.content_type,
            conversation_id=conversation_id,
        )
    except AttachmentServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _to_response(att)


@router.get("/{attachment_id}", response_model=AttachmentResponse)
async def get_attachment(
    attachment_id: str,
    session: AsyncSession = Depends(get_session),
) -> AttachmentResponse:
    svc = _service(session)
    att = await svc.get(attachment_id)
    if att is None:
        raise HTTPException(status_code=404, detail=t("errors.not_found.attachment"))
    return _to_response(att)


@router.get("/{attachment_id}/content")
async def get_content(
    attachment_id: str,
    session: AsyncSession = Depends(get_session),
) -> Response:
    svc = _service(session)
    att = await svc.get(attachment_id)
    if att is None:
        raise HTTPException(status_code=404, detail=t("errors.not_found.attachment"))
    try:
        body = svc.read_bytes(att)
    except OSError as exc:
        raise HTTPException(
            status_code=500, detail=t("errors.attachment.read_failed", detail=str(exc))
        ) from exc
    return Response(
        content=body,
        media_type=att.mime,
        headers={"Content-Disposition": f'inline; filename="{att.filename}"'},
    )


@router.get("/{attachment_id}/thumbnail")
async def get_thumbnail(
    attachment_id: str,
    size: int = 512,
    session: AsyncSession = Depends(get_session),
) -> Response:
    """Generate a webp thumbnail on the fly. For non-image attachments,
    returns 404. Server-side caching could be added later — for now we
    regenerate per request (cheap for chat use)."""
    svc = _service(session)
    att = await svc.get(attachment_id)
    if att is None:
        raise HTTPException(status_code=404, detail=t("errors.not_found.attachment"))
    if not att.mime.startswith("image/"):
        raise HTTPException(status_code=400, detail=t("errors.attachment.not_image"))
    try:
        from PIL import Image
    except ImportError as exc:
        raise HTTPException(status_code=500, detail=t("errors.attachment.pil_unavailable")) from exc
    try:
        body = svc.read_bytes(att)
    except OSError as exc:
        raise HTTPException(
            status_code=500, detail=t("errors.attachment.read_failed", detail=str(exc))
        ) from exc
    img = Image.open(io.BytesIO(body))
    img.thumbnail((size, size))
    out = io.BytesIO()
    # Convert to RGB for JPEG-safe output if needed
    save_format = "WEBP"
    try:
        img.save(out, format=save_format, quality=82)
    except (OSError, ValueError):
        rgb = img.convert("RGB")
        rgb.save(out, format=save_format, quality=82)
    return Response(content=out.getvalue(), media_type="image/webp")


@router.delete("/{attachment_id}", status_code=204)
async def delete_attachment(
    attachment_id: str,
    session: AsyncSession = Depends(get_session),
) -> None:
    await _service(session).delete(attachment_id)
