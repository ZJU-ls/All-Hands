#!/usr/bin/env python3
"""HTTP SSE trace · per-line wall clock + event summary.

Born out of E18 / L11: bug-fix starts with **curl the endpoint**, not reading
code. Use this to verify that a wire contract is actually being sent (e.g.
`thinking: false` makes `REASONING_MESSAGE_CHUNK` disappear) and to measure
the gap between last content and RUN_FINISHED (SSE stall diagnostics).

Usage:
    python3 scripts/http-trace.py chat <conversation_id> [--thinking true|false]
    python3 scripts/http-trace.py custom <url> [-d '{...}']

Reports:
    - per-line wall-clock offsets (time since POST sent)
    - event counts (TEXT / REASONING / tool_call)
    - key gaps: last-token → RUN_FINISHED → transport close

Example session (from the E18 hunt):

    $ python3 scripts/http-trace.py chat <conv> --thinking false
       0.011s  event: RUN_STARTED
       9.191s  >>> first REASONING chunk (BUG — thinking:false should emit ZERO)
      10.198s  event: TEXT_MESSAGE_START
      ...
    summary: tokens=1 reasoning=146  <- wire confirms bug
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from collections.abc import Iterator


def trace_chat(conv_id: str, thinking: bool, base: str) -> None:
    body = json.dumps({"content": "请回一句话", "thinking": thinking})
    url = f"{base}/api/conversations/{conv_id}/messages"
    _run_sse(url, body)


def trace_custom(url: str, body: str | None) -> None:
    _run_sse(url, body or "{}")


def _iter_sse(url: str, body: str) -> Iterator[tuple[float, str]]:
    proc = subprocess.Popen(
        [
            "curl",
            "-sSN",
            "-X",
            "POST",
            "-H",
            "Content-Type: application/json",
            "-d",
            body,
            url,
            "--max-time",
            "120",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        bufsize=1,
        text=True,
    )
    start = time.time()
    assert proc.stdout is not None
    for line in iter(proc.stdout.readline, ""):
        now = time.time() - start
        yield now, line.rstrip("\n")
    proc.wait()
    yield time.time() - start, "__CLOSE__"


def _run_sse(url: str, body: str) -> None:
    first_token: float | None = None
    last_token: float | None = None
    run_finished: float | None = None
    close: float | None = None
    token_count = 0
    reasoning_count = 0

    for now, line in _iter_sse(url, body):
        if line == "__CLOSE__":
            close = now
            print(f"{now:8.3f}s  [TRANSPORT CLOSE]")
            break
        if not line:
            continue
        if line.startswith("event:"):
            ev = line.split(":", 1)[1].strip()
            if ev == "TEXT_MESSAGE_CONTENT":
                if first_token is None:
                    first_token = now
                    print(f"{now:8.3f}s  >>> first TEXT token")
                last_token = now
                token_count += 1
            elif ev == "REASONING_MESSAGE_CHUNK":
                reasoning_count += 1
                if reasoning_count == 1:
                    print(f"{now:8.3f}s  >>> first REASONING chunk")
            elif ev == "RUN_FINISHED":
                run_finished = now
                print(f"{now:8.3f}s  === RUN_FINISHED")
            elif ev not in ("TEXT_MESSAGE_CONTENT", "REASONING_MESSAGE_CHUNK"):
                print(f"{now:8.3f}s  event: {ev}")

    print()
    print("=== summary ===")
    print(f"tokens={token_count}  reasoning={reasoning_count}")
    if last_token is not None and run_finished is not None:
        gap = run_finished - last_token
        label = "(IDLE TAIL)" if gap > 0.5 else "(tight)"
        print(f"last-token → RUN_FINISHED: {gap:6.3f}s {label}")
    if run_finished is not None and close is not None:
        tail = close - run_finished
        label = "(TAIL)" if tail > 0.3 else "(tight)"
        print(f"RUN_FINISHED → close:      {tail:6.3f}s {label}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0] if __doc__ else None)
    sub = parser.add_subparsers(dest="cmd", required=True)

    chat = sub.add_parser("chat", help="send a message to an existing conversation")
    chat.add_argument("conversation_id")
    chat.add_argument("--thinking", choices=["true", "false"], default="false")
    chat.add_argument("--base", default="http://localhost:8000")

    custom = sub.add_parser("custom", help="POST to any SSE endpoint")
    custom.add_argument("url")
    custom.add_argument("-d", "--data", help="JSON body string")

    args = parser.parse_args()
    if args.cmd == "chat":
        trace_chat(args.conversation_id, args.thinking == "true", args.base)
    elif args.cmd == "custom":
        trace_custom(args.url, args.data)
    else:
        parser.error("unknown subcommand")
        sys.exit(2)


if __name__ == "__main__":
    main()
