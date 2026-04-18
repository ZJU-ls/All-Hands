"""Read-only artifact endpoints.

Per spec `docs/specs/agent-design/2026-04-18-artifacts-skill.md` § 5, write
operations are agent-managed and live in `execution/tools/meta/artifact_tools.py`;
the REST surface only exposes browsing + content fetching for the UI panel.
This keeps the L01 Tool First contract intact: no REST write endpoints for
agent-managed resources.
"""

from __future__ import annotations

import base64

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel

from allhands.api.deps import get_artifact_service
from allhands.core import BINARY_KINDS, Artifact, ArtifactKind, ArtifactVersion
from allhands.services.artifact_service import ArtifactNotFound, ArtifactService

router = APIRouter(prefix="/artifacts", tags=["artifacts"])


class ArtifactResponse(BaseModel):
    id: str
    workspace_id: str
    name: str
    kind: str
    mime_type: str
    size_bytes: int
    version: int
    pinned: bool
    deleted_at: str | None
    conversation_id: str | None
    created_by_employee_id: str | None
    created_at: str
    updated_at: str


class ArtifactVersionResponse(BaseModel):
    version: int
    created_at: str
    size_bytes: int
    has_diff: bool


class ArtifactContentResponse(BaseModel):
    id: str
    version: int
    kind: str
    mime_type: str
    content: str | None = None
    content_base64: str | None = None
    truncated: bool = False


def _to_response(art: Artifact) -> ArtifactResponse:
    return ArtifactResponse(
        id=art.id,
        workspace_id=art.workspace_id,
        name=art.name,
        kind=art.kind.value,
        mime_type=art.mime_type,
        size_bytes=art.size_bytes,
        version=art.version,
        pinned=art.pinned,
        deleted_at=art.deleted_at.isoformat() if art.deleted_at else None,
        conversation_id=art.conversation_id,
        created_by_employee_id=art.created_by_employee_id,
        created_at=art.created_at.isoformat(),
        updated_at=art.updated_at.isoformat(),
    )


def _to_version_response(v: ArtifactVersion) -> ArtifactVersionResponse:
    size = (
        len((v.content or "").encode("utf-8"))
        if v.content is not None
        else 0  # on-disk binaries report zero here; clients fetch the content endpoint for bytes
    )
    return ArtifactVersionResponse(
        version=v.version,
        created_at=v.created_at.isoformat(),
        size_bytes=size,
        has_diff=v.diff_from_prev is not None,
    )


@router.get("", response_model=list[ArtifactResponse])
async def list_artifacts(
    kind: str | None = Query(default=None),
    name_prefix: str | None = Query(default=None),
    pinned: bool = Query(default=False),
    include_deleted: bool = Query(default=False),
    limit: int = Query(default=100, ge=1, le=500),
    svc: ArtifactService = Depends(get_artifact_service),
) -> list[ArtifactResponse]:
    parsed_kind: ArtifactKind | None = None
    if kind is not None:
        try:
            parsed_kind = ArtifactKind(kind)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"unknown kind {kind!r}") from exc
    items = await svc.list_all(
        kind=parsed_kind,
        name_prefix=name_prefix,
        pinned_only=pinned,
        include_deleted=include_deleted,
        limit=limit,
    )
    return [_to_response(a) for a in items]


@router.get("/{artifact_id}", response_model=ArtifactResponse)
async def get_artifact(
    artifact_id: str,
    svc: ArtifactService = Depends(get_artifact_service),
) -> ArtifactResponse:
    try:
        art = await svc.get(artifact_id)
    except ArtifactNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _to_response(art)


@router.get("/{artifact_id}/content")
async def get_artifact_content(
    artifact_id: str,
    download: bool = Query(default=False),
    svc: ArtifactService = Depends(get_artifact_service),
) -> Response:
    try:
        art = await svc.get(artifact_id)
    except ArtifactNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    if art.kind in BINARY_KINDS:
        blob = svc.read_binary(art)
        headers: dict[str, str] = {}
        if download:
            headers["Content-Disposition"] = f'attachment; filename="{art.name}"'
        return Response(content=blob, media_type=art.mime_type, headers=headers)

    body = art.content or ""
    return Response(content=body, media_type=art.mime_type)


@router.get("/{artifact_id}/versions", response_model=list[ArtifactVersionResponse])
async def list_artifact_versions(
    artifact_id: str,
    svc: ArtifactService = Depends(get_artifact_service),
) -> list[ArtifactVersionResponse]:
    try:
        await svc.get(artifact_id)
    except ArtifactNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    versions = await svc.list_versions(artifact_id)
    return [_to_version_response(v) for v in versions]


@router.get("/{artifact_id}/versions/{version}/content", response_model=ArtifactContentResponse)
async def get_artifact_version_content(
    artifact_id: str,
    version: int,
    svc: ArtifactService = Depends(get_artifact_service),
) -> ArtifactContentResponse:
    try:
        art = await svc.get(artifact_id)
        v = await svc.read_version(artifact_id, version)
    except ArtifactNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    if art.kind in BINARY_KINDS:
        if v.file_path is None:
            raise HTTPException(status_code=404, detail="version has no stored blob")
        blob = (svc.absolute_path(v.file_path)).read_bytes()
        return ArtifactContentResponse(
            id=art.id,
            version=v.version,
            kind=art.kind.value,
            mime_type=art.mime_type,
            content_base64=base64.b64encode(blob).decode("ascii"),
        )

    return ArtifactContentResponse(
        id=art.id,
        version=v.version,
        kind=art.kind.value,
        mime_type=art.mime_type,
        content=v.content,
    )
