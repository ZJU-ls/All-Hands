"""Skill context budget reporter.

Run: ``uv run python scripts/skill_context_budget.py``

Prints per-skill context cost in tokens (approx) so we can track
descriptor budget pressure over time. Useful when the Lead config
grows past ~12 packs and we need to decide what to demote.
"""

from __future__ import annotations

from allhands.execution.skills import SkillRegistry, seed_skills


def approx_tokens(s: str) -> int:
    """Cheap token approximation: 4 chars / token for English, 2 for CJK
    mixed. Good enough for sanity reporting; doesn't replace tiktoken."""
    if not s:
        return 0
    cjk = sum(1 for c in s if ord(c) > 0x4E00)
    ascii_ish = len(s) - cjk
    return cjk // 2 + ascii_ish // 4


def main() -> None:
    reg = SkillRegistry()
    seed_skills(reg)

    descriptors = reg.list_descriptors()
    descriptor_total = sum(approx_tokens(f"{d.name}: {d.description}") for d in descriptors)

    full = reg.list_all()
    body_total = sum(approx_tokens(s.prompt_fragment or "") for s in full)
    tool_count_total = sum(len(s.tool_ids) for s in full)

    print(f"=== Skill Context Budget Report ({len(descriptors)} skills) ===")
    print()
    print(f"{'skill':40s} {'desc-tok':>9s} {'body-tok':>9s} {'tools':>6s}")
    print("-" * 70)
    for s in sorted(full, key=lambda x: x.id):
        desc = next((d for d in descriptors if d.id == s.id), None)
        desc_tok = approx_tokens(f"{desc.name}: {desc.description}") if desc else 0
        body_tok = approx_tokens(s.prompt_fragment or "")
        print(f"{s.id:40s} {desc_tok:>9d} {body_tok:>9d} {len(s.tool_ids):>6d}")
    print("-" * 70)
    print(f"{'TOTAL':40s} {descriptor_total:>9d} {body_total:>9d} {tool_count_total:>6d}")
    print()
    print("Read:")
    print(f"  · descriptor 总开销 {descriptor_total} token (turn 0 永驻 system prompt)")
    print(f"  · 全部激活后 body 总量 {body_total} token (实际用到才付费)")
    print(f"  · 跨所有 skill {tool_count_total} 个 tool · 每个 schema avg ~250 tok")
    print(f"  · 暴力路径(全部展开)≈ {descriptor_total + body_total + tool_count_total * 250} token")
    print(
        f"  · 实际 progressive 路径 ≈ {descriptor_total} + 单激活 body + 单激活 tools "
        f"= ~ {descriptor_total + body_total // len(full) + 5 * 250} (典型一对话激活 ~1 个 skill)"
    )


if __name__ == "__main__":
    main()
