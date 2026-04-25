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
from allhands.i18n import t
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
    """Provider DTO. The "default" concept is no longer surfaced here —
    it lives on `LLMModel.is_default` (a singleton flag on a specific
    model row), exposed via the Models API. UI derives "this provider
    is the default one" by checking whether any of its models has
    `is_default=True`.
    """

    id: str
    name: str
    kind: ProviderKind
    base_url: str
    api_key_set: bool  # never return the actual key
    enabled: bool


class CreateProviderRequest(BaseModel):
    name: str
    kind: ProviderKind = "openai"
    base_url: str
    api_key: str = ""


class UpdateProviderRequest(BaseModel):
    name: str | None = None
    kind: ProviderKind | None = None
    base_url: str | None = None
    api_key: str | None = None
    enabled: bool | None = None


class ProviderPresetResponse(BaseModel):
    """Static suggestion shown by the UI when picking a provider format.

    `default_model` here is a STRING HINT — "the canonical model for this
    kind, suggested as the first one to register" — not a default-pointer
    field. It seeds the model-add dialog's name input on a fresh provider.
    """

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
        enabled=body.enabled,
    )
    if provider is None:
        raise HTTPException(status_code=404, detail=t("errors.not_found.provider"))
    return _to_response(provider)


@router.delete("/{provider_id}", status_code=204)
async def delete_provider(
    provider_id: str,
    session: AsyncSession = Depends(get_session),
) -> None:
    svc = await get_provider_service(session)
    await svc.delete(provider_id)


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
