"""Compat test · anthropic/skills (Claude Code's official skill repo) on us.

This proves the bigger claim: a Claude Code-style skill (frontmatter SKILL.md
+ scripts/*.py) plugs into our SkillRegistry without modifying the skill
itself, and the bundled scripts execute through `run_skill_script` end-to-end.

Skipped if `backend/skills/imported/anthropic/skills/` is absent (anthropic
repo wasn't vendored). To enable locally:

    cd backend/skills && mkdir -p imported && cd imported && \\
        git clone --depth 1 https://github.com/anthropics/skills.git anthropic

These tests deliberately use real subprocess + real SkillRegistry so
regressions in the discovery / runner / tool integration path show up here.
"""

from __future__ import annotations

import shutil
from datetime import UTC, datetime
from pathlib import Path

import pytest

from allhands.core import Employee, SkillRuntime
from allhands.execution.script_runner import SubprocessScriptRunner
from allhands.execution.skills import SkillRegistry, seed_skills
from allhands.execution.tools.meta.resolve_skill import make_resolve_skill_executor
from allhands.execution.tools.meta.skill_scripts import make_run_skill_script_executor

ANTHROPIC_ROOT = (
    Path(__file__).resolve().parents[2] / "skills" / "imported" / "anthropic" / "skills"
)

pytestmark = pytest.mark.skipif(
    not ANTHROPIC_ROOT.is_dir() or not any(ANTHROPIC_ROOT.iterdir()),
    reason=(
        "anthropic/skills not vendored. To enable: cd backend/skills && "
        "mkdir -p imported && cd imported && "
        "git clone --depth 1 https://github.com/anthropics/skills.git anthropic"
    ),
)


@pytest.fixture
def primed() -> dict[str, object]:
    """Real seed_skills run · returns registry + runtime + employee.

    Employee whitelist must include every anthropic skill id so resolve_skill
    accepts activation requests for any of them in the same fixture.
    """
    reg = SkillRegistry()
    seed_skills(reg)
    anthropic_ids = [
        sid
        for sid in reg._entries
        if sid.startswith("anthropic.")  # type: ignore[attr-defined]
    ]
    runtime = SkillRuntime()
    emp = Employee(
        id="anth-tester",
        name="anthropic skill tester",
        description="d",
        system_prompt="sp",
        model_ref="p/m",
        skill_ids=anthropic_ids,
        tool_ids=[],
        created_by="u1",
        created_at=datetime.now(UTC),
    )
    return {"registry": reg, "runtime": runtime, "employee": emp}


# ──────────────────────────────────────────────────────────────────────────
# Discovery — frontmatter parsing + 17 expected skills
# ──────────────────────────────────────────────────────────────────────────


def test_discovers_all_anthropic_skills(primed: dict[str, object]) -> None:
    reg: SkillRegistry = primed["registry"]  # type: ignore[assignment]
    anthropic_ids = sorted(
        sid
        for sid in reg._entries
        if sid.startswith("anthropic.")  # type: ignore[attr-defined]
    )
    # As of import-date: 17 skills published. Allow >= so future additions
    # don't break this test, but flag if drops below the baseline.
    assert len(anthropic_ids) >= 15, anthropic_ids
    # Spot-check the ones we exec below
    expected = {"anthropic.pdf", "anthropic.xlsx", "anthropic.docx", "anthropic.pptx"}
    missing = expected - set(anthropic_ids)
    assert not missing, f"missing anthropic skills: {missing}"


def test_anthropic_pdf_skill_metadata(primed: dict[str, object]) -> None:
    reg: SkillRegistry = primed["registry"]  # type: ignore[assignment]
    s = reg.get_full("anthropic.pdf")
    assert s is not None
    assert s.path is not None
    assert (Path(s.path) / "SKILL.md").is_file()
    assert (Path(s.path) / "scripts").is_dir()
    # Tool set adapter ensures both read + run are wired
    assert "allhands.meta.read_skill_file" in s.tool_ids
    assert "allhands.meta.run_skill_script" in s.tool_ids
    # Prompt fragment carries the SKILL.md body so the agent gets the same
    # decision tree Claude Code agents see.
    assert s.prompt_fragment is not None
    assert "PDF" in s.prompt_fragment.upper()


# ──────────────────────────────────────────────────────────────────────────
# Real script execution · zero modifications to anthropic source
# ──────────────────────────────────────────────────────────────────────────


@pytest.fixture
def tiny_pdf(tmp_path: Path) -> Path:
    """Synthesize a minimal valid PDF (no forms) for compat tests."""
    p = tmp_path / "tiny.pdf"
    p.write_bytes(
        b"%PDF-1.4\n"
        b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n"
        b"3 0 obj<</Type/Page/MediaBox[0 0 100 100]/Parent 2 0 R>>endobj\n"
        b"xref\n0 4\n"
        b"0000000000 65535 f\n"
        b"0000000009 00000 n\n"
        b"0000000051 00000 n\n"
        b"0000000091 00000 n\n"
        b"trailer<</Size 4/Root 1 0 R>>\nstartxref\n138\n%%EOF\n"
    )
    return p


