"""Pytest config. Keep fixtures minimal — specific suites build their own DB fixtures."""

from __future__ import annotations

import os
from pathlib import Path

import pytest


@pytest.fixture(scope="session", autouse=True)
def _test_env() -> None:
    """Test-only defaults. Unit tests should not touch real data dir."""
    os.environ.setdefault("ALLHANDS_ENV", "test")
    os.environ.setdefault("ALLHANDS_LOG_LEVEL", "WARNING")
    tmp = Path(".pytest_data")
    tmp.mkdir(exist_ok=True)
    os.environ.setdefault(
        "ALLHANDS_DATABASE_URL",
        f"sqlite+aiosqlite:///{tmp}/test.db",
    )
