"""LLMModel — a specific model hosted by an LLMProvider.

A Provider is the endpoint (base_url + api_key). A Model is a named model
served by that provider (e.g. "gpt-4o-mini"). The split mirrors Dify-style
two-step config: configure provider once, then register models under it.

`is_default` is the **system-wide singleton pointer** for "what does Lead
Agent use when nothing else is specified". At most one model has it=True
across the whole installation. The constraint is enforced at the service
layer (`set_default_model` clears the prior winner inside one transaction)
rather than as a partial unique index, because every supported DB engine
has different syntax for "WHERE is_default = TRUE" partial indexes — a
domain invariant lives better in service code anyway.

This replaces the older two-field design (`provider.is_default` +
`provider.default_model: str`) which could desync — typing a model name on
the provider that didn't actually exist as a registered LLMModel produced
silent broken state. The new shape makes "default" a real FK relationship.
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field


class Capability(StrEnum):
    """What this model can do · drives picker filters and tool routing.

    Symmetric extension to LLMModel that lets the same provider host
    multiple model kinds (OpenAI: gpt-4o-mini for chat + gpt-image-1.5 for
    images) without forking provider tables. Unknown values from old DB
    rows degrade to ``[CHAT]`` (the safe default).

    Image / speech / embedding consumers filter the model list with
    ``Capability in m.capabilities``. Tool layer raises a structured
    ToolArgError when the agent asks for an image gen via a chat-only
    model — see ADR 0021.
    """

    CHAT = "chat"
    IMAGE_GEN = "image_gen"
    SPEECH = "speech"  # reserved · TTS / STT
    EMBEDDING = "embedding"  # reserved · vector embeddings


class LLMModel(BaseModel):
    id: str
    provider_id: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1, max_length=128)
    display_name: str = Field(default="")
    context_window: int = Field(default=0, ge=0)
    # Optional explicit caps overriding model-default behavior. None means
    # "don't constrain" — request goes out without a max_tokens hint, and the
    # composer's budget chip falls back to context_window. Three vendor numbers
    # (total / input / output) are kept distinct so the chip denominator can
    # use the actual input cap rather than the conflated total.
    max_input_tokens: int | None = Field(default=None, ge=1)
    max_output_tokens: int | None = Field(default=None, ge=1)
    enabled: bool = True
    is_default: bool = False
    # Vision capability — whether the model accepts image_url / image content
    # parts in HumanMessage. False default; whitelisted on seed for known
    # vision models (claude-3+, gpt-4o+, qwen-vl-*, gemini, deepseek-vl).
    # Drives AgentLoop multimodal projection: when an attachment is an image
    # and supports_images=False, the loop falls back to text injection
    # (filename + dimensions + auto-alt + OCR if enabled).
    supports_images: bool = False
    # 2026-04-28 · capabilities make the model picker capability-aware. Old
    # rows migrate to [CHAT] via alembic 0033 server_default; new rows can
    # opt into [IMAGE_GEN] for OpenAI gpt-image-1.5 / DashScope wanx /
    # Imagen / Flux. The list shape (vs single enum) anticipates models that
    # could one day support both — not common today but cheap to allow.
    # NOTE: distinct from supports_images (vision/input) — capabilities is
    # what the model OUTPUTS (chat / image_gen / speech / embedding).
    capabilities: list[Capability] = Field(default_factory=lambda: [Capability.CHAT])
