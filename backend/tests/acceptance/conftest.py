"""Shared fixtures for the acceptance suite."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]  # backend/tests/acceptance → repo root
PLAN_PATH = HERE / "walkthrough_plan.json"


@pytest.fixture(scope="session")
def walkthrough_plan() -> dict[str, Any]:
    """Parsed W1-W7 acceptance plan."""
    return json.loads(PLAN_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def repo_root() -> Path:
    return REPO


@pytest.fixture(scope="session")
def meta_tools_dir(repo_root: Path) -> Path:
    return repo_root / "backend" / "src" / "allhands" / "execution" / "tools" / "meta"


@pytest.fixture(scope="session")
def routers_dir(repo_root: Path) -> Path:
    return repo_root / "backend" / "src" / "allhands" / "api" / "routers"


@pytest.fixture(scope="session")
def web_app_dir(repo_root: Path) -> Path:
    return repo_root / "web" / "app"
