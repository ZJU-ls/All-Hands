"""Modality enum · L4 core · pydantic-only.

The "modality" axis decouples *what kind of generation* from *who produces
it*. A model has 1+ Capabilities (chat, image_gen, video_gen, audio_gen,
embedding); an Adapter handles 1 Modality and dispatches the wire-format
work for one or more (provider_kind, model_pattern) combinations.

Symmetric extension of Capability (core/model.py): Capability lives on a
*model row* so the picker can filter "models that can do X"; Modality lives
on the *adapter / request shape* so the gateway can route "this request
needs a Modality.IMAGE adapter".

Reference:
- product/research/sandbox/MODEL-GATEWAY.html § 3.1 (this file)
- LiteLLM / OpenRouter / Vercel AI SDK 6 — same modality axis
"""

from __future__ import annotations

from enum import StrEnum

from allhands.core.model import Capability


class Modality(StrEnum):
    """Distinct generation kinds the gateway routes."""

    TEXT = "text"  # chat completion · streaming text
    IMAGE = "image"  # text-to-image · image-edit
    VIDEO = "video"  # text-to-video · image-to-video
    AUDIO = "audio"  # TTS · STT
    EMBEDDING = "embedding"  # text → vector


# 1-to-1 map · a Capability is "the model OUTPUTS this Modality".
# Used by the gateway to filter candidate models by required modality.
CAPABILITY_TO_MODALITY: dict[Capability, Modality] = {
    Capability.CHAT: Modality.TEXT,
    Capability.IMAGE_GEN: Modality.IMAGE,
    Capability.VIDEO_GEN: Modality.VIDEO,
    Capability.SPEECH: Modality.AUDIO,
    Capability.EMBEDDING: Modality.EMBEDDING,
}


# Inverse · which Capability does a request for this Modality need on the model?
MODALITY_TO_CAPABILITY: dict[Modality, Capability] = {
    v: k for k, v in CAPABILITY_TO_MODALITY.items()
}


__all__ = [
    "CAPABILITY_TO_MODALITY",
    "MODALITY_TO_CAPABILITY",
    "Modality",
]
