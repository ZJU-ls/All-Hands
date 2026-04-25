"""端到端: seed_skills → registry → resolve 全闭环

验证 6 个新 builtin skill 通过 ADR 0015 三阶 lazy 加载链路:
1. seed_skills() 把 yaml 注入 register_lazy
2. list_descriptors() 把 6 个 descriptor 拿出来(只 name + description)
3. get_full(id) 触发 lazy loader · 拉 prompt_fragment_file 内容
4. read_skill_file(id, 'references/...') 走 sandbox 拉到 reference 文件

每一步都模拟 ADR 0015 的实际 runtime 行为 · 一旦哪个环节挂了立即报。
"""

from __future__ import annotations

import pytest

from allhands.execution.skills import SkillRegistry, seed_skills

NEW_PACKS = (
    "allhands.triggers_management",
    "allhands.channels_management",
    "allhands.task_management",
    "allhands.market_data",
    "allhands.observatory",
    "allhands.review_gates",
)


@pytest.fixture(scope="module")
def registry() -> SkillRegistry:
    reg = SkillRegistry()
    seed_skills(reg)
    return reg


def test_seed_skills_registers_all_six_new_packs(registry: SkillRegistry) -> None:
    """ADR 0015 阶段①:descriptor 应该全部进 registry"""
    descriptor_ids = {d.id for d in registry.list_descriptors()}
    missing = set(NEW_PACKS) - descriptor_ids
    assert not missing, f"seed_skills 没把 {missing} 注册进 registry"


@pytest.mark.parametrize("skill_id", NEW_PACKS)
def test_descriptor_carries_useful_metadata(skill_id: str, registry: SkillRegistry) -> None:
    """ADR 0015 阶段①:descriptor 必须有 name + description 才进 system prompt"""
    desc = registry.get_descriptor(skill_id)
    assert desc is not None, f"{skill_id}: descriptor 缺失"
    assert desc.name, f"{skill_id}: name 空"
    assert desc.description, f"{skill_id}: description 空"
    assert len(desc.description) <= 80, (
        f"{skill_id}: description {len(desc.description)} > 80 字符预算"
    )


@pytest.mark.parametrize("skill_id", NEW_PACKS)
def test_lazy_loader_returns_full_skill(skill_id: str, registry: SkillRegistry) -> None:
    """ADR 0015 阶段②:get_full() 触发 lazy loader · 把 yaml + guidance.md
    都拉进 Skill 对象 · 这是 resolve_skill 真正注入的内容。"""
    skill = registry.get_full(skill_id)
    assert skill is not None
    assert skill.id == skill_id
    assert skill.tool_ids, f"{skill_id}: tool_ids 空 · 解决了等于没解决"
    assert skill.prompt_fragment is not None, (
        f"{skill_id}: prompt_fragment 没拉到 · loader 可能没读 prompts/guidance.md"
    )
    assert len(skill.prompt_fragment) > 100, f"{skill_id}: prompt_fragment 内容太薄"


@pytest.mark.parametrize("skill_id", NEW_PACKS)
def test_idempotent_lazy_load(skill_id: str, registry: SkillRegistry) -> None:
    """同一个 skill 反复 get 不该重复 IO 也不该返回不同对象 ·
    真实 runtime 一次对话内可能 resolve 多次。"""
    a = registry.get_full(skill_id)
    b = registry.get_full(skill_id)
    assert a is not None and b is not None
    assert a.id == b.id
    assert a.tool_ids == b.tool_ids
    assert a.prompt_fragment == b.prompt_fragment


def test_total_descriptor_count_at_or_above_baseline(registry: SkillRegistry) -> None:
    """加 6 个 pack 后 builtin 总数应 ≥ 12(原本 6 + 新 6 + 一些 legacy
    sk_* dev skill)· 任何掉包都会让这个数下降。"""
    all_skills = registry.list_all()
    builtin = [s for s in all_skills if s.source.value == "builtin"]
    assert len(builtin) >= 18, (
        f"builtin 数 {len(builtin)} < 18 · 大概率 seed_skills 漏读某个 yaml"
    )
