"""Layered-architecture contract: core/ must never transitively import a framework.

This runs `import-linter` as a subprocess so the contract is enforced under
`pytest` as well as in CI. Requires import-linter to be installed (dev-dep).
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest


@pytest.mark.skipif(
    shutil.which("lint-imports") is None,
    reason="import-linter not installed (run via `uv run lint-imports`)",
)
def test_layered_contracts_pass() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    result = subprocess.run(
        ["lint-imports"],
        cwd=repo_root,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, (
        f"import-linter failed:\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )


def test_core_module_has_no_framework_imports() -> None:
    """Fast grep-level check. A full transitive scan lives in lint-imports."""
    core_dir = Path(__file__).resolve().parents[2] / "src" / "allhands" / "core"
    forbidden = (
        "import sqlalchemy",
        "from sqlalchemy",
        "import fastapi",
        "from fastapi",
        "import langgraph",
        "from langgraph",
        "import langchain",
        "from langchain",
        "import openai",
        "from openai",
        "import anthropic",
        "from anthropic",
        "import mcp",
        "from mcp",
    )
    offenders: list[str] = []
    for py in core_dir.rglob("*.py"):
        text = py.read_text(encoding="utf-8")
        for line in text.splitlines():
            stripped = line.strip()
            if stripped.startswith("#"):
                continue
            for bad in forbidden:
                if stripped.startswith(bad):
                    offenders.append(f"{py.name}: {stripped}")
    assert not offenders, "core/ imports forbidden framework(s):\n" + "\n".join(offenders)
