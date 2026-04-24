"""Read SKILL.md body (after YAML frontmatter) — pure function.

ADR 0015 Phase 2: built-in + installed skills share the same body-reading
path. This module is intentionally dependency-free (stdlib only) so both
the activation path (`resolve_skill`) and any future preview/debug tools
can call it without pulling in registry state.
"""

from __future__ import annotations

import re
from pathlib import Path

_FRONTMATTER = re.compile(r"^---\s*\n.*?\n---\s*\n", re.DOTALL)


def read_skill_body(skill_dir: Path) -> str:
    """Return SKILL.md body (markdown after frontmatter) or '' if none.

    - Built-in skills (SKILL.yaml only, no SKILL.md) → ''
    - SKILL.md without frontmatter → whole file body
    - Windows CRLF normalized to LF
    """
    md = skill_dir / "SKILL.md"
    if not md.is_file():
        return ""
    text = md.read_text(encoding="utf-8").replace("\r\n", "\n")
    stripped = _FRONTMATTER.sub("", text, count=1)
    return stripped.strip()
