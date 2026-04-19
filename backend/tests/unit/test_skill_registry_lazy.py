"""Phase 1 · SkillRegistry lazy descriptor API + bootstrap_employee_runtime.

Spec: docs/specs/agent-runtime-contract.md § 8.1 + § 8.4.
Issue: I-0022 Phase 1 acceptance criterion.

Reference: ref-src-claude/V05-skills-system.md § 2.1 getSkillDirCommands
memoize pattern; only descriptors are materialized until activation.
"""

from __future__ import annotations

from datetime import UTC, datetime

from allhands.core import Employee, Skill
from allhands.execution.registry import ToolRegistry
from allhands.execution.skills import (
    SkillDescriptor,
    SkillRegistry,
    SkillRuntime,
    bootstrap_employee_runtime,
    render_skill_descriptors,
    seed_skills,
)
from allhands.execution.tools import discover_builtin_tools


def _emp(skill_ids: list[str], tool_ids: list[str] | None = None) -> Employee:
    return Employee(
        id="e1",
        name="e1",
        description="",
        system_prompt="base",
        model_ref="openai/gpt-4o-mini",
        tool_ids=tool_ids or [],
        skill_ids=skill_ids,
        created_by="user",
        created_at=datetime.now(UTC),
    )


def _skill(sid: str, desc: str, tools: list[str], fragment: str | None = None) -> Skill:
    return Skill(
        id=sid,
        name=sid,
        description=desc,
        tool_ids=tools,
        prompt_fragment=fragment,
        version="0.1.0",
    )


def test_get_descriptor_returns_lightweight_record() -> None:
    """get_descriptor returns {id, name, description} — no tool_ids / no prompt_fragment."""
    reg = SkillRegistry()
    reg.register(
        _skill(
            "sk_x", "Research the web using fetch_url.", ["allhands.builtin.fetch_url"], "big frag"
        )
    )
    d = reg.get_descriptor("sk_x")
    assert d is not None
    assert isinstance(d, SkillDescriptor)
    assert d.id == "sk_x"
    assert d.name == "sk_x"
    assert "Research" in d.description
    assert not hasattr(d, "tool_ids"), "descriptor must not leak tool_ids"
    assert not hasattr(d, "prompt_fragment"), "descriptor must not leak prompt_fragment"


def test_skill_descriptor_truncates_description_to_50_chars() -> None:
    """Descriptor's description stamped into system prompt MUST be ≤ 50 chars (contract § 8.4)."""
    long = "A " * 100  # 200 chars
    reg = SkillRegistry()
    reg.register(_skill("sk_long", long, []))
    d = reg.get_descriptor("sk_long")
    assert d is not None
    assert len(d.description) <= 50


def test_registry_lazy_loader_only_invoked_on_get_full() -> None:
    """register_lazy: get_descriptor is cheap; get_full triggers loader once (memoized)."""
    calls = {"n": 0}

    def loader() -> Skill:
        calls["n"] += 1
        return _skill("sk_lazy", "lazy skill", ["allhands.builtin.fetch_url"], "fragment")

    reg = SkillRegistry()
    reg.register_lazy(
        SkillDescriptor(id="sk_lazy", name="sk_lazy", description="lazy skill"), loader
    )

    # get_descriptor is O(1) and does not hit loader.
    assert reg.get_descriptor("sk_lazy") is not None
    assert reg.get_descriptor("sk_lazy") is not None
    assert calls["n"] == 0, "descriptor read must not trigger full load"

    # get_full loads once, second call returns cached.
    full_a = reg.get_full("sk_lazy")
    full_b = reg.get_full("sk_lazy")
    assert calls["n"] == 1, "loader invoked exactly once (memoized)"
    assert full_a is full_b or full_a == full_b


def test_bootstrap_employee_runtime_skips_eager_expansion() -> None:
    """bootstrap_employee_runtime returns descriptors only — resolved_skills empty at turn 0."""
    tool_reg = ToolRegistry()
    discover_builtin_tools(tool_reg)
    skill_reg = SkillRegistry()
    seed_skills(skill_reg)

    emp = _emp(skill_ids=["sk_research", "sk_write"])
    runtime = bootstrap_employee_runtime(emp, skill_reg, tool_reg)

    assert isinstance(runtime, SkillRuntime)
    assert runtime.base_tool_ids == list(emp.tool_ids)
    # Descriptors for all mounted skills present.
    ids = {d.id for d in runtime.skill_descriptors}
    assert {"sk_research", "sk_write"} <= ids
    # Nothing resolved yet — that happens only via resolve_skill meta tool.
    assert runtime.resolved_skills == {}
    assert runtime.resolved_fragments == []


def test_token_budget_drops_from_3000_to_600() -> None:
    """10-skill employee: descriptor-only prompt chunk << eager expanded fragment.

    Per contract § 8.4: system prompt token budget must drop from ~3000 to ~600.
    Token estimate via chars // 4 (OpenAI BPE rule-of-thumb).
    """
    # Each skill ships a realistic prompt fragment (~300 chars) and 3 tool_ids.
    realistic_fragment = (
        "You excel at a specialized task. Follow the required output schema precisely. "
        "Cite sources when appropriate and prefer structured over prose responses. "
        "Avoid unnecessary detours; stay focused on the user's original question. "
        "Return concise markdown unless the user requests otherwise."
    )
    assert 250 <= len(realistic_fragment) <= 400, "fragment calibration"

    skill_reg = SkillRegistry()
    for i in range(10):
        skill_reg.register(
            _skill(
                sid=f"sk_{i}",
                desc=f"Skill number {i} · short one-liner.",
                tools=["allhands.builtin.fetch_url", "allhands.builtin.write_file"],
                fragment=realistic_fragment,
            )
        )
    tool_reg = ToolRegistry()
    discover_builtin_tools(tool_reg)
    emp = _emp(skill_ids=[f"sk_{i}" for i in range(10)])

    # Before (eager): expand_skills_to_tools concatenates all fragments.
    from allhands.execution.skills import expand_skills_to_tools

    _, eager_fragment = expand_skills_to_tools(emp, skill_reg, tool_reg)
    eager_tokens = len(eager_fragment) // 4

    # After (lazy): bootstrap produces descriptors only; render chunk is tiny.
    runtime = bootstrap_employee_runtime(emp, skill_reg, tool_reg)
    lazy_chunk = render_skill_descriptors(runtime.skill_descriptors)
    lazy_tokens = len(lazy_chunk) // 4

    # Hard assertions matching contract § 8.4.
    assert eager_tokens >= 700, f"baseline must be large; got {eager_tokens}"
    assert lazy_tokens <= 600, f"lazy chunk must fit in 600 tokens; got {lazy_tokens}"
    assert lazy_tokens < eager_tokens // 3, "lazy must be < 1/3 of eager (clear signal)"
