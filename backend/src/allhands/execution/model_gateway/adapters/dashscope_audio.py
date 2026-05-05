"""DashScope (Alibaba Bailian) text-to-speech adapter.

Family covered: cosyvoice-* (newer, multilingual + voice cloning) and
sambert-* (older, mandarin-focused). Both expose the same task-based
async API as wanx image/video, with the audio bytes hosted at a URL.

Endpoint:
- POST {base}/services/audio/tts
  with header X-DashScope-Async: enable
- GET  {base}/tasks/{task_id}

Body shape (cosyvoice / sambert):
  {
    "model": "cosyvoice-v1",
    "input": {"text": "..."},
    "parameters": {
        "voice": "longxiaochun",  # provider-specific voice id
        "format": "mp3",
        "sample_rate": 22050,
        "rate": 1.0
    }
  }

Response (POST): {"output": {"task_id": "...", "task_status": "PENDING"}}
Response (GET):  on SUCCEEDED → output.audio.url  (or output.url)

Reference:
- https://help.aliyun.com/zh/model-studio/cosyvoice-large-model-for-speech-synthesis
- product/research/sandbox/MODEL-GATEWAY.html § 5
"""

from __future__ import annotations

import asyncio
import time
from typing import ClassVar

import httpx

from allhands.core.audio import (
    MAX_AUDIO_BYTES,
    AudioFormat,
    AudioGenerationResult,
    GeneratedAudio,
    TTSRequest,
)
from allhands.core.modality import Modality
from allhands.core.model import LLMModel
from allhands.core.provider import LLMProvider

from ..base import _default_supports
from .openai_image import ImageProviderError as _BaseProviderError

_PENDING_STATUSES = frozenset({"PENDING", "RUNNING"})
_TERMINAL_OK = "SUCCEEDED"
_TERMINAL_FAIL = frozenset({"FAILED", "UNKNOWN"})


class AudioProviderError(_BaseProviderError):
    """Same shape as ImageProviderError; renamed for the audio domain."""


_FORMAT_TO_MIME: dict[AudioFormat, str] = {
    AudioFormat.MP3: "audio/mpeg",
    AudioFormat.WAV: "audio/wav",
    AudioFormat.OGG: "audio/ogg",
    AudioFormat.FLAC: "audio/flac",
}


