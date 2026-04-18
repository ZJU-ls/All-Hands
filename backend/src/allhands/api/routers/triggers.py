"""Trigger REST endpoints — spec § 9.

All endpoints delegate to TriggerService. Meta tools reuse the same service
(L01 Tool First). Create/delete go through ConfirmationGate at the Meta Tool
level — REST calls come from authenticated UI users and do not.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from allhands.api.deps import get_trigger_service
from allhands.core import (
    EventPattern,
    TimerSpec,
    Trigger,
    TriggerAction,
    TriggerActionType,
    TriggerFire,
    TriggerKind,
)
from allhands.services.trigger_service import (
    TriggerNotFoundError,
    TriggerService,
)

router = APIRouter(prefix="/triggers", tags=["triggers"])


class TimerSpecBody(BaseModel):
    cron: str = Field(min_length=1, max_length=128)
    timezone: str = "UTC"


class EventPatternBody(BaseModel):
    type: str = Field(min_length=1, max_length=128)
    filter: dict[str, Any] = Field(default_factory=dict)


class ActionBody(BaseModel):
    type: TriggerActionType
    employee_id: str | None = None
    task_template: str | None = None
    conversation_id: str | None = None
    message_template: str | None = None
    tool_id: str | None = None
    args_template: dict[str, Any] | None = None
    channel: str | None = None
    message: str | None = None


class TriggerResponse(BaseModel):
    id: str
    name: str
    kind: TriggerKind
    enabled: bool
    timer: TimerSpecBody | None
    event: EventPatternBody | None
    action: ActionBody
    min_interval_seconds: int
    fires_total: int
    fires_failed_streak: int
    last_fired_at: str | None
    auto_disabled_reason: str | None
    created_at: str
    created_by: str


class CreateTriggerRequest(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    kind: TriggerKind
    action: ActionBody
    timer: TimerSpecBody | None = None
    event: EventPatternBody | None = None
    min_interval_seconds: int = Field(default=300, ge=60)
    created_by: str = "user"


class UpdateTriggerRequest(BaseModel):
    name: str | None = None
    action: ActionBody | None = None
    timer: TimerSpecBody | None = None
    event: EventPatternBody | None = None
    min_interval_seconds: int | None = Field(default=None, ge=60)


class ToggleTriggerRequest(BaseModel):
    enabled: bool


class FireTriggerRequest(BaseModel):
    event_payload: dict[str, Any] | None = None


class TriggerFireResponse(BaseModel):
    id: str
    trigger_id: str
    fired_at: str
    source: str
    status: str
    run_id: str | None
    rendered_task: str | None
    error_code: str | None
    error_detail: str | None


def _to_response(t: Trigger) -> TriggerResponse:
    return TriggerResponse(
        id=t.id,
        name=t.name,
        kind=t.kind,
        enabled=t.enabled,
        timer=TimerSpecBody(**t.timer.model_dump()) if t.timer else None,
        event=EventPatternBody(**t.event.model_dump()) if t.event else None,
        action=ActionBody(**t.action.model_dump()),
        min_interval_seconds=t.min_interval_seconds,
        fires_total=t.fires_total,
        fires_failed_streak=t.fires_failed_streak,
        last_fired_at=(t.last_fired_at.isoformat() if t.last_fired_at else None),
        auto_disabled_reason=t.auto_disabled_reason,
        created_at=t.created_at.isoformat(),
        created_by=t.created_by,
    )


def _fire_to_response(f: TriggerFire) -> TriggerFireResponse:
    return TriggerFireResponse(
        id=f.id,
        trigger_id=f.trigger_id,
        fired_at=f.fired_at.isoformat(),
        source=f.source.value,
        status=f.status.value,
        run_id=f.run_id,
        rendered_task=f.rendered_task,
        error_code=f.error_code,
        error_detail=f.error_detail,
    )


def _action_body_to_domain(body: ActionBody) -> TriggerAction:
    return TriggerAction(
        type=body.type,
        employee_id=body.employee_id,
        task_template=body.task_template,
        conversation_id=body.conversation_id,
        message_template=body.message_template,
        tool_id=body.tool_id,
        args_template=body.args_template,
        channel="cockpit" if body.channel == "cockpit" else None,
        message=body.message,
    )


@router.get("", response_model=list[TriggerResponse])
async def list_triggers(
    svc: TriggerService = Depends(get_trigger_service),
) -> list[TriggerResponse]:
    triggers = await svc.list_all()
    return [_to_response(t) for t in triggers]


@router.get("/{trigger_id}", response_model=TriggerResponse)
async def get_trigger(
    trigger_id: str,
    svc: TriggerService = Depends(get_trigger_service),
) -> TriggerResponse:
    try:
        t = await svc.get(trigger_id)
    except TriggerNotFoundError as exc:
        raise HTTPException(404, f"Trigger not found: {trigger_id}") from exc
    return _to_response(t)


@router.post("", response_model=TriggerResponse, status_code=201)
async def create_trigger(
    body: CreateTriggerRequest,
    svc: TriggerService = Depends(get_trigger_service),
) -> TriggerResponse:
    try:
        trigger = await svc.create(
            name=body.name,
            kind=body.kind,
            action=_action_body_to_domain(body.action),
            timer=TimerSpec(**body.timer.model_dump()) if body.timer else None,
            event=EventPattern(**body.event.model_dump()) if body.event else None,
            min_interval_seconds=body.min_interval_seconds,
            created_by=body.created_by,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return _to_response(trigger)


@router.patch("/{trigger_id}", response_model=TriggerResponse)
async def update_trigger(
    trigger_id: str,
    body: UpdateTriggerRequest,
    svc: TriggerService = Depends(get_trigger_service),
) -> TriggerResponse:
    try:
        trigger = await svc.update(
            trigger_id,
            name=body.name,
            action=_action_body_to_domain(body.action) if body.action else None,
            timer=TimerSpec(**body.timer.model_dump()) if body.timer else None,
            event=EventPattern(**body.event.model_dump()) if body.event else None,
            min_interval_seconds=body.min_interval_seconds,
        )
    except TriggerNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return _to_response(trigger)


@router.post("/{trigger_id}/toggle", response_model=TriggerResponse)
async def toggle_trigger(
    trigger_id: str,
    body: ToggleTriggerRequest,
    svc: TriggerService = Depends(get_trigger_service),
) -> TriggerResponse:
    try:
        trigger = await svc.toggle(trigger_id, enabled=body.enabled)
    except TriggerNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    return _to_response(trigger)


@router.post("/{trigger_id}/fire", response_model=TriggerFireResponse)
async def fire_trigger(
    trigger_id: str,
    body: FireTriggerRequest | None = None,
    svc: TriggerService = Depends(get_trigger_service),
) -> TriggerFireResponse:
    try:
        fire = await svc.fire_now(
            trigger_id,
            event_payload=body.event_payload if body else None,
        )
    except TriggerNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    return _fire_to_response(fire)


@router.delete("/{trigger_id}", status_code=204)
async def delete_trigger(
    trigger_id: str,
    svc: TriggerService = Depends(get_trigger_service),
) -> None:
    try:
        await svc.delete(trigger_id)
    except TriggerNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.get("/{trigger_id}/fires", response_model=list[TriggerFireResponse])
async def list_trigger_fires(
    trigger_id: str,
    limit: int = 50,
    svc: TriggerService = Depends(get_trigger_service),
) -> list[TriggerFireResponse]:
    fires = await svc.list_fires(trigger_id, limit=limit)
    return [_fire_to_response(f) for f in fires]
