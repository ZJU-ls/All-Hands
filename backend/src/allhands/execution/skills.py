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

import typing
from collections.abc import Callable
from pathlib import Path
from typing import TYPE_CHECKING

import yaml

from allhands.core import Employee, Skill, SkillDescriptor, SkillRuntime, SkillSource, Tool
from allhands.core.skill_runtime import DESCRIPTOR_MAX_CHARS as _DESCRIPTOR_MAX_CHARS

# Re-export so existing `from allhands.execution.skills import SkillRuntime / SkillDescriptor`
# imports keep working. ADR 0011 moved the domain models into `core/` so
# `persistence/` can import them without breaking the layering contract.
__all__ = [
    "SkillDescriptor",
    "SkillRegistry",
    "SkillRuntime",
    "bootstrap_employee_runtime",
    "expand_skills_to_tools",
    "load_installed_skills",
    "render_skill_descriptors",
    "seed_skills",
]

if TYPE_CHECKING:
    from allhands.execution.registry import ToolRegistry


_BUILTIN_SKILLS_ROOT = Path(__file__).resolve().parents[3] / "skills" / "builtin"


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
            path=str(skill_dir),
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


class _InstalledSkillRepo(typing.Protocol):  # pragma: no cover - structural
    async def list_all(self) -> list[Skill]: ...


async def load_installed_skills(registry: SkillRegistry, repo: _InstalledSkillRepo) -> int:
    """Pull installed skills (market / github / upload) out of the SkillRepo
    and register them into the shared SkillRegistry.

    Built-in rows are skipped — `seed_skills()` owns that path and reads from
    ``skills/builtin/*/SKILL.yaml`` so the descriptor / prompt_fragment stay
    in sync with the on-disk source of truth. Re-registering here would
    clobber the lazy loader with a stale DB copy.

    Idempotent: re-calling on the same repo re-registers the same ids
    (dict-based, so no duplicates).

    Returns the count of installed skills registered this call.
    """
    skills = await repo.list_all()
    count = 0
    for skill in skills:
        if skill.source == SkillSource.BUILTIN:
            continue
        registry.register(skill)
        count += 1
    return count


def bootstrap_employee_runtime(
    employee: Employee,
    skill_registry: SkillRegistry,
    tool_registry: ToolRegistry,
) -> SkillRuntime:
    """Start-of-conversation scaffolding · contract § 8.1.

    Descriptors always load; fragment + tool_ids are lazy via `resolve_skill`
    for normal employees. **Lead Agent (E22) auto-resolves every mounted
    skill at turn 0** — the LangGraph `create_react_agent` binds the tool
    list at agent creation, so a mid-turn `resolve_skill` wouldn't actually
    make the newly unlocked tools callable in the same turn (we saw this
    as "Error: create_employee is not a valid tool" right after a successful
    resolve_skill). Lead is the one employee where skill = declarative
    capability pack (organization, documentation, per-install toggle) and
    mid-turn activation is not needed — so eagerly materialize at turn 0
    and keep the react loop simple.
    """
    del tool_registry  # signature symmetry with expand_skills_to_tools
    descriptors: list[SkillDescriptor] = []
    resolved_skills: dict[str, list[str]] = {}
    resolved_fragments: list[str] = []
    for sid in employee.skill_ids:
        d = skill_registry.get_descriptor(sid)
        if d is None:
            continue
        descriptors.append(d)
        if employee.is_lead_agent:
            # Eager materialize: grab the full skill body now.
            skill = skill_registry.get_full(sid)
            if skill is not None:
                resolved_skills[sid] = list(skill.tool_ids)
                if skill.prompt_fragment:
                    resolved_fragments.append(skill.prompt_fragment)

    return SkillRuntime(
        base_tool_ids=list(employee.tool_ids),
        skill_descriptors=descriptors,
        resolved_skills=resolved_skills,
        resolved_fragments=resolved_fragments,
    )


def render_skill_descriptors(descriptors: list[SkillDescriptor]) -> str:
    """Format for injection into the system prompt at turn 0 (contract § 8.4).

    Wording matters: weaker / Chinese-hosted models (Qwen / GLM /
    DashScope) tend to **echo function-call-shaped strings as plain
    text** when the prompt itself contains them. We previously had
    ``call resolve_skill("<id>") to activate`` — every other turn the
    model would write back ``resolve_skill("allhands.artifacts")`` as a
    chat message instead of emitting a real ``tool_use`` block, and the
    user saw a literal-looking pseudo-call where they expected the
    artifact / file / etc. to actually be created.

    This rewrite (a) avoids the literal ``name(args)`` mimicry trap,
    (b) tells the model explicitly that ``resolve_skill`` is a registered
    tool to *call*, and (c) lists the available ``skill_id`` values
    clearly so the tool-call argument is obvious. The "DO NOT type the
    call as text" sentence is the cheap belt-and-braces against models
    that still try to.
    """
    if not descriptors:
        return ""
    lines = [
        "## Available Skills",
        "",
        "When the user's request matches one of these, invoke the "
        "**`resolve_skill` tool** (it is registered in your tools list) "
        "with the matching `skill_id`. This activates the skill's tools "
        "and prompt fragment for the rest of the conversation. Do NOT "
        "write the call as plain text — emit a real tool call.",
        "",
        "Available skill_id values:",
    ]
    for d in descriptors:
        lines.append(f"- `{d.id}` — {d.description}")
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