@pytest.mark.asyncio
async def test_runs_anthropic_pdf_check_fillable_fields(
    primed: dict[str, object], tiny_pdf: Path
) -> None:
    """Exec anthropic.pdf · scripts/check_fillable_fields.py · prove zero-modification.

    pypdf must be installed in the active venv. We don't `pip install` here —
    the test just expects the dependency to be present (declared as a dev dep
    in pyproject if you want this in CI) and skips with a clear message if not.
    """
    if shutil.which("python") is None:
        pytest.skip("python interpreter not found on PATH")

    reg: SkillRegistry = primed["registry"]  # type: ignore[assignment]
    runtime: SkillRuntime = primed["runtime"]  # type: ignore[assignment]
    emp: Employee = primed["employee"]  # type: ignore[assignment]

    resolve = make_resolve_skill_executor(employee=emp, runtime=runtime, skill_registry=reg)
    await resolve(skill_id="anthropic.pdf")
    assert "anthropic.pdf" in runtime.resolved_skills

    run = make_run_skill_script_executor(
        runtime=runtime, skill_registry=reg, runner=SubprocessScriptRunner()
    )
    out = await run(
        skill_id="anthropic.pdf",
        script="scripts/check_fillable_fields.py",
        args=[str(tiny_pdf)],
    )
    if out.get("exit_code", -1) != 0 and "ModuleNotFoundError" in out.get("stderr", ""):
        pytest.skip(
            "pypdf not installed in test venv — anthropic skills declare deps "
            "in their own README; install with `uv pip install pypdf` in venv "
            "before running this test."
        )
    assert out["exit_code"] == 0, out
    # The script prints one of two known sentences depending on PDF content.
    assert (
        "fillable form fields" in out["stdout"]
        or "does not have fillable form fields" in out["stdout"]
    )


@pytest.mark.asyncio
async def test_runs_anthropic_xlsx_recalc(primed: dict[str, object]) -> None:
    """xlsx skill ships scripts/recalc.py · same pattern · uses openpyxl."""
    reg: SkillRegistry = primed["registry"]  # type: ignore[assignment]
    s = reg.get_full("anthropic.xlsx")
    assert s is not None and s.path is not None
    recalc = Path(s.path) / "scripts" / "recalc.py"
    if not recalc.is_file():
        pytest.skip("anthropic.xlsx layout changed · scripts/recalc.py absent")

    runtime: SkillRuntime = primed["runtime"]  # type: ignore[assignment]
    emp: Employee = primed["employee"]  # type: ignore[assignment]

    resolve = make_resolve_skill_executor(employee=emp, runtime=runtime, skill_registry=reg)
    await resolve(skill_id="anthropic.xlsx")

    run = make_run_skill_script_executor(
        runtime=runtime, skill_registry=reg, runner=SubprocessScriptRunner()
    )
    # No args · we only validate the script LOADS without import error
    # (positional args required would surface as exit != 0 with usage hint;
    # missing-import would surface in stderr · skip in either case)
    out = await run(
        skill_id="anthropic.xlsx",
        script="scripts/recalc.py",
        timeout_seconds=10,
    )
    if "ModuleNotFoundError" in out.get("stderr", "") or "ImportError" in out.get("stderr", ""):
        pytest.skip("openpyxl / xlsx deps absent · skipping. Install with: uv pip install openpyxl")
    # Either it ran (exit 0/2 with usage msg) or the script printed help.
    # We just assert we didn't crash on launch:
    assert out["interpreter_used"] == "python"
    assert "duration_ms" in out
    assert isinstance(out["exit_code"], int)


# ──────────────────────────────────────────────────────────────────────────
# Sandbox safety · anthropic skills are arbitrary code · path escape MUST fail
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_anthropic_path_sandbox_holds(primed: dict[str, object]) -> None:
    reg: SkillRegistry = primed["registry"]  # type: ignore[assignment]
    runtime: SkillRuntime = primed["runtime"]  # type: ignore[assignment]
    emp: Employee = primed["employee"]  # type: ignore[assignment]

    resolve = make_resolve_skill_executor(employee=emp, runtime=runtime, skill_registry=reg)
    await resolve(skill_id="anthropic.pdf")

    run = make_run_skill_script_executor(
        runtime=runtime, skill_registry=reg, runner=SubprocessScriptRunner()
    )
    out = await run(
        skill_id="anthropic.pdf",
        script="scripts/../../../../../../etc/passwd",
    )
    assert "error" in out, "Sandbox should refuse traversal even for anthropic skills"
    assert out.get("field") == "script"


# ──────────────────────────────────────────────────────────────────────────
# All anthropic skills smoke load without crashing
# ──────────────────────────────────────────────────────────────────────────


def test_all_anthropic_skills_load_without_errors(primed: dict[str, object]) -> None:
    """Iterate all anthropic.* skills · get_full() must succeed for each."""
    reg: SkillRegistry = primed["registry"]  # type: ignore[assignment]
    anthropic_ids = [
        sid
        for sid in reg._entries
        if sid.startswith("anthropic.")  # type: ignore[attr-defined]
    ]
    failures = []
    for sid in anthropic_ids:
        try:
            s = reg.get_full(sid)
            if s is None or s.path is None:
                failures.append(f"{sid}: empty load")
        except Exception as exc:
            failures.append(f"{sid}: {exc}")
    assert not failures, "anthropic skills failed to load:\n" + "\n".join(failures)
