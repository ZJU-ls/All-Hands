"""LLMModel — a specific model hosted by an LLMProvider.

A Provider is the endpoint (base_url + api_key). A Model is a named model
served by that provider (e.g. "gpt-4o-mini"). The split mirrors Dify-style
two-step config: configure provider once, then register models under it.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class LLMModel(BaseModel):
    id: str
    provider_id: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1, max_length=128)
    display_name: str = Field(default="")
    context_window: int = Field(default=0, ge=0)
    enabled: bool = True
