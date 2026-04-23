"""Per-conversation runtime state for the React agent (domain · L4).

Lives in `core/` rather than `execution/` so the persistence layer can
import it without violating the layering contract (see `.importlinter` and
principle 7 · state-checkpointable clause in ADR 0011).

Invariant (原则 3 · Pure-Function Query Loop): the runner does not own this
state. It reads runtime in, yields events, and the service layer persists the
mutated runtime back to `SkillRuntimeRepo` at turn boundaries. Restart resume
on the next message simply reads from the repo.

Ref:
  - ADR 0011 · principles refresh § 3 (SkillRuntime persistence)
  - product/04-architecture.md § L5.6 · Skill 展开
  - ref-src-claude/V02 § 2.1 · query() main loop — 每轮重建 context
"""

from __future__ import annotations

from pydantic import BaseModel, Field

DESCRIPTOR_MAX_CHARS = 50


class SkillDescriptor(BaseModel):
    """Lightweight skill summary stamped into the system prompt at turn 0.

    Contract § 8.4: description ≤ 50 chars · 10 skills → ~500 chars ≈ 125 tokens.
    Intentionally does NOT carry `tool_ids` or `prompt_fragment` — those load
    only on `resolve_skill` activation to keep the weak-model context budget
    predictable.
    """

    id: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    description: str = Field(..., max_length=DESCRIPTOR_MAX_CHARS)

    model_config = {"frozen": True}


class SkillRuntime(BaseModel):
    """Per-conversation mutable skill state consumed by AgentRunner.

    Contract § 8.2: AgentRunner rebuilds lc_tools and system prompt each turn
    from `base_tool_ids + flatten(resolved_skills.values()) + descriptors + fragments`.

    Persistence (ADR 0011 · v1):
      - ChatService caches by conversation_id in-process.
      - Cache miss → `SkillRuntimeRepo.load(conversation_id)`.
      - After `runner.stream()` completes (done/error), ChatService flushes the
        runtime back via `repo.save()` so a uvicorn reload doesn't wipe the
        resolved-skill pool.
      - `compact_conversation` resets both cache and repo (the old resolved set
        was built against a history the user can no longer see).
    """

    base_tool_ids: list[str] = Field(default_factory=list)
    skill_descriptors: list[SkillDescriptor] = Field(default_factory=list)
    resolved_skills: dict[str, list[str]] = Field(default_factory=dict)
    resolved_fragments: list[str] = Field(default_factory=list)
