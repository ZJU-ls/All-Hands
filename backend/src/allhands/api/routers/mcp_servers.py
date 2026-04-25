"""MCP server management endpoints — sibling of `/mcp-servers` UI page.

Every write verb (POST/PATCH/DELETE) has a semantic twin in
`execution/tools/meta/mcp_server_tools.py` (L01 扩展 · 2026-04-18).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from allhands.api.deps import get_mcp_service
from allhands.core import MCPServer, MCPTransport
from allhands.i18n import t
from allhands.services.mcp_service import MCPService, MCPServiceError

router = APIRouter(prefix="/mcp-servers", tags=["mcp-servers"])


class MCPServerResponse(BaseModel):
    id: str
    name: str
    transport: str
    config: dict[str, Any]
    enabled: bool
    exposed_tool_ids: list[str]
    last_handshake_at: str | None
    health: str


class MCPToolResponse(BaseModel):
    name: str
    description: str
    input_schema: dict[str, Any]


class AddServerRequest(BaseModel):
    name: str
    transport: str
    config: dict[str, Any]
    enabled: bool = True


class UpdateServerRequest(BaseModel):
    name: str | None = None
    config: dict[str, Any] | None = None
    enabled: bool | None = None


class InvokeToolRequest(BaseModel):
    tool_name: str
    arguments: dict[str, Any] = {}


def _to_response(s: MCPServer) -> MCPServerResponse:
    return MCPServerResponse(
        id=s.id,
        name=s.name,
        transport=s.transport.value,
        config=dict(s.config),
        enabled=s.enabled,
        exposed_tool_ids=list(s.exposed_tool_ids),
        last_handshake_at=s.last_handshake_at.isoformat() if s.last_handshake_at else None,
        health=s.health.value,
    )


def _parse_transport(raw: str) -> MCPTransport:
    try:
        return MCPTransport(raw)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"transport must be one of stdio|sse|http (got {raw!r})",
        ) from exc


@router.get("", response_model=list[MCPServerResponse])
async def list_servers(
    svc: MCPService = Depends(get_mcp_service),
) -> list[MCPServerResponse]:
    return [_to_response(s) for s in await svc.list_all()]


@router.get("/{server_id}", response_model=MCPServerResponse)
async def get_server(
    server_id: str,
    svc: MCPService = Depends(get_mcp_service),
) -> MCPServerResponse:
    server = await svc.get(server_id)
    if server is None:
        raise HTTPException(status_code=404, detail=t("errors.not_found.mcp_server"))
    return _to_response(server)


@router.post("", response_model=MCPServerResponse, status_code=201)
async def add_server(
    body: AddServerRequest,
    svc: MCPService = Depends(get_mcp_service),
) -> MCPServerResponse:
    transport = _parse_transport(body.transport)
    try:
        created = await svc.add(
            name=body.name,
            transport=transport,
            config=body.config,
            enabled=body.enabled,
        )
    except MCPServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _to_response(created)


@router.patch("/{server_id}", response_model=MCPServerResponse)
async def update_server(
    server_id: str,
    body: UpdateServerRequest,
    svc: MCPService = Depends(get_mcp_service),
) -> MCPServerResponse:
    try:
        updated = await svc.update(
            server_id,
            name=body.name,
            config=body.config,
            enabled=body.enabled,
        )
    except MCPServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if updated is None:
        raise HTTPException(status_code=404, detail=t("errors.not_found.mcp_server"))
    return _to_response(updated)


@router.delete("/{server_id}", status_code=204)
async def delete_server(
    server_id: str,
    svc: MCPService = Depends(get_mcp_service),
) -> None:
    await svc.delete(server_id)


@router.post("/{server_id}/test", response_model=MCPServerResponse)
async def test_connection(
    server_id: str,
    svc: MCPService = Depends(get_mcp_service),
) -> MCPServerResponse:
    result = await svc.test_connection(server_id)
    if result is None:
        raise HTTPException(status_code=404, detail=t("errors.not_found.mcp_server"))
    return _to_response(result)


@router.get("/{server_id}/tools", response_model=list[MCPToolResponse])
async def list_server_tools(
    server_id: str,
    svc: MCPService = Depends(get_mcp_service),
) -> list[MCPToolResponse]:
    try:
        tools = await svc.list_server_tools(server_id)
    except MCPServiceError as exc:
        msg = str(exc)
        status = 404 if "not found" in msg else 502
        raise HTTPException(status_code=status, detail=msg) from exc
    return [
        MCPToolResponse(name=t.name, description=t.description, input_schema=t.input_schema)
        for t in tools
    ]


@router.post("/{server_id}/invoke", response_model=dict[str, Any])
async def invoke_tool(
    server_id: str,
    body: InvokeToolRequest,
    svc: MCPService = Depends(get_mcp_service),
) -> dict[str, Any]:
    try:
        return await svc.invoke_server_tool(
            server_id,
            tool_name=body.tool_name,
            arguments=body.arguments,
        )
    except MCPServiceError as exc:
        msg = str(exc)
        status = 404 if "not found" in msg else 502
        raise HTTPException(status_code=status, detail=msg) from exc
