"""LLMProvider domain model — runtime-configurable LLM endpoint."""

from __future__ import annotations

from pydantic import BaseModel, Field

from allhands.core.provider_presets import ProviderKind


class LLMProvider(BaseModel):
    id: str
    name: str = Field(..., min_length=1, max_length=128)
    kind: ProviderKind = "openai"
    base_url: str = Field(..., min_length=1)
    api_key: str = Field(default="")
    default_model: str = Field(default="gpt-4o-mini")
    is_default: bool = False
    enabled: bool = True
