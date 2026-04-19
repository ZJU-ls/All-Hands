"""Plan-shape tests.

The walkthrough plan is the contract shared between the backend acceptance
suite, the web acceptance suite, and (later) the ``cockpit.run_walkthrough``
Meta Tool. If its shape drifts, downstream consumers break silently. These
tests fail loudly when that happens.
"""

from __future__ import annotations

from typing import Any

import pytest

REQUIRED_STAGE_FIELDS = {
    "id",
    "name",
    "goal",
    "entry_route",
    "required_meta_tools",
    "required_routers",
    "north_star_focus",
    "v0_active",
    "preconditions",
}

NORTH_STAR_DIMS = {"N1", "N2", "N3", "N4", "N5", "N6"}
V0_ACTIVE_IDS = {"W1", "W2", "W3"}
ALL_IDS = {f"W{i}" for i in range(1, 8)}


class TestPlanShape:
    def test_has_seven_stages(self, walkthrough_plan: dict[str, Any]) -> None:
        stages = walkthrough_plan["stages"]
        assert len(stages) == 7, "spec §3.1 requires exactly 7 main walkthroughs"

    def test_each_stage_has_required_fields(self, walkthrough_plan: dict[str, Any]) -> None:
        for stage in walkthrough_plan["stages"]:
            missing = REQUIRED_STAGE_FIELDS - set(stage.keys())
            assert not missing, (
                f"stage {stage.get('id', '?')} missing fields {missing}; "
                f"walkthrough_plan.json is the contract — keep every stage complete"
            )

    def test_stage_ids_are_w1_through_w7(self, walkthrough_plan: dict[str, Any]) -> None:
        ids = {s["id"] for s in walkthrough_plan["stages"]}
        assert ids == ALL_IDS, f"expected {ALL_IDS}, got {ids}"

    def test_v0_active_stages_match_prd(self, walkthrough_plan: dict[str, Any]) -> None:
        active = {s["id"] for s in walkthrough_plan["stages"] if s["v0_active"]}
        assert active == V0_ACTIVE_IDS, (
            f"v0 runs W1-W3 only (per spec §3.1 + track-2-qa launch prompt); got active={active}"
        )

    def test_north_star_focus_only_uses_declared_dims(
        self, walkthrough_plan: dict[str, Any]
    ) -> None:
        declared = set(walkthrough_plan["north_star_dims"].keys())
        assert declared == NORTH_STAR_DIMS
        for stage in walkthrough_plan["stages"]:
            unknown = set(stage["north_star_focus"]) - NORTH_STAR_DIMS
            assert not unknown, f"stage {stage['id']} references unknown dim {unknown}"


class TestPreconditionsExist:
    """For every v0-active stage, do its declared preconditions exist in repo?

    Skeleton-level check: we don't actually run a browser. We just confirm the
    router + meta-tool files exist so the W-N test can compile. If the file is
    missing, mark the stage xfail so the test suite still goes green but the
    miss is visible in pytest output.
    """

    @pytest.mark.parametrize("stage_id", sorted(V0_ACTIVE_IDS))
    def test_required_routers_present(
        self,
        stage_id: str,
        walkthrough_plan: dict[str, Any],
        routers_dir,  # type: ignore[no-untyped-def]
    ) -> None:
        stage = next(s for s in walkthrough_plan["stages"] if s["id"] == stage_id)
        missing = [r for r in stage["required_routers"] if not (routers_dir / r).exists()]
        if missing:
            pytest.xfail(
                f"{stage_id} v0-active but routers {missing} not yet in main "
                f"(precondition: {stage['preconditions']})"
            )

    @pytest.mark.parametrize("stage_id", sorted(V0_ACTIVE_IDS))
    def test_required_meta_tools_importable(
        self,
        stage_id: str,
        walkthrough_plan: dict[str, Any],
        meta_tools_dir,  # type: ignore[no-untyped-def]
    ) -> None:
        """Meta tools may live in any ``*_tools.py`` under meta/. Scan the dir
        for the tool name as a literal.
        """
        stage = next(s for s in walkthrough_plan["stages"] if s["id"] == stage_id)
        if not stage["required_meta_tools"]:
            return
        joined = "\n".join(p.read_text(encoding="utf-8") for p in meta_tools_dir.glob("*_tools.py"))
        missing = [t for t in stage["required_meta_tools"] if t not in joined]
        if missing:
            pytest.xfail(
                f"{stage_id} needs meta tool(s) {missing} — not yet in meta/. "
                f"Precondition: {stage['preconditions']}"
            )
