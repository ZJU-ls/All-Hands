"""Skill management endpoints — sibling of `/skills` UI page.

Every write verb here must have a semantic twin in
`execution/tools/meta/skill_tools.py` (L01 扩展 · 2026-04-18).
Exception: upload stays REST-only; Lead Agent can't easily transfer .zip bytes.

The `/market` subtree surfaces a real GitHub-backed market (default:
`anthropics/skills`, subtree `skills/*`). Supports `?q=` search and
`{slug}/preview` to fetch SKILL.md before install.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel

from allhands.api.deps import get_skill_service
from allhands.core import Skill
from allhands.services.github_market import GithubMarketEntry, GithubMarketPreview
from allhands.services.skill_service import SkillInstallError, SkillService

router = APIRouter(prefix="/skills", tags=["skills"])


class SkillResponse(BaseModel):
    id: str
    name: str
    description: str
    tool_ids: list[str]
    prompt_fragment: str | None
    version: str
    source: str
    source_url: str | None
    installed_at: str | None
    path: str | None


class MarketEntryResponse(BaseModel):
    slug: str
    name: str
    description: str
    source_url: str
    version: str
    tags: list[str]


class MarketPreviewResponse(BaseModel):
    slug: str
    name: str
    description: str
    version: str
    source_url: str
    skill_md: str
    files: list[str]


class InstallGithubRequest(BaseModel):
    url: str
    ref: str = "main"


class InstallMarketRequest(BaseModel):
    slug: str


class UpdateSkillRequest(BaseModel):
    description: str | None = None
    prompt_fragment: str | None = None


def _to_response(skill: Skill) -> SkillResponse:
    return SkillResponse(
        id=skill.id,
        name=skill.name,
        description=skill.description,
        tool_ids=list(skill.tool_ids),
        prompt_fragment=skill.prompt_fragment,
        version=skill.version,
        source=skill.source.value,
        source_url=skill.source_url,
        installed_at=skill.installed_at.isoformat() if skill.installed_at else None,
        path=skill.path,
    )


def _to_market_response(entry: GithubMarketEntry) -> MarketEntryResponse:
    return MarketEntryResponse(
        slug=entry.slug,
        name=entry.name,
        description=entry.description,
        source_url=entry.source_url,
        version=entry.version,
        tags=list(entry.tags),
    )


def _to_preview_response(preview: GithubMarketPreview) -> MarketPreviewResponse:
    return MarketPreviewResponse(
        slug=preview.slug,
        name=preview.name,
        description=preview.description,
        version=preview.version,
        source_url=preview.source_url,
        skill_md=preview.skill_md,
        files=list(preview.files),
    )


@router.get("", response_model=list[SkillResponse])
async def list_skills(
    svc: SkillService = Depends(get_skill_service),
) -> list[SkillResponse]:
    skills = await svc.list_all()
    return [_to_response(s) for s in skills]


@router.get("/market", response_model=list[MarketEntryResponse])
async def list_market(
    q: str | None = Query(default=None, description="Substring match on slug/name/desc/tags"),
    svc: SkillService = Depends(get_skill_service),
) -> list[MarketEntryResponse]:
    try:
        entries = await svc.list_market(q)
    except SkillInstallError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return [_to_market_response(e) for e in entries]


@router.get("/market/{slug}/preview", response_model=MarketPreviewResponse)
async def preview_market(
    slug: str,
    svc: SkillService = Depends(get_skill_service),
) -> MarketPreviewResponse:
    try:
        preview = await svc.preview_market_skill(slug)
    except SkillInstallError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _to_preview_response(preview)


@router.get("/{skill_id}", response_model=SkillResponse)
async def get_skill(
    skill_id: str,
    svc: SkillService = Depends(get_skill_service),
) -> SkillResponse:
    skill = await svc.get(skill_id)
    if skill is None:
        raise HTTPException(status_code=404, detail="Skill not found.")
    return _to_response(skill)


@router.patch("/{skill_id}", response_model=SkillResponse)
async def update_skill(
    skill_id: str,
    body: UpdateSkillRequest,
    svc: SkillService = Depends(get_skill_service),
) -> SkillResponse:
    skill = await svc.update(
        skill_id,
        description=body.description,
        prompt_fragment=body.prompt_fragment,
    )
    if skill is None:
        raise HTTPException(status_code=404, detail="Skill not found.")
    return _to_response(skill)


@router.delete("/{skill_id}", status_code=204)
async def delete_skill(
    skill_id: str,
    svc: SkillService = Depends(get_skill_service),
) -> None:
    await svc.delete(skill_id)


@router.post("/install/github", response_model=SkillResponse, status_code=201)
async def install_from_github(
    body: InstallGithubRequest,
    svc: SkillService = Depends(get_skill_service),
) -> SkillResponse:
    try:
        skill = await svc.install_from_github(body.url, ref=body.ref)
    except SkillInstallError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _to_response(skill)


@router.post("/install/market", response_model=SkillResponse, status_code=201)
async def install_from_market(
    body: InstallMarketRequest,
    svc: SkillService = Depends(get_skill_service),
) -> SkillResponse:
    try:
        skill = await svc.install_from_market(body.slug)
    except SkillInstallError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _to_response(skill)


@router.post("/install/upload", response_model=SkillResponse, status_code=201)
async def install_from_upload(
    file: UploadFile = File(...),
    svc: SkillService = Depends(get_skill_service),
) -> SkillResponse:
    data = await file.read()
    try:
        skill = await svc.install_from_upload(data, filename=file.filename or "upload.zip")
    except SkillInstallError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _to_response(skill)
