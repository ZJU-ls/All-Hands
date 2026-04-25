"""Office artifact generators (2026-04-25 spec).

Each module is a pure-function bytes producer:
``def render_<kind>(payload: dict) -> bytes``

Kept narrow so the executor / tool layer is just argument plumbing and the
"swap weasyprint for playwright" / "swap python-pptx for go-pptx" decision
stays a single-file change.
"""
