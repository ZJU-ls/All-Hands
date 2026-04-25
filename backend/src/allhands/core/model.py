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

from pydantic import BaseModel, Field


class LLMModel(BaseModel):
    id: str
    provider_id: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1, max_length=128)
    display_name: str = Field(default="")
    context_window: int = Field(default=0, ge=0)
    enabled: bool = True
    is_default: bool = False
