#!/usr/bin/env python3
"""Echo argv joined with spaces · the smallest possible smoke test."""

import sys

print(" ".join(sys.argv[1:]))
