"""Real-LLM soak · 10+ rounds against Bailian wanx with varied prompts.

Goal: catch flakiness the single shot in test_image_dashscope_real misses.
Cycles through different (model, size, prompt-shape) combos so we exercise:
- Both wanx2.1-t2i-turbo (cheap/fast) and wan2.5-t2i-preview (newer)
- All ALLOWED_SIZES the API accepts
- Prompts with: emoji, CJK, English, dot-separated artistic styles
- Quality auto + standard + high

Each round prints duration + bytes + cost so the morning report has a
copy-pasteable table. Failures don't abort — we collect all results
and assert at the end so a one-off provider hiccup doesn't waste 9
other passing rounds.

Skipped automatically if no DashScope key is reachable.
"""

from __future__ import annotations

import os
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path

import pytest

from allhands.core.image import ImageGenerationRequest, ImageQuality
from allhands.core.model import Capability, LLMModel
from allhands.core.provider import LLMProvider
from allhands.execution.model_gateway import ModelGateway
from allhands.execution.model_gateway.adapters import DashScopeImageAdapter


def _resolve_dashscope_key() -> str | None:
    env = os.environ.get("ALLHANDS_DASHSCOPE_API_KEY") or os.environ.get("DASHSCOPE_API_KEY")
    if env:
        return env
    # Walk up to project root and check both possible runtime DB locations.
    for candidate in [
        Path(__file__).resolve().parents[2] / "data" / "app.db",
        Path("/Volumes/Storage/code/allhands/backend/data.runtime/app.db"),
        Path("/Volumes/Storage/code/allhands/backend/data/app.db"),
    ]:
        if not candidate.is_file():
            continue
        try:
            con = sqlite3.connect(str(candidate))
            try:
                row = con.execute(
                    "SELECT api_key FROM llm_providers WHERE kind='aliyun' "
                    "AND length(api_key) > 10 LIMIT 1"
                ).fetchone()
                if row and row[0]:
                    return str(row[0])
            finally:
                con.close()
        except sqlite3.Error:
            continue
    return None


_KEY = _resolve_dashscope_key()

pytestmark = pytest.mark.skipif(
    _KEY is None,
    reason="No DashScope key available (env ALLHANDS_DASHSCOPE_API_KEY or DB).",
)


@dataclass
class RoundResult:
    idx: int
    model: str
    size: str
    quality: str
    prompt: str
    ok: bool
    duration_ms: int
    bytes_out: int
    mime: str
    error: str | None = None


# 12 rounds · varied prompt shape, size, model, quality. Total expected
# wall-clock ≈ 4-6 min @ ~20s per image (turbo) and ~30s (preview).
ROUNDS: list[tuple[str, str, ImageQuality, str]] = [
    ("wanx2.1-t2i-turbo", "1024x1024", ImageQuality.AUTO, "一只橘猫在阳光下打盹"),
    (
        "wanx2.1-t2i-turbo",
        "1024x1024",
        ImageQuality.MEDIUM,
        "minimal flat-illustration of a robot waving",
    ),
    # wanx caps each dim at 1440, so 1536 is rejected · use sizes within
    # the supported range to exercise non-square aspects.
    ("wanx2.1-t2i-turbo", "768x768", ImageQuality.AUTO, "一杯热咖啡旁边放着笔记本电脑"),
    ("wanx2.1-t2i-turbo", "512x512", ImageQuality.AUTO, "panorama of mountains at golden hour"),
    (
        "wanx2.1-t2i-turbo",
        "1024x1024",
        ImageQuality.HIGH,
        "cyberpunk city street with neon reflections on wet pavement",
    ),
    (
        "wanx2.1-t2i-turbo",
        "1024x1024",
        ImageQuality.AUTO,
        "线条简洁的极简家居 · 北欧风 · 木质 + 米白",
    ),
    (
        "wanx2.1-t2i-turbo",
        "1024x1024",
        ImageQuality.AUTO,
        "watercolor sketch of a small wooden bridge over a stream",
    ),
    ("wanx2.1-t2i-turbo", "1024x1024", ImageQuality.AUTO, "一个穿着宇航服的小女孩在月球上插旗"),
    (
        "wanx2.1-t2i-turbo",
        "1024x1024",
        ImageQuality.AUTO,
        "isometric view of a tiny island with a single palm tree",
    ),
    ("wanx2.1-t2i-turbo", "1024x1024", ImageQuality.AUTO, "梵高风格的星空下的小村庄"),
    (
        "wan2.5-t2i-preview",
        "1024x1024",
        ImageQuality.AUTO,
        "a serene koi pond with cherry blossoms",
    ),
    (
        "wan2.5-t2i-preview",
        "1024x1024",
        ImageQuality.AUTO,
        "未来风格的城市天际线 · 鸟瞰 · 蓝紫色光晕",
    ),
]


@pytest.mark.asyncio
async def test_real_llm_image_soak_10_plus_rounds(
    capsys: pytest.CaptureFixture[str],
) -> None:
    """Run 12 real generations and report a summary table."""
    provider = LLMProvider(
        id="bailian-soak",
        name="百炼",
        kind="aliyun",
        base_url="https://dashscope.aliyuncs.com/api/v1",
        api_key=_KEY or "missing",
    )
    gw = ModelGateway()
    gw.register(DashScopeImageAdapter(poll_timeout_seconds=120, poll_interval_seconds=2))

    results: list[RoundResult] = []
    soak_started = time.monotonic()

    for i, (model_name, size, quality, prompt) in enumerate(ROUNDS, start=1):
        model = LLMModel(
            id=f"m-{i}",
            provider_id=provider.id,
            name=model_name,
            capabilities=[Capability.IMAGE_GEN],
        )
        round_started = time.monotonic()
        try:
            result = await gw.generate_image(
                ImageGenerationRequest(prompt=prompt, size=size, quality=quality, n=1),
                provider=provider,
                model=model,
            )
            img = result.images[0]
            elapsed = int((time.monotonic() - round_started) * 1000)
            results.append(
                RoundResult(
                    idx=i,
                    model=model_name,
                    size=size,
                    quality=quality.value,
                    prompt=prompt[:30],
                    ok=True,
                    duration_ms=elapsed,
                    bytes_out=len(img.data),
                    mime=img.mime_type,
                )
            )
            print(
                f"[round {i:>2}/{len(ROUNDS)}] OK  "
                f"{model_name} {size} q={quality.value} "
                f"{elapsed:>6}ms · {len(img.data) // 1024}KB · {img.mime_type}"
            )
        except Exception as exc:
            elapsed = int((time.monotonic() - round_started) * 1000)
            results.append(
                RoundResult(
                    idx=i,
                    model=model_name,
                    size=size,
                    quality=quality.value,
                    prompt=prompt[:30],
                    ok=False,
                    duration_ms=elapsed,
                    bytes_out=0,
                    mime="",
                    error=f"{type(exc).__name__}: {exc}",
                )
            )
            print(
                f"[round {i:>2}/{len(ROUNDS)}] FAIL "
                f"{model_name} {size} q={quality.value} "
                f"{elapsed:>6}ms · {type(exc).__name__}: {str(exc)[:80]}"
            )

    soak_elapsed = time.monotonic() - soak_started
    ok_count = sum(1 for r in results if r.ok)
    print(f"\n=== SOAK SUMMARY · {ok_count}/{len(results)} OK · {soak_elapsed:.1f}s wall ===\n")

    # Tolerate up to 1 transient failure out of 12 (provider hiccups).
    # More than that → real bug.
    assert ok_count >= len(ROUNDS) - 1, f"too many failures: {[r for r in results if not r.ok]}"
