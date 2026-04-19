"""Regressions for the track-2-qa audit findings.

Each test maps 1:1 to an open issue in ``docs/issues/open/`` discovered during
the 2026-04-19 audit. While the issue is open the assertion xfails with the
issue ID and the exact expectation — so every ``check.sh`` run surfaces the
list of outstanding audit gaps without blocking CI.

When an issue is fixed, flip the corresponding ``pytest.xfail`` to a plain
``assert`` so a future regression fails loudly. Then close the issue per
``docs/issues/README.md``.

Out of scope: P2 polish items (I-0012, I-0013, I-0014) — they are tracked by
issue filings alone.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# I-0005 · artifact_changed SSE event never emitted
# ---------------------------------------------------------------------------


def test_i0005_artifact_changed_event_emitted(repo_root: Path) -> None:
    """The string ``artifact_changed`` / ``ArtifactChanged`` must appear in
    ``execution/events.py`` (event shape declared) and in ``artifact_service.py``
    (service publishes on every write path). Closed 2026-04-19 by fix-artifacts-sse.
    """
    events = repo_root / "backend" / "src" / "allhands" / "execution" / "events.py"
    service = repo_root / "backend" / "src" / "allhands" / "services" / "artifact_service.py"
    events_text = events.read_text(encoding="utf-8")
    service_text = service.read_text(encoding="utf-8")

    assert "artifact_changed" in events_text or "ArtifactChanged" in events_text, (
        "I-0005 regression: ArtifactChangedEvent removed from execution/events.py"
    )
    assert "artifact_changed" in service_text or "ArtifactChanged" in service_text, (
        "I-0005 regression: ArtifactService no longer publishes artifact_changed"
    )


# ---------------------------------------------------------------------------
# I-0006 · Cockpit frontend polls, does not consume SSE stream
# ---------------------------------------------------------------------------


def test_i0006_cockpit_consumes_sse(repo_root: Path) -> None:
    cockpit = repo_root / "web" / "components" / "cockpit" / "Cockpit.tsx"
    text = cockpit.read_text(encoding="utf-8") if cockpit.exists() else ""
    # When fixed, Cockpit.tsx subscribes to an EventSource pointing at the
    # stream endpoint and the setInterval polling loop is gone.
    uses_event_source = "EventSource" in text or "/api/cockpit/stream" in text
    still_polls = "setInterval" in text and "POLL_MS" in text
    if not uses_event_source or still_polls:
        pytest.xfail(
            "I-0006: cockpit Cockpit.tsx still polls every POLL_MS; SSE stream at "
            "/api/cockpit/stream is built but never consumed"
        )


# ---------------------------------------------------------------------------
# I-0007 · Shared state components (EmptyState / ErrorState / LoadingState / FirstRun)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("component", ["EmptyState", "ErrorState", "LoadingState", "FirstRun"])
def test_i0007_state_component_exists(repo_root: Path, component: str) -> None:
    hits = list((repo_root / "web" / "components").rglob(f"{component}.tsx"))
    if not hits:
        pytest.xfail(
            f"I-0007: {component} component not built — visual-upgrade DoD "
            f"(no raw Loading/Error/No data) cannot be enforced"
        )


# ---------------------------------------------------------------------------
# I-0009 · architecture doc drift (triggers L5.9 · cockpit L7.1/L8.1)
# ---------------------------------------------------------------------------


def test_i0009_arch_doc_updated_for_triggers_and_cockpit(repo_root: Path) -> None:
    arch = (repo_root / "product" / "04-architecture.md").read_text(encoding="utf-8")
    has_triggers_section = bool(re.search(r"L5\.9|Triggers & Event Bus", arch))
    has_cockpit_api = "/api/cockpit" in arch or "cockpit.stream" in arch
    if not (has_triggers_section and has_cockpit_api):
        pytest.xfail(
            "I-0009: product/04-architecture.md missing L5.9 triggers section and/or "
            "cockpit API rows. New contributors cannot discover these via the arch map."
        )


# ---------------------------------------------------------------------------
# I-0010 · raw state literals still present
# ---------------------------------------------------------------------------

_RAW_STATE_RE = re.compile(r'"(?:Loading\.\.\.|No data|No data\.)"')


def test_i0010_no_raw_state_literals(repo_root: Path) -> None:
    app = repo_root / "web" / "app"
    components = repo_root / "web" / "components"
    offenders: list[str] = []
    for root in (app, components):
        if not root.exists():
            continue
        for path in root.rglob("*.tsx"):
            if "components/state" in str(path):
                continue
            if _RAW_STATE_RE.search(path.read_text(encoding="utf-8")):
                offenders.append(str(path.relative_to(repo_root)))
    if offenders:
        pytest.xfail(
            f"I-0010: raw state literals in {len(offenders)} file(s); first 3: "
            f"{offenders[:3]} — move to <EmptyState>/<LoadingState> once I-0007 lands"
        )


# ---------------------------------------------------------------------------
# I-0011 · missing integration / e2e tests across 5 specs
# ---------------------------------------------------------------------------

_REQUIRED_TESTS = [
    "backend/tests/integration/test_lead_agent_flow.py",
    "backend/tests/integration/test_artifacts_sse.py",
    "backend/tests/integration/events/test_event_projection.py",
    "web/tests/e2e/design-lab-viz.spec.ts",
    "web/tests/e2e/artifacts-flow.spec.ts",
    "web/tests/e2e/employee-chat.spec.ts",
    "web/tests/e2e/nested-run-display.spec.ts",
]


@pytest.mark.parametrize("required_path", _REQUIRED_TESTS)
def test_i0011_required_coverage_file_exists(repo_root: Path, required_path: str) -> None:
    if not (repo_root / required_path).exists():
        pytest.xfail(f"I-0011: {required_path} is listed in a spec DoD but does not exist yet")
