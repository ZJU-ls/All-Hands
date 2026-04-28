#!/usr/bin/env python3
"""Read stdin · print JSON with line / word / char counts."""

import json
import sys

text = sys.stdin.read()
lines = text.splitlines()
words = text.split()

print(
    json.dumps(
        {
            "lines": len(lines),
            "words": len(words),
            "chars": len(text),
        },
        ensure_ascii=False,
    )
)
