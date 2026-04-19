"""Telegram Bot adapter — out/in (spec § 4.2).

Uses the Bot API ``sendMessage`` for outbound and webhook-posted ``update``
objects for inbound. Kept transport-thin: httpx.AsyncClient allocated per
send so we don't share state across Channel rows (users can rotate bot
tokens without process restart).
"""

from __future__ import annotations

import time
from datetime import UTC, datetime
from typing import Any, ClassVar

import httpx

from allhands.core.channel import (
    Channel,
    ChannelKind,
    ChannelMessageStatus,
    ChannelTestResult,
    DeliveryResult,
    InboundMessage,
    NotificationPayload,
)
from allhands.execution.channels.base import ChannelAdapter, ChannelAdapterError

_TELEGRAM_API = "https://api.telegram.org"


def _render_markdown(payload: NotificationPayload) -> str:
    """Compose Telegram MarkdownV2-safe text.

    v0 uses plain Markdown (not MarkdownV2) to avoid aggressive escaping;
    the title/body are agent-authored so we trust them. Inline action URLs
    are appended as ``• label → url`` lines.
    """
    lines: list[str] = [f"*{payload.title}*"]
    if payload.body:
        lines.append(payload.body)
    for act in payload.actions:
        if act.url:
            lines.append(f"• {act.label} → {act.url}")
    return "\n".join(lines)


class TelegramAdapter(ChannelAdapter):
    kind: ClassVar[ChannelKind] = ChannelKind.TELEGRAM
    supports_inbound: ClassVar[bool] = True
    config_fields: ClassVar[tuple[str, ...]] = ("bot_token", "chat_id")

    http_factory: Any = None  # tests can inject a httpx.AsyncClient factory

    def _client(self) -> httpx.AsyncClient:
        if self.http_factory is not None:
            return self.http_factory()  # type: ignore[no-any-return]
        return httpx.AsyncClient(timeout=10.0)

    async def send(self, channel: Channel, payload: NotificationPayload) -> DeliveryResult:
        token = channel.config.get("bot_token")
        chat_id = channel.config.get("chat_id")
        if not token or not chat_id:
            return DeliveryResult(
                channel_id=channel.id,
                status=ChannelMessageStatus.FAILED,
                error_message="telegram adapter requires bot_token + chat_id in config",
            )
        url = f"{_TELEGRAM_API}/bot{token}/sendMessage"
        started = time.perf_counter()
        try:
            async with self._client() as client:
                resp = await client.post(
                    url,
                    json={
                        "chat_id": chat_id,
                        "text": _render_markdown(payload),
                        "parse_mode": "Markdown",
                        "disable_web_page_preview": True,
                    },
                )
        except httpx.HTTPError as exc:
            return DeliveryResult(
                channel_id=channel.id,
                status=ChannelMessageStatus.FAILED,
                error_message=f"telegram transport error: {exc!s}",
                elapsed_ms=int((time.perf_counter() - started) * 1000),
            )
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        if resp.status_code >= 400:
            return DeliveryResult(
                channel_id=channel.id,
                status=ChannelMessageStatus.FAILED,
                error_message=f"telegram api {resp.status_code}: {resp.text[:200]}",
                elapsed_ms=elapsed_ms,
            )
        data = resp.json()
        external_id = str(data.get("result", {}).get("message_id")) if data.get("ok") else None
        return DeliveryResult(
            channel_id=channel.id,
            status=ChannelMessageStatus.DELIVERED,
            external_id=external_id,
            elapsed_ms=elapsed_ms,
        )

    async def parse_inbound(
        self,
        channel: Channel,
        headers: dict[str, str],
        body: bytes,
    ) -> InboundMessage:
        import json

        try:
            data = json.loads(body.decode("utf-8") or "{}")
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ChannelAdapterError(f"telegram webhook body not valid json: {exc!s}") from exc
        message = data.get("message") or data.get("edited_message") or {}
        text = message.get("text", "")
        chat = message.get("chat", {})
        user_ref = str(chat.get("id") or message.get("from", {}).get("id", ""))
        if not user_ref:
            raise ChannelAdapterError("telegram webhook missing chat.id")
        return InboundMessage(
            channel_id=channel.id,
            external_user_ref=user_ref,
            text=text,
            received_at=datetime.now(UTC),
            raw=data,
        )

    async def verify_signature(
        self,
        channel: Channel,
        headers: dict[str, str],
        body: bytes,
    ) -> bool:
        """Telegram uses a shared secret via the ``X-Telegram-Bot-Api-Secret-Token`` header.

        Falls back to the generic HMAC check when ``webhook_secret`` is unset.
        """
        del body
        secret = channel.webhook_secret
        if not secret:
            return True
        header_token = headers.get("x-telegram-bot-api-secret-token") or headers.get(
            "X-Telegram-Bot-Api-Secret-Token"
        )
        if header_token is None:
            return False
        return header_token == secret

    async def test_connection(self, channel: Channel) -> ChannelTestResult:
        token = channel.config.get("bot_token")
        if not token:
            return ChannelTestResult(ok=False, detail="missing bot_token")
        url = f"{_TELEGRAM_API}/bot{token}/getMe"
        started = time.perf_counter()
        try:
            async with self._client() as client:
                resp = await client.get(url)
        except httpx.HTTPError as exc:
            return ChannelTestResult(
                ok=False,
                detail=f"transport error: {exc!s}",
                latency_ms=int((time.perf_counter() - started) * 1000),
            )
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        if resp.status_code >= 400:
            return ChannelTestResult(
                ok=False,
                detail=f"telegram api {resp.status_code}",
                latency_ms=elapsed_ms,
            )
        return ChannelTestResult(
            ok=True,
            detail=resp.json().get("result", {}).get("username", ""),
            latency_ms=elapsed_ms,
        )


__all__ = ["TelegramAdapter"]
