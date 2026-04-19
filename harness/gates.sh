#!/usr/bin/env bash
# harness/gates.sh · runs the Wave-2 QA gates end-to-end.
#
# Order is load-bearing:
#   1. self-review        · cheap static contracts (fail fast)
#   2. walkthrough-accept  · acceptance matrix + v0 sign-of-life
#
# scripts/check.sh sources this file so every commit enforces both gates.

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"$root/scripts/self-review.sh"
"$root/scripts/walkthrough-acceptance.sh"
