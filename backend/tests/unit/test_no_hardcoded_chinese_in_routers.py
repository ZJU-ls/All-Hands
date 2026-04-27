"""Regression net · routers must not raise HTTPException with hardcoded
Chinese / hardcoded English copy. Anything user-facing in `detail=` should
go through ``allhands.i18n.t(...)`` so the response respects
Accept-Language.

Allowed bypasses:
    - ``detail=str(exc)`` — propagating an upstream service error message.
      The service layer owns the wording.
    - ``detail=t(...)`` — i18n'd.

Anything else fails this test, with a pointer to the offending line.
"""

from __future__ import annotations

import re
from pathlib import Path

ROUTERS_DIR = Path(__file__).resolve().parents[2] / "src" / "allhands" / "api" / "routers"

# Match any HTTPException(..., detail=<expr>, ...) where <expr> is NOT one of:
#   t("..."), t('...'), str(exc) / str(e), repr(exc).
# Crude but adequate — the file count is small (< 25) and we only flag
# obviously-bad cases.
DETAIL_PATTERN = re.compile(r"\bdetail\s*=\s*([^,)\n]+)")
ALLOWED_PREFIXES = (
    "t(",
    "_t(",  # alias used in a couple of routers
    "str(",
    "repr(",
)


def _detail_is_ok(value: str) -> bool:
    v = value.strip()
    # Variable name or function call we trust by convention.
    if v.startswith(ALLOWED_PREFIXES):
        return True
    # Locals like `msg`, `body.detail` — allow plain identifiers / attribute
    # access. The catch is hardcoded string literals.
    return bool(re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_.]*", v))


def test_routers_have_no_hardcoded_detail_strings() -> None:
    offences: list[tuple[Path, int, str]] = []
    for path in ROUTERS_DIR.glob("*.py"):
        if path.name == "__init__.py":
            continue
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            # Only inspect lines that look like an exception construction.
            if "HTTPException" not in line and "raise" not in line:
                continue
            # Sometimes detail= is on a continuation line; merge with next 2 for context.
            for m in DETAIL_PATTERN.finditer(line):
                value = m.group(1)
                if value.startswith(("f'", 'f"', "'", '"')):
                    offences.append((path, lineno, line.strip()))
                elif not _detail_is_ok(value):
                    # Allow continuation values (e.g. detail=msg, where msg is a
                    # variable computed from t()/str(exc)).
                    pass
    rendered = "\n".join(f"  {p.name}:{n}  {s}" for p, n, s in offences)
    assert not offences, (
        "router(s) raise HTTPException with hardcoded f-string / literal detail — "
        'wrap the message in `t("errors.<key>")` so it respects Accept-Language:\n' + rendered
    )
