"""Skill management endpoints — sibling of `/skills` UI page.

Every write verb here must have a semantic twin in
`execution/tools/meta/skill_tools.py` (L01 扩展 · 2026-04-18).
Exception: upload stays REST-only; Lead Agent can't easily transfer .zip bytes.

The `/market` subtree surfaces a real GitHub-backed market (default:
`anthropics/skills`, subtree `skills/*`). Supports `?q=` search and
`{slug}/preview` to fetch SKILL.md before install.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from allhands.api.deps import get_session, get_skill_service, get_tool_registry
from allhands.core import Skill
from allhands.core.errors import DomainError
from allhands.persistence.sql_repos import SqlLLMProviderRepo
from allhands.services import ai_explainer
from allhands.services.github_market import GithubMarketEntry, GithubMarketPreview
from allhands.services.skill_service import SkillInstallError, SkillService

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from sqlalchemy.ext.asyncio import AsyncSession

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
    ai_explainer.invalidate_skill_explanation(skill_id)
    return _to_response(skill)


@router.delete("/{skill_id}", status_code=204)
async def delete_skill(
    skill_id: str,
    svc: SkillService = Depends(get_skill_service),
) -> None:
    ai_explainer.invalidate_skill_explanation(skill_id)
    await svc.delete(skill_id)


@router.post("/market/{slug}/explain")
async def explain_market_skill(
    slug: str,
    svc: SkillService = Depends(get_skill_service),
    session: AsyncSession = Depends(get_session),
) -> StreamingResponse:
    """Stream a Markdown explanation for a market skill (uninstalled).

    Hits the same GitHub-backed market preview endpoint that the
    `/skills` page uses, then feeds name + description + SKILL.md into
    the AI explainer so the user can decide whether to install. Cached
    in-process under ``market:<slug>`` for the process lifetime —
    market preview itself is already cached upstream (5min) so an edit
    surfaces on restart, matching the user's mental model.
    """
    try:
        preview = await svc.preview_market_skill(slug)
    except SkillInstallError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    async def _gen() -> AsyncIterator[bytes]:
        try:
            async for chunk in ai_explainer.explain_market_skill_stream(
                slug=slug,
                name=preview.name,
                description=preview.description,
                version=preview.version,
                source_url=preview.source_url,
                skill_md=preview.skill_md,
                provider_repo=SqlLLMProviderRepo(session),
            ):
                if chunk:
                    yield chunk.encode("utf-8")
        except DomainError as exc:
            yield f"\n\n[错误] {exc}".encode()

    return StreamingResponse(
        _gen(),
        media_type="text/plain; charset=utf-8",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )


@router.post("/{skill_id}/explain")
async def explain_skill(
    skill_id: str,
    svc: SkillService = Depends(get_skill_service),
    session: AsyncSession = Depends(get_session),
) -> StreamingResponse:
    """Stream a Markdown "what does this skill do" explanation.

    Single-turn LLM call backed by the workspace default provider/model
    (no agent loop). The frontend reads the body as a plain text stream
    (text/event-stream framing not needed — we write raw chunks so the
    consumer can append straight to a textarea / Markdown renderer).
    Cached per-skill in-memory; cleared on update / delete / reinstall.
    """
    skill = await svc.get(skill_id)
    if skill is None:
        raise HTTPException(status_code=404, detail="Skill not found.")

    async def _gen() -> AsyncIterator[bytes]:
        try:
            async for chunk in ai_explainer.explain_skill_stream(
                skill,
                provider_repo=SqlLLMProviderRepo(session),
                tool_registry=get_tool_registry(),
            ):
                if chunk:
                    yield chunk.encode("utf-8")
        except DomainError as exc:
            yield f"\n\n[错误] {exc}".encode()

    # text/plain so a fetch().getReader() in the browser hands chunks back
    # as the stream lands. Not text/event-stream because we don't need the
    # SSE framing (no client-side EventSource — the chip uses fetch()).
    return StreamingResponse(
        _gen(),
        media_type="text/plain; charset=utf-8",
        # Belt-and-braces against intermediate proxies (nginx · Next dev
        # rewrite path) that buffer text/* responses by default and turn
        # this into "20s blank → big drop". Keep both — different proxies
        # honour different headers.
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )


class InstallGithubResponse(BaseModel):
    skills: list[SkillResponse]
    count: int


@router.post("/install/github", response_model=InstallGithubResponse, status_code=201)
async def install_from_github(
    body: InstallGithubRequest,
    svc: SkillService = Depends(get_skill_service),
) -> InstallGithubResponse:
    try:
        skills = await svc.install_from_github(body.url, ref=body.ref)
    except SkillInstallError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return InstallGithubResponse(
        skills=[_to_response(s) for s in skills],
        count=len(skills),
    )


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
