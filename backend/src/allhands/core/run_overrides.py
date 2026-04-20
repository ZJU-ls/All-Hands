"""Per-turn run overrides the caller can attach to a single send_message.

Kept in `core/` so both `api/` (schema ingestion) and `execution/` (runner
consumption) can import without crossing the layering contract
(CLAUDE.md §6.3: api → core, execution → core, never api → execution).

Semantics: every field is optional. `None` means "inherit default" — the
runner won't apply a zero / empty replacement that would surprise the
model. A `thinking` override is forwarded as a model kwarg when set;
providers that don't understand it drop the kwarg silently.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class RunOverrides(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    thinking: bool | None = None
    temperature: float | None = None
    top_p: float | None = None
    max_tokens: int | None = None
    system_override: str | None = None

    def is_empty(self) -> bool:
        return all(getattr(self, f) is None for f in self.model_fields)
