"""SkillRegistry — descriptor-first lazy registry + runtime scaffolding.

Spec: docs/specs/agent-runtime-contract.md § 8.1-8.4.
Ref: ref-src-claude/V05-skills-system.md § 2.1 getSkillDirCommands memoize
pattern — only descriptors materialized until activation. § 2.3 per-command
lazy prompt load via getPromptForCommand.

Back-compat: `expand_skills_to_tools` stays for the I-0021 dry-run preview
(employee design page shows the *eager* merged view of tools + prompt).
At chat-runtime the AgentRunner uses `bootstrap_employee_runtime` +
`resolve_skill` meta tool for on-demand injection.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import TYPE_CHECKING

import yaml
from pydantic import BaseModel, Field

from allhands.core import Employee, Skill, Tool

if TYPE_CHECKING:
    from allhands.execution.registry import ToolRegistry


_BUILTIN_SKILLS_ROOT = Path(__file__).resolve().parents[3] / "skills" / "builtin"
_DESCRIPTOR_MAX_CHARS = 50


class SkillDescriptor(BaseModel):
    """Lightweight skill summary stamped into the system prompt at turn 0.

    Contract § 8.4: description ≤ 50 chars · 10 skills → ~500 chars ≈ 125 tokens.
    Intentionally does NOT carry `tool_ids` or `prompt_fragment` — those load
    only on resolve_skill activation to keep the weak-model context budget low.
    """

    id: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    description: str = Field(..., max_length=_DESCRIPTOR_MAX_CHARS)

    model_config = {"frozen": True}


class SkillRuntime(BaseModel):
    """Per-conversation mutable skill state consumed by AgentRunner.

    Contract § 8.2: AgentRunner rebuilds lc_tools and system prompt each turn
    from `base_tool_ids + flatten(resolved_skills.values()) + descriptors + fragments`.
    Ref: ref-src-claude/V02 § 2.1 `query()` main loop rebuild.
    """

    base_tool_ids: list[str] = Field(default_factory=list)
    skill_descriptors: list[SkillDescriptor] = Field(default_factory=list)
    resolved_skills: dict[str, list[str]] = Field(default_factory=dict)
    resolved_fragments: list[str] = Field(default_factory=list)


def _truncate(text: str) -> str:
    t = text.strip()
    if len(t) <= _DESCRIPTOR_MAX_CHARS:
        return t
    return t[: _DESCRIPTOR_MAX_CHARS - 1].rstrip() + "…"


class _RegistryEntry:
    """One skill entry · descriptor is cheap, full-skill load is memoized."""

    __slots__ = ("_descriptor", "_full", "_loader")

    def __init__(
        self,
        descriptor: SkillDescriptor,
        loader: Callable[[], Skill],
    ) -> None:
        self._descriptor = descriptor
        self._loader = loader
        self._full: Skill | None = None

    @property
    def descriptor(self) -> SkillDescriptor:
        return self._descriptor

    def full(self) -> Skill:
        if self._full is None:
            self._full = self._loader()
        return self._full


class SkillRegistry:
    """Registry of installed skills.

    Two registration paths:
      - `register(skill)` — eager path for code-declared skills (legacy seeds).
      - `register_lazy(descriptor, loader)` — lazy path for YAML builtins;
        the loader only runs on the first `get_full()` call (memoized).

    Ref: ref-src-claude/V05 § 2.1 · discover + memoize · body-load on activate.
    """

    def __init__(self) -> None:
        self._entries: dict[str, _RegistryEntry] = {}

    def register(self, skill: Skill) -> None:
        descriptor = SkillDescriptor(
            id=skill.id,
            name=skill.name,
            description=_truncate(skill.description),
        )

        def _eager_loader() -> Skill:
            return skill

        self._entries[skill.id] = _RegistryEntry(descriptor=descriptor, loader=_eager_loader)

    def register_lazy(
        self,
        descriptor: SkillDescriptor,
        loader: Callable[[], Skill],
    ) -> None:
        self._entries[descriptor.id] = _RegistryEntry(descriptor=descriptor, loader=loader)

    def get(self, skill_id: str) -> Skill | None:
        """Back-compat alias for `get_full` (used by existing tests + chat_service)."""
        return self.get_full(skill_id)

    def get_full(self, skill_id: str) -> Skill | None:
        entry = self._entries.get(skill_id)
        return entry.full() if entry is not None else None

    def get_descriptor(self, skill_id: str) -> SkillDescriptor | None:
        entry = self._entries.get(skill_id)
        return entry.descriptor if entry is not None else None

    def list_all(self) -> list[Skill]:
        return [e.full() for e in self._entries.values()]

    def list_descriptors(self) -> list[SkillDescriptor]:
        return [e.descriptor for e in self._entries.values()]


def _load_builtin_skill_manifest(skill_dir: Path) -> tuple[SkillDescriptor, Callable[[], Skill]]:
    """Read only SKILL.yaml metadata (cheap) and return a lazy loader for body.

    The fragment file (if any) is read lazily by `loader()` on first get_full —
    this is the direct analog of `getPromptForCommand` in V05 § 2.3.
    """
    manifest_path = skill_dir / "SKILL.yaml"
    data = yaml.safe_load(manifest_path.read_text(encoding="utf-8")) or {}
    descriptor = SkillDescriptor(
        id=str(data["id"]),
        name=str(data.get("name", data["id"])),
        description=_truncate(str(data.get("description", ""))),
    )

    def _loader() -> Skill:
        prompt_fragment: str | None = None
        fragment_file = data.get("prompt_fragment_file")
        if fragment_file:
            fragment_path = skill_dir / str(fragment_file)
            prompt_fragment = fragment_path.read_text(encoding="utf-8").strip()
        elif data.get("prompt_fragment"):
            prompt_fragment = str(data["prompt_fragment"]).strip()
        return Skill(
            id=str(data["id"]),
            name=str(data.get("name", data["id"])),
            description=str(data.get("description", "")),
            tool_ids=[str(t) for t in data.get("tool_ids", [])],
            prompt_fragment=prompt_fragment,
            version=str(data.get("version", "1.0.0")),
        )

    return descriptor, _loader


def seed_skills(registry: SkillRegistry) -> None:
    # Legacy dev skills (eager · kept for existing demos/tests).
    registry.register(
        Skill(
            id="sk_research",
            name="web_research",
            description="Research the web using fetch_url and summarize findings.",
            tool_ids=["allhands.builtin.fetch_url"],
            prompt_fragment=(
                "You are a thorough researcher. Search for information by fetching URLs, "
                "read and synthesize content carefully. Always cite the sources you used."
            ),
            version="0.1.0",
        )
    )
    registry.register(
        Skill(
            id="sk_write",
            name="file_writing",
            description="Write structured documents and save them to files.",
            tool_ids=["allhands.builtin.write_file"],
            prompt_fragment=(
                "You are a precise writer. When asked to produce a document, write it in "
                "clean markdown and save it using write_file with a descriptive filename."
            ),
            version="0.1.0",
        )
    )
    # Builtin YAML skills — lazy (contract § 8.1 · V05 memoize).
    if _BUILTIN_SKILLS_ROOT.is_dir():
        for entry in sorted(_BUILTIN_SKILLS_ROOT.iterdir()):
            if entry.is_dir() and (entry / "SKILL.yaml").exists():
                descriptor, loader = _load_builtin_skill_manifest(entry)
                registry.register_lazy(descriptor, loader)


def bootstrap_employee_runtime(
    employee: Employee,
    skill_registry: SkillRegistry,
    tool_registry: ToolRegistry,
) -> SkillRuntime:
    """Start-of-conversation scaffolding · contract § 8.1.

    Consumes only descriptors; the full skill body is materialized later by
    `resolve_skill`. This is the entry point that *replaces*
    `expand_skills_to_tools` at runtime (the eager function stays for dry-run).
    """
    del tool_registry  # signature symmetry with expand_skills_to_tools
    descriptors: list[SkillDescriptor] = []
    for sid in employee.skill_ids:
        d = skill_registry.get_descriptor(sid)
        if d is not None:
            descriptors.append(d)
    return SkillRuntime(
        base_tool_ids=list(employee.tool_ids),
        skill_descriptors=descriptors,
    )


def render_skill_descriptors(descriptors: list[SkillDescriptor]) -> str:
    """Format for injection into the system prompt at turn 0 (contract § 8.4)."""
    if not descriptors:
        return ""
    lines = ['Available skills (call resolve_skill("<id>") to activate):']
    for d in descriptors:
        lines.append(f"- {d.id}: {d.description}")
    return "\n".join(lines)


def expand_skills_to_tools(
    employee: Employee,
    skill_registry: SkillRegistry,
    tool_registry: ToolRegistry,
) -> tuple[list[Tool], str]:
    """Eager expansion — kept for I-0021 dry-run preview only.

    At chat-runtime the runner uses `bootstrap_employee_runtime` + resolve_skill.
    This path is *not* invoked by AgentRunner anymore (contract § 8.1).
    """
    seen: set[str] = set()
    tools: list[Tool] = []
    fragments: list[str] = []

    for tid in employee.tool_ids:
        if tid not in seen:
            try:
                tool, _ = tool_registry.get(tid)
                tools.append(tool)
                seen.add(tid)
            except KeyError:
                pass

    for sid in employee.skill_ids:
        skill = skill_registry.get_full(sid)
        if skill is None:
            continue
        if skill.prompt_fragment:
            fragments.append(skill.prompt_fragment)
        for tid in skill.tool_ids:
            if tid not in seen:
                try:
                    tool, _ = tool_registry.get(tid)
                    tools.append(tool)
                    seen.add(tid)
                except KeyError:
                    pass

    return tools, "\n\n".join(fragments)