class DashScopeAudioAdapter:
    """AudioAdapter · DashScope cosyvoice / sambert TTS.

    Sandbox / safety:
    - Wall-clock cap (default 60 s) — TTS for an 8000-char request is
      typically 5-15 s.
    - Sniff returned bytes minimally; trust DashScope's declared format
      since they don't typically lie about it.

    STT (audio → text via sensevoice / paraformer) is a Phase B follow-up
    — this adapter only handles TTS today.
    """

    modality: ClassVar[Modality] = Modality.AUDIO
    provider_kinds: ClassVar[tuple[str, ...]] = ("aliyun",)
    # 2026-05-05 · empty patterns → accept any aliyun audio model row.
    # Capability is declared on the LLMModel row at registration time,
    # so the adapter no longer needs to maintain a name-substring list
    # (`cosyvoice` / `sambert` / future families …).
    model_patterns: ClassVar[tuple[str, ...]] = ()

    def __init__(
        self,
        *,
        poll_timeout_seconds: float = 60.0,
        poll_interval_seconds: float = 2.0,
        request_timeout_seconds: float = 30.0,
    ) -> None:
        self._poll_timeout = poll_timeout_seconds
        self._poll_interval = poll_interval_seconds
        self._request_timeout = request_timeout_seconds

    async def supports(self, *, provider: LLMProvider, model: LLMModel) -> bool:
        return _default_supports(self, provider=provider, model=model)

    async def generate(
        self,
        request: TTSRequest,
        *,
        provider: LLMProvider,
        model: LLMModel,
    ) -> AudioGenerationResult:
        if not provider.api_key:
            raise AudioProviderError(
                "audio provider requires an api_key",
                field="api_key",
                expected="non-empty string",
            )

        base = provider.base_url.rstrip("/")
        if base.endswith("/compatible-mode/v1"):
            base = base[: -len("/compatible-mode/v1")] + "/api/v1"
        elif not base.endswith("/api/v1"):
            base = base + "/api/v1"

        post_url = f"{base}/services/audio/tts"
        params: dict[str, object] = {
            "voice": request.voice,
            "format": request.format.value,
            "rate": request.speed,
        }
        body: dict[str, object] = {
            "model": model.name,
            "input": {"text": request.text},
            "parameters": params,
        }
        headers = {
            "Authorization": f"Bearer {provider.api_key}",
            "Content-Type": "application/json",
            "X-DashScope-Async": "enable",
        }

        started = time.monotonic()
        async with httpx.AsyncClient(timeout=self._request_timeout) as client:
            try:
                resp = await client.post(post_url, headers=headers, json=body)
            except httpx.HTTPError as exc:
                raise AudioProviderError(
                    f"network error contacting DashScope TTS: {exc}",
                    field="network",
                    hint="Check provider base_url and connectivity.",
                ) from exc

            if resp.status_code != 200:
                raise AudioProviderError(
                    f"DashScope TTS POST returned HTTP {resp.status_code}",
                    status=resp.status_code,
                    received=resp.text[:500],
                    hint=(
                        "Common: 401 = bad api_key; 400 = bad model name "
                        "(try cosyvoice-v1 / sambert-zhichu-v1); 429 = quota."
                    ),
                )
            try:
                payload = resp.json()
            except ValueError as exc:
                raise AudioProviderError(
                    "DashScope TTS POST returned non-JSON",
                    received=resp.text[:200],
                ) from exc

            output = payload.get("output") or {}
            # DashScope sometimes returns audio inline (small clips) or via task_id (long).
            audio_url = _extract_audio_url(output)
            if not audio_url:
                task_id = output.get("task_id")
                if not task_id:
                    raise AudioProviderError(
                        "DashScope TTS POST returned neither audio_url nor task_id",
                        received=str(payload)[:300],
                    )
                poll_url = f"{base}/tasks/{task_id}"
                poll_headers = {"Authorization": f"Bearer {provider.api_key}"}
                terminal_payload = await self._poll_until_terminal(
                    client, poll_url, poll_headers, task_id
                )
                terminal_output = terminal_payload.get("output") or {}
                assert isinstance(terminal_output, dict)
                audio_url = _extract_audio_url(terminal_output)
                if not audio_url:
                    raise AudioProviderError(
                        "DashScope TTS task succeeded but returned no audio url",
                        received=str(terminal_payload)[:300],
                    )

            try:
                aud_resp = await client.get(audio_url, timeout=60.0)
            except httpx.HTTPError as exc:
                raise AudioProviderError(
                    f"failed to download generated audio: {exc}",
                    field="download",
                ) from exc
            if aud_resp.status_code != 200:
                raise AudioProviderError(
                    f"failed downloading audio · HTTP {aud_resp.status_code}",
                    status=aud_resp.status_code,
                )
            raw = aud_resp.content
            if len(raw) > MAX_AUDIO_BYTES:
                raise AudioProviderError(
                    f"audio too big · {len(raw)} bytes > {MAX_AUDIO_BYTES} cap",
                    field="audio_size",
                )

            mime = _FORMAT_TO_MIME[request.format]
            audio = GeneratedAudio(data=raw, mime_type=mime, format=request.format)

        duration_ms = int((time.monotonic() - started) * 1000)
        return AudioGenerationResult(
            audio=audio,
            text=None,
            duration_ms=duration_ms,
            cost_usd=None,
            model_used=model.name,
            provider_id=provider.id,
        )

    async def _poll_until_terminal(
        self,
        client: httpx.AsyncClient,
        url: str,
        headers: dict[str, str],
        task_id: str,
    ) -> dict[str, object]:
        deadline = time.monotonic() + self._poll_timeout
        while True:
            try:
                resp = await client.get(url, headers=headers)
            except httpx.HTTPError as exc:
                raise AudioProviderError(
                    f"network error polling DashScope TTS task {task_id!r}: {exc}",
                    field="network",
                ) from exc
            if resp.status_code != 200:
                raise AudioProviderError(
                    f"DashScope GET task returned HTTP {resp.status_code}",
                    status=resp.status_code,
                    received=resp.text[:500],
                )
            try:
                payload = resp.json()
            except ValueError as exc:
                raise AudioProviderError(
                    "DashScope GET task returned non-JSON",
                    received=resp.text[:200],
                ) from exc
            output = payload.get("output") or {}
            status = str(output.get("task_status") or "").upper()
            if status == _TERMINAL_OK:
                return dict(payload)
            if status in _TERMINAL_FAIL:
                msg = output.get("message") or "task failed without message"
                raise AudioProviderError(
                    f"DashScope TTS task FAILED: {msg}",
                    field="task",
                    received=str(output)[:300],
                )
            if status not in _PENDING_STATUSES:
                raise AudioProviderError(
                    f"DashScope TTS task returned unknown status {status!r}",
                    received=str(output)[:200],
                )
            if time.monotonic() >= deadline:
                raise AudioProviderError(
                    f"DashScope TTS task {task_id!r} timed out after {self._poll_timeout}s",
                    field="timeout",
                    expected=f"≤ {self._poll_timeout}s",
                )
            await asyncio.sleep(self._poll_interval)


def _extract_audio_url(output: dict[str, object]) -> str | None:
    """DashScope nests the audio URL slightly differently across model lines:
    cosyvoice → output.audio.url; sambert → output.url; some return
    output.results[0].url. Try each in order."""
    audio_obj = output.get("audio")
    if isinstance(audio_obj, dict):
        url = audio_obj.get("url")
        if isinstance(url, str) and url:
            return url
    if isinstance(output.get("url"), str):
        return str(output["url"])
    results = output.get("results")
    if isinstance(results, list) and results:
        first = results[0]
        if isinstance(first, dict):
            for k in ("url", "audio_url"):
                v = first.get(k)
                if isinstance(v, str) and v:
                    return v
    return None


__all__ = ["AudioProviderError", "DashScopeAudioAdapter"]
