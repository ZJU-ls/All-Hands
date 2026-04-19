"""allhands-core MCP server — bundled reference implementation.

Exposes three small-but-useful tools over stdio:
  - fetch_url(url, timeout_seconds=10)      → fetch HTTP(S) body as text
  - read_text_file(path, max_bytes=65536)   → read a small text file from disk
  - now(tz="UTC")                           → current ISO-8601 timestamp

Safety posture:
  - fetch_url caps response size and forbids non-http(s) schemes.
  - read_text_file caps bytes + refuses binary bodies.
  - now is pure.

All three are READ-scope — they do not mutate external state and do not
need Confirmation Gate approval when dispatched through allhands.
"""
