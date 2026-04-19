"""LLM Provider management endpoints."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from allhands.api.deps import get_provider_service, get_session
from allhands.core.provider import LLMProvider

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/providers", tags=["providers"])


class ProviderResponse(BaseModel):
    id: str
    name: str
    base_url: str
    api_key_set: bool  # never return the actual key
    default_model: str
    is_default: bool
    enabled: bool


class CreateProviderRequest(BaseModel):
    name: str
    base_url: str
    api_key: str = ""
    default_model: str = "gpt-4o-mini"
    set_as_default: bool = False


class UpdateProviderRequest(BaseModel):
    name: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    default_model: str | None = None
    enabled: bool | None = None


def _to_response(p: LLMProvider) -> ProviderResponse:
    return ProviderResponse(
        id=p.id,
        name=p.name,
        base_url=p.base_url,
        api_key_set=bool(p.api_key),
        default_model=p.default_model,
        is_default=p.is_default,
        enabled=p.enabled,
    )


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
    """Connectivity test: HEAD the /models endpoint if available, else a tiny chat call."""
    svc = await get_provider_service(session)
    provider = await svc.get(provider_id)
    if provider is None:
        raise HTTPException(status_code=404, detail="Provider not found.")

    # Prefer /models listing for a pure connectivity check (no token usage).
    try:
        import httpx

        url = provider.base_url.rstrip("/") + "/models"
        headers = {"Authorization": f"Bearer {provider.api_key}"} if provider.api_key else {}
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers=headers)
        if resp.status_code < 400:
            return {"ok": True, "endpoint": url, "status": resp.status_code}
        # Fall back to a chat completion if /models is missing.
    except Exception:
        pass

    try:
        from langchain_core.messages import HumanMessage
        from langchain_openai import ChatOpenAI

        kwargs: dict[str, Any] = {"model": provider.default_model}
        if provider.api_key:
            kwargs["api_key"] = provider.api_key
        if provider.base_url:
            kwargs["base_url"] = provider.base_url
        llm = ChatOpenAI(**kwargs)
        resp2 = await llm.ainvoke([HumanMessage(content="ping")])
        return {"ok": True, "model": provider.default_model, "response": str(resp2.content)[:100]}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
