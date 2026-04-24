"""ADR 0015 Phase 3 · path sandbox for read_skill_file.

Seven cases to cover per plan risk section:
  abs path · .. traversal · symlink escape · nested ok · missing file ·
  directory (not file) · (size/utf-8 covered at integration level).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from allhands.execution.tools.meta.skill_files import (
    MAX_READ_BYTES,
    SandboxError,
    _safe_resolve,
)


def test_rejects_absolute_path(tmp_path: Path) -> None:
    with pytest.raises(SandboxError, match="must not be absolute"):
        _safe_resolve(tmp_path, "/etc/passwd")


def test_rejects_parent_traversal(tmp_path: Path) -> None:
    outside = tmp_path.parent / "secret.txt"
    outside.write_text("x")
    with pytest.raises(SandboxError, match="escapes"):
        _safe_resolve(tmp_path, "../secret.txt")


def test_rejects_symlink_escape(tmp_path: Path) -> None:
    outside = tmp_path.parent / "target.txt"
    outside.write_text("x")
    link = tmp_path / "link.txt"
    link.symlink_to(outside)
    with pytest.raises(SandboxError, match="escapes"):
        _safe_resolve(tmp_path, "link.txt")


def test_allows_nested_path(tmp_path: Path) -> None:
    sub = tmp_path / "references"
    sub.mkdir()
    target = sub / "notes.md"
    target.write_text("ok")
    resolved = _safe_resolve(tmp_path, "references/notes.md")
    assert resolved == target.resolve()


def test_rejects_missing_file(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        _safe_resolve(tmp_path, "does/not/exist.md")


def test_rejects_directory(tmp_path: Path) -> None:
    (tmp_path / "sub").mkdir()
    with pytest.raises(SandboxError, match="not a file"):
        _safe_resolve(tmp_path, "sub")


def test_max_read_bytes_is_256kb() -> None:
    # Sanity check — sandbox contract pins 256KB limit in the module constant.
    assert MAX_READ_BYTES == 256 * 1024
