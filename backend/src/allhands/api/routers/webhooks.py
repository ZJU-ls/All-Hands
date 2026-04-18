"""External webhook ingress — spec § 9 & § 4.2.

`POST /api/webhooks/{trigger_id}` publishes a `webhook.external` event with
the trigger_id tagged in the payload, so event triggers with a matching
`filter={"trigger_id": ...}` fire. The webhook itself does not bypass any
defense rules — the event listener goes through the executor like any
other event source.

v0 has no HMAC; 5-min 256 KB size cap + trigger-kind check is the perimeter.
Spec § 12 schedules HMAC for v1.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix="/webhooks", tags=["webhooks"])

MAX_WEBHOOK_BYTES = 256 * 1024  # spec § 12 default


@router.post("/{trigger_id}")
async def receive_webhook(trigger_id: str, request: Request) -> dict[str, Any]:
    body_bytes = await request.body()
    if len(body_bytes) > MAX_WEBHOOK_BYTES:
        raise HTTPException(413, f"webhook payload exceeds {MAX_WEBHOOK_BYTES} bytes")
    content_type = request.headers.get("content-type", "")
    if content_type.startswith("application/json") and body_bytes:
        try:
            payload = await request.json()
        except ValueError:
            raise HTTPException(400, "invalid JSON body") from None
    else:
        payload = {"raw": body_bytes.decode("utf-8", errors="replace")}

    runtime = getattr(request.app.state, "trigger_runtime", None)
    if runtime is None:
        raise HTTPException(503, "trigger runtime not started")

    await runtime.bus.publish(
        kind="webhook.external",
        payload={"trigger_id": trigger_id, "body": payload},
    )
    return {"status": "accepted", "trigger_id": trigger_id}
