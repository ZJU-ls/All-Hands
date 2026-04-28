#!/usr/bin/env python3
"""Diff two CSV sheets by a key column · output JSON.

Usage:
    sheet_diff.py file_a.csv file_b.csv --key id [--threshold 0.0]

The ``--threshold`` is a fractional change: 0.2 means "report numeric values
that changed by more than 20 percent." Non-numeric fields are compared by
string equality regardless of threshold.

Output JSON shape:
    {
        "added":   [ {key, row_b}, ... ],   // present in B, not A
        "removed": [ {key, row_a}, ... ],   // present in A, not B
        "changed": [ {key, field, a, b, pct?}, ... ]   // pct only if numeric
    }

Designed to be deterministic + tiny so the tool layer's full-trip test stays
fast. No third-party dependencies (uses stdlib csv).
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Any


def _read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def _try_float(s: str) -> float | None:
    try:
        return float(s)
    except (ValueError, TypeError):
        return None


def diff(
    a_rows: list[dict[str, str]],
    b_rows: list[dict[str, str]],
    *,
    key: str,
    threshold: float,
) -> dict[str, list[dict[str, Any]]]:
    a_idx = {row[key]: row for row in a_rows if key in row}
    b_idx = {row[key]: row for row in b_rows if key in row}

    added: list[dict[str, Any]] = [{"key": k, "row_b": b_idx[k]} for k in b_idx if k not in a_idx]
    removed: list[dict[str, Any]] = [{"key": k, "row_a": a_idx[k]} for k in a_idx if k not in b_idx]

    changed: list[dict[str, Any]] = []
    for k in sorted(set(a_idx) & set(b_idx)):
        ra, rb = a_idx[k], b_idx[k]
        for field in set(ra) | set(rb):
            if field == key:
                continue
            va, vb = ra.get(field, ""), rb.get(field, "")
            if va == vb:
                continue
            entry: dict[str, Any] = {
                "key": k,
                "field": field,
                "a": va,
                "b": vb,
            }
            fa, fb = _try_float(va), _try_float(vb)
            if fa is not None and fb is not None and fa != 0:
                pct = (fb - fa) / abs(fa)
                if abs(pct) <= threshold:
                    continue  # below threshold · skip
                entry["pct"] = round(pct, 4)
            changed.append(entry)

    return {"added": added, "removed": removed, "changed": changed}


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("file_a")
    p.add_argument("file_b")
    p.add_argument("--key", required=True)
    p.add_argument("--threshold", type=float, default=0.0)
    args = p.parse_args()

    pa, pb = Path(args.file_a), Path(args.file_b)
    if not pa.is_file():
        print(f"file not found: {pa}", file=sys.stderr)
        return 2
    if not pb.is_file():
        print(f"file not found: {pb}", file=sys.stderr)
        return 2

    out = diff(
        _read_csv(pa),
        _read_csv(pb),
        key=args.key,
        threshold=args.threshold,
    )
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
