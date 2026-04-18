"""Backend regression tests for project-level error patterns.

These assertions lock in fixes for bugs that have bitten us more than once.
A failure's message points at the specific pattern that was violated.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
ALEMBIC_VERSIONS = REPO / "alembic" / "versions"
SRC = REPO / "src"


def _alembic_files() -> list[Path]:
    return sorted(p for p in ALEMBIC_VERSIONS.glob("*.py") if not p.name.startswith("_"))


def _src_files() -> list[Path]:
    return [p for p in SRC.rglob("*.py") if "__pycache__" not in p.parts]


class TestE06SqliteUniqueConstraint:
    """E06 · SQLite 不支持 op.create_unique_constraint。

    必须在 create_table 里内联 sa.UniqueConstraint 或使用 partial unique index。
    """

    @pytest.mark.parametrize("path", _alembic_files(), ids=lambda p: p.name)
    def test_no_op_create_unique_constraint(self, path: Path) -> None:
        src = path.read_text(encoding="utf-8")
        assert "op.create_unique_constraint" not in src, (
            f"E06 违规:{path.name} 使用了 op.create_unique_constraint。"
            " SQLite 不支持,改在 create_table 里内联 sa.UniqueConstraint"
            " 或用 op.execute('CREATE UNIQUE INDEX ... WHERE ...')。"
        )


class TestE07NoMetadataCreateAll:
    """E07 · metadata.create_all 和 Alembic 抢表。

    src/ 下任何位置都不许调 metadata.create_all / Base.metadata.create_all,
    启动/迁移一律走 Alembic。测试代码里用于建临时 schema 是允许的。
    """

    PATTERN = re.compile(r"\bmetadata\.create_all\s*\(|\bcreate_all\s*\(.*metadata")

    @pytest.mark.parametrize("path", _src_files(), ids=lambda p: str(p.relative_to(REPO)))
    def test_src_does_not_call_create_all(self, path: Path) -> None:
        src = path.read_text(encoding="utf-8")
        assert not self.PATTERN.search(src), (
            f"E07 违规:{path.relative_to(REPO)} 调用了 metadata.create_all。"
            " 生产代码必须通过 Alembic 迁移建表,不要让 ORM 直接建。"
        )
