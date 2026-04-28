"""Domain-model boundary tests for skill_script · pure pydantic, no I/O.

Covers:
- pydantic field validation (skill_id / script length / args / timeouts)
- ScriptInvocation.stdin_bytes() size cap
- ScriptInvocation.resolved_interpreter() · auto detection · errors
- ScriptResult round-trip
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from allhands.core.skill_script import (
    DEFAULT_TIMEOUT_SECONDS,
    MAX_STDIN_BYTES,
    MAX_TIMEOUT_SECONDS,
    ScriptInterpreter,
    ScriptInvocation,
    ScriptResult,
)

# ──────────────────────────────────────────────────────────────────────────
# ScriptInvocation: pydantic surface validation
# ──────────────────────────────────────────────────────────────────────────


def test_invocation_minimal_ok() -> None:
    inv = ScriptInvocation(skill_id="pdf", script="scripts/extract.py")
    assert inv.skill_id == "pdf"
    assert inv.script == "scripts/extract.py"
    assert inv.args == []
    assert inv.stdin is None
    assert inv.timeout_seconds == DEFAULT_TIMEOUT_SECONDS
    assert inv.interpreter is ScriptInterpreter.AUTO


def test_invocation_full_kwargs() -> None:
    inv = ScriptInvocation(
        skill_id="pdf",
        script="scripts/x.py",
        args=["a", "b"],
        stdin="payload",
        timeout_seconds=60,
        interpreter=ScriptInterpreter.PYTHON,
    )
    assert inv.args == ["a", "b"]
    assert inv.stdin == "payload"
    assert inv.timeout_seconds == 60
    assert inv.interpreter is ScriptInterpreter.PYTHON


def test_invocation_rejects_empty_skill_id() -> None:
    with pytest.raises(ValidationError):
        ScriptInvocation(skill_id="", script="scripts/x.py")


def test_invocation_rejects_short_script() -> None:
    # Must start with 'scripts/' + at least 1 more char ⇒ min length is 9.
    with pytest.raises(ValidationError):
        ScriptInvocation(skill_id="pdf", script="scripts/")


def test_invocation_rejects_timeout_over_max() -> None:
    with pytest.raises(ValidationError):
        ScriptInvocation(
            skill_id="pdf",
            script="scripts/x.py",
            timeout_seconds=MAX_TIMEOUT_SECONDS + 1,
        )


def test_invocation_rejects_timeout_zero() -> None:
    with pytest.raises(ValidationError):
        ScriptInvocation(skill_id="pdf", script="scripts/x.py", timeout_seconds=0)


def test_invocation_args_max_length() -> None:
    args_ok = ["a"] * 128
    inv = ScriptInvocation(skill_id="pdf", script="scripts/x.py", args=args_ok)
    assert len(inv.args) == 128

    with pytest.raises(ValidationError):
        ScriptInvocation(skill_id="pdf", script="scripts/x.py", args=["a"] * 129)


def test_invocation_frozen() -> None:
    inv = ScriptInvocation(skill_id="pdf", script="scripts/x.py")
    with pytest.raises(ValidationError):
        inv.skill_id = "other"  # type: ignore[misc]


# ──────────────────────────────────────────────────────────────────────────
# stdin_bytes — size enforcement
# ──────────────────────────────────────────────────────────────────────────


def test_stdin_bytes_returns_none_when_absent() -> None:
    inv = ScriptInvocation(skill_id="x", script="scripts/y.py")
    assert inv.stdin_bytes() is None


def test_stdin_bytes_encodes_utf8() -> None:
    inv = ScriptInvocation(skill_id="x", script="scripts/y.py", stdin="中文 hi")
    assert inv.stdin_bytes() == "中文 hi".encode()


def test_stdin_bytes_rejects_oversize() -> None:
    big = "a" * (MAX_STDIN_BYTES + 1)
    inv = ScriptInvocation(skill_id="x", script="scripts/y.py", stdin=big)
    with pytest.raises(ValueError, match="stdin exceeds"):
        inv.stdin_bytes()


# ──────────────────────────────────────────────────────────────────────────
# resolved_interpreter — auto detection rules
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("script", "expected"),
    [
        ("scripts/x.py", ScriptInterpreter.PYTHON),
        ("scripts/Y.PY", ScriptInterpreter.PYTHON),  # case-insensitive
        ("scripts/web.js", ScriptInterpreter.NODE),
        ("scripts/web.mjs", ScriptInterpreter.NODE),
        ("scripts/run.sh", ScriptInterpreter.BASH),
        ("scripts/run.bash", ScriptInterpreter.BASH),
    ],
)
def test_auto_interpreter_picks_from_extension(script: str, expected: ScriptInterpreter) -> None:
    inv = ScriptInvocation(skill_id="x", script=script)
    assert inv.resolved_interpreter() is expected


def test_auto_interpreter_rejects_unknown_extension() -> None:
    inv = ScriptInvocation(skill_id="x", script="scripts/run.exe")
    with pytest.raises(ValueError, match="unknown script extension"):
        inv.resolved_interpreter()


def test_auto_interpreter_rejects_no_extension() -> None:
    # min_length=9 forces at least 'scripts/x'; pass non-extension name
    inv = ScriptInvocation(skill_id="x", script="scripts/runner")
    with pytest.raises(ValueError, match="no extension"):
        inv.resolved_interpreter()


def test_pinned_interpreter_overrides_extension() -> None:
    inv = ScriptInvocation(
        skill_id="x",
        script="scripts/looks_like.exe",
        interpreter=ScriptInterpreter.PYTHON,
    )
    assert inv.resolved_interpreter() is ScriptInterpreter.PYTHON


# ──────────────────────────────────────────────────────────────────────────
# ScriptResult
# ──────────────────────────────────────────────────────────────────────────


def test_result_roundtrip() -> None:
    r = ScriptResult(
        exit_code=0,
        stdout="hello\n",
        stderr="",
        duration_ms=42,
        interpreter_used=ScriptInterpreter.PYTHON,
    )
    payload = r.model_dump(exclude_none=True)
    assert payload["exit_code"] == 0
    assert payload["interpreter_used"] == "python"
    # killed defaults to None and should be dropped
    assert "killed" not in payload
    assert "stdout_spool_path" not in payload


def test_result_includes_killed_when_present() -> None:
    r = ScriptResult(
        exit_code=-1,
        duration_ms=30000,
        interpreter_used=ScriptInterpreter.PYTHON,
        killed="timeout",
    )
    payload = r.model_dump(exclude_none=True)
    assert payload["killed"] == "timeout"


def test_result_frozen() -> None:
    r = ScriptResult(exit_code=0, duration_ms=1, interpreter_used=ScriptInterpreter.PYTHON)
    with pytest.raises(ValidationError):
        r.exit_code = 1  # type: ignore[misc]
