"""CSV generator · headers + rows → utf-8 csv bytes (text-identity kind).

Spec: docs/specs/2026-04-25-artifact-kinds-roadmap.md § 2.3.
"""

from __future__ import annotations

import csv as _csv
import io
from typing import Any

from allhands.execution.artifact_generators.pdf import ArtifactGenerationError


def render_csv(*, headers: list[str] | None = None, rows: list[list[Any]]) -> bytes:
    """Standard csv.writer · QUOTE_MINIMAL · utf-8 with BOM so Excel on
    Windows opens it without garbling CJK headers."""
    if not isinstance(rows, list):
        raise ArtifactGenerationError("rows must be a list.")
    buf = io.StringIO()
    writer = _csv.writer(buf, quoting=_csv.QUOTE_MINIMAL)
    if headers:
        if not isinstance(headers, list):
            raise ArtifactGenerationError("headers must be a list.")
        writer.writerow(headers)
    for r_idx, row in enumerate(rows):
        if not isinstance(row, list):
            raise ArtifactGenerationError(f"rows[{r_idx}] must be a list.")
        writer.writerow(["" if v is None else v for v in row])
    # Excel-friendly utf-8 BOM. Frontend papaparse strips it transparently.
    return "﻿".encode() + buf.getvalue().encode("utf-8")
