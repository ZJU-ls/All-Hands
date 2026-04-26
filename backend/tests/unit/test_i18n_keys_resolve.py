"""Regression net · every ``t("foo.bar")`` call site in backend source must
resolve to a real key in the ``_MESSAGES`` catalog (for both locales).

Caught in practice would be cases like the web side's
``mcp.list.neverSynced`` typo — where the code references a key that lives
under a different prefix in the catalog. The sibling test on the web side
is ``web/tests/i18n-keys-resolve.test.ts``.

Heuristic: regex over ``backend/src/`` looking for ``t("literal")`` (the
function imported as ``from allhands.i18n import t``). Only string
literals — template expressions or computed keys are skipped (no false
positives, but correspondingly no false negatives are *guaranteed*; static
keys cover the vast majority of real call sites).
"""

from __future__ import annotations

import re
from pathlib import Path

from allhands.i18n import _MESSAGES, LOCALES

SRC = Path(__file__).resolve().parents[2] / "src" / "allhands"

CALL_RE = re.compile(r'\bt\(\s*"([a-zA-Z_][a-zA-Z0-9_.]*)"')
ALLOWED_PARENT_PATHS = {"src/allhands/i18n/__init__.py"}  # the catalog itself


def _all_keys() -> set[str]:
    keys: set[str] = set()
    for loc in LOCALES:
        keys.update(_MESSAGES.get(loc, {}).keys())
    return keys


def test_every_t_call_resolves() -> None:
    catalog = _all_keys()
    offences: list[tuple[Path, int, str]] = []
    for path in SRC.rglob("*.py"):
        if path.name == "__init__.py" and path.parent.name == "i18n":
            continue
        text = path.read_text(encoding="utf-8")
        for lineno, line in enumerate(text.splitlines(), 1):
            for match in CALL_RE.finditer(line):
                # Skip clearly-non-i18n callers — e.g. a local `t = ...` in
                # a non-i18n context. We restrict to files that actually
                # `from allhands.i18n import t` to avoid false positives
                # from any unrelated single-letter `t(...)` helpers.
                if "from allhands.i18n import" not in text:
                    continue
                key = match.group(1)
                if key not in catalog:
                    offences.append((path, lineno, key))
    rendered = "\n".join(
        f"  {p.relative_to(SRC.parent.parent.parent)}:{n}  {k}" for p, n, k in offences
    )
    assert not offences, (
        "backend t() call(s) reference key(s) missing from the i18n catalog — "
        "add the key to backend/src/allhands/i18n/__init__.py or fix the lookup:\n" + rendered
    )
