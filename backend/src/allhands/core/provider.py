"""LLMProvider domain model — runtime-configurable LLM endpoint.

Cleaned up 2026-04-25: `default_model` and `is_default` were removed in
favor of `LLMModel.is_default` as the single source of truth for "what is
the default for the workspace". A provider used to have to commit to a
default model name string at creation time, before any models were
registered, which produced unreliable defaults whose target didn't exist.
The default is now expressed as a singleton flag on a real model row, so
references are always FK-checked.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from allhands.core.provider_presets import ProviderKind


class LLMProvider(BaseModel):
    id: str
    name: str = Field(..., min_length=1, max_length=128)
    kind: ProviderKind = "openai"
    base_url: str = Field(..., min_length=1)
    api_key: str = Field(default="")
    enabled: bool = True
