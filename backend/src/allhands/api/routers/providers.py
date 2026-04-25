"""LLM Provider management endpoints."""

from __future__ import annotations

from dataclasses import asdict
from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from allhands.api.deps import get_provider_service, get_session
from allhands.core.provider import LLMProvider
from allhands.core.provider_presets import (
    PROVIDER_PRESETS,
    ProviderKind,
)
from allhands.execution.llm_factory import build_llm, probe_endpoint
from allhands.services.connectivity import (
    ENDPOINT_TIMEOUT_S,
)
from allhands.services.connectivity import (
    probe_endpoint as probe_endpoint_health,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/providers", tags=["providers"])


class ProviderResponse(BaseModel):
    id: str
    name: str
    kind: ProviderKind
    base_url: str
    api_key_set: bool  # never return the actual key
    default_model: str
    is_default: bool
    enabled: bool


class CreateProviderRequest(BaseModel):
    name: str
    kind: ProviderKind = "openai"
    base_url: str
    api_key: str = ""
    default_model: str = "gpt-4o-mini"
    set_as_default: bool = False


class UpdateProviderRequest(BaseModel):
    name: str | None = None
    kind: ProviderKind | None = None
    base_url: str | None = None
    api_key: str | None = None
    default_model: str | None = None
    enabled: bool | None = None


class ProviderPresetResponse(BaseModel):
    kind: ProviderKind
    label: str
    base_url: str
    default_model: str
    key_hint: str
    doc_hint: str


def _to_response(p: LLMProvider) -> ProviderResponse:
    return ProviderResponse(
        id=p.id,
        name=p.name,
        kind=p.kind,
        base_url=p.base_url,
        api_key_set=bool(p.api_key),
        default_model=p.default_model,
        is_default=p.is_default,
        enabled=p.enabled,
    )


@router.get("/presets", response_model=list[ProviderPresetResponse])
async def list_presets() -> list[ProviderPresetResponse]:
    """Return the static registry of supported provider kinds + their defaults.

    Single source of truth for the UI's 添加供应商 format dropdown: each entry
    supplies the preset base_url / default_model / doc hint so the form can
    auto-fill on format change without the user needing to look up URLs.
    """
    return [ProviderPresetResponse(**asdict(p)) for p in PROVIDER_PRESETS.values()]


@router.get("", response_model=list[ProviderResponse])
async def list_providers(
    session: AsyncSession = Depends(get_session),
) -> list[ProviderResponse]:
    svc = await get_provider_service(session)
    providers = await svc.list_all()
    return [_to_response(p) for p in providers]


@router.post("", response_model=ProviderResponse, status_code=201)
async def create_provider(
    body: CreateProviderRequest,
    session: AsyncSession = Depends(get_session),
) -> ProviderResponse:
    svc = await get_provider_service(session)
    provider = await svc.create(
        name=body.name,
        kind=body.kind,
        base_url=body.base_url,
        api_key=body.api_key,
        default_model=body.default_model,
        set_as_default=body.set_as_default,
    )
    return _to_response(provider)


@router.patch("/{provider_id}", response_model=ProviderResponse)
async def update_provider(
    provider_id: str,
    body: UpdateProviderRequest,
    session: AsyncSession = Depends(get_session),
) -> ProviderResponse:
    svc = await get_provider_service(session)
    provider = await svc.update(
        provider_id,
        name=body.name,
        kind=body.kind,
        base_url=body.base_url,
        api_key=body.api_key,
        default_model=body.default_model,
        enabled=body.enabled,
    )
    if provider is None:
        raise HTTPException(status_code=404, detail="Provider not found.")
    return _to_response(provider)


@router.post("/{provider_id}/set-default", status_code=204)
async def set_default_provider(
    provider_id: str,
    session: AsyncSession = Depends(get_session),
) -> None:
    svc = await get_provider_service(session)
    p = await svc.get(provider_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Provider not found.")
    await svc.set_default(provider_id)


@router.delete("/{provider_id}", status_code=204)
async def delete_provider(
    provider_id: str,
    session: AsyncSession = Depends(get_session),
) -> None:
    svc = await get_provider_service(session)
    await svc.delete(provider_id)


@router.post("/{provider_id}/test", response_model=dict)
async def test_provider(
    provider_id: str,
    session: AsyncSession = Depends(get_session),
) -> dict[str, object]:
    """Connectivity test: list-models probe, fallback to a tiny chat call."""
    svc = await get_provider_service(session)
    provider = await svc.get(provider_id)
    if provider is None:
        raise HTTPException(status_code=404, detail="Provider not found.")

    url, headers = probe_endpoint(provider)
    try:
        import httpx

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers=headers)
        if resp.status_code < 400:
            return {"ok": True, "endpoint": url, "status": resp.status_code}
    except Exception:
        pass

    try:
        from langchain_core.messages import HumanMessage

        llm = build_llm(provider, provider.default_model)
        resp2 = await llm.ainvoke([HumanMessage(content="ping")])
        return {
            "ok": True,
            "model": provider.default_model,
            "response": str(resp2.content)[:100],
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@router.post("/{provider_id}/ping", response_model=dict)
async def ping_provider(
    provider_id: str,
    session: AsyncSession = Depends(get_session),
) -> dict[str, object]:
    """Endpoint-only health probe — auth + network reach.

    Mirrors the endpoint half of `/api/models/{id}/ping` for the Provider
    list view. No inference is performed: a single GET against the provider's
    list-models endpoint is enough to tell the user "your key + base_url
    can reach this provider" or fail with a structured reason.
    """
    import httpx as _httpx

    svc = await get_provider_service(session)
    provider = await svc.get(provider_id)
    if provider is None:
        raise HTTPException(status_code=404, detail="Provider not found.")
    async with _httpx.AsyncClient(timeout=ENDPOINT_TIMEOUT_S) as client:
        result = await probe_endpoint_health(provider, http_client=client)
    return result.to_dict()
