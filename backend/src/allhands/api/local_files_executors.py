"""Executors for the 7 ``allhands.local-files`` tools.

Closes over ``LocalWorkspaceService`` (services/) — must live in api/ since
the execution/ layer is forbidden from importing services/. Wired via
``discover_builtin_tools(extra_executors=...)`` in ``api/deps.py``.

All tools share the same workspace-resolution prelude: pick the workspace
(explicit id or single-default), call ``svc.resolve_within(ws_id, path)``,
return a structured ``{error, field, expected, received, hint}`` envelope on
boundary errors (ADR 0021).
"""

from __future__ import annotations

import asyncio
import re
import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from allhands.persistence.sql_repos import SqlLocalWorkspaceRepo
from allhands.services.local_workspace_service import (
    LocalWorkspaceService,
    LocalWorkspaceServiceError,
    PathOutsideWorkspaceError,
)

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    ToolExecutor = Callable[..., Awaitable[Any]]


# 2 MiB read cap · larger files must use offset+limit
MAX_READ_BYTES = 2 * 1024 * 1024
MAX_LIST_ENTRIES = 500
MAX_GLOB_RESULTS = 200
MAX_GREP_FILES = 5000  # python fallback only — ripgrep imposes its own
DEFAULT_LIMIT = 2000
DEFAULT_DENIED_GLOBS = (
    ".git/objects/**",
    ".git/refs/**",
    "node_modules/**",
    ".venv/**",
    "__pycache__/**",
)


def _session_context(maker: async_sessionmaker[AsyncSession]) -> Any:
    session = maker()

    class _Ctx:
        async def __aenter__(self) -> AsyncSession:
            await session.__aenter__()
            await session.begin()
            return session

        async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
            if exc is None:
                await session.commit()
            else:
                await session.rollback()
            await session.__aexit__(exc_type, exc, tb)

    return _Ctx()


def _err(error: str, *, field: str = "", hint: str = "", **extra: Any) -> dict[str, Any]:
    out: dict[str, Any] = {"error": error}
    if field:
        out["field"] = field
    if hint:
        out["hint"] = hint
    out.update(extra)
    return out


async def _resolve_workspace(
    svc: LocalWorkspaceService, workspace_id: str | None
) -> tuple[str, Path] | dict[str, Any]:
    """Resolve workspace context. Returns (workspace_id, root) on success or
    a structured error envelope dict."""
    if workspace_id is None:
        rows = await svc.list_all()
        if not rows:
            return _err(
                "no workspace configured",
                field="workspace_id",
                hint=(
                    "ask the user to add a workspace in /settings/workspaces, "
                    "or call add_local_workspace meta tool"
                ),
            )
        if len(rows) > 1:
            return _err(
                "multiple workspaces configured; pick one",
                field="workspace_id",
                hint=f"call list_local_workspaces; available ids: {[w.id for w in rows]}",
            )
        ws = rows[0]
    else:
        got = await svc.get(workspace_id)
        if got is None:
            return _err(
                f"workspace {workspace_id!r} not found",
                field="workspace_id",
                hint="call list_local_workspaces to see configured ids",
            )
        ws = got
    return ws.id, Path(ws.root_path)


async def _resolve_path(
    svc: LocalWorkspaceService, workspace_id: str, requested: str
) -> Path | dict[str, Any]:
    try:
        return await svc.resolve_within(workspace_id, requested)
    except PathOutsideWorkspaceError as exc:
        return _err(
            str(exc),
            field="path",
            hint="paths must be inside the workspace root after symlink resolution",
            received=requested,
        )
    except LocalWorkspaceServiceError as exc:
        return _err(str(exc), field="workspace_id", received=workspace_id)


def _is_denied(rel_path: str, denied_globs: list[str]) -> bool:
    """Simple glob denial check using fnmatch semantics on POSIX path."""
    from fnmatch import fnmatch

    patterns = list(denied_globs) + list(DEFAULT_DENIED_GLOBS)
    return any(fnmatch(rel_path, pat) for pat in patterns)


def _format_with_line_numbers(content: str, start_line: int) -> str:
    lines = content.splitlines(keepends=False)
    return "\n".join(f"{i + start_line:6d}\t{line}" for i, line in enumerate(lines))


def _looks_binary(sample: bytes) -> bool:
    if b"\x00" in sample:
        return True
    # heuristic: non-ascii + non-utf8 ratio
    try:
        sample.decode("utf-8")
    except UnicodeDecodeError:
        return True
    return False


async def _grep_ripgrep(
    rg_path: str,
    root: Path,
    pattern: str,
    *,
    glob: str | None,
    output_mode: str,
    case_insensitive: bool,
    line_numbers: bool,
    ctx_after: int,
    ctx_before: int,
    head_limit: int,
) -> dict[str, Any]:
    args = [rg_path, "--no-heading", "--color=never"]
    if output_mode == "files_with_matches":
        args.append("-l")
    elif output_mode == "count":
        args.append("--count")
    else:  # content
        if line_numbers:
            args.append("-n")
        if ctx_after:
            args.extend(["-A", str(ctx_after)])
        if ctx_before:
            args.extend(["-B", str(ctx_before)])
    if case_insensitive:
        args.append("-i")
    if glob:
        args.extend(["--glob", glob])
    args.append(pattern)
    args.append(str(root))
    try:
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, err = await proc.communicate()
    except OSError as exc:
        return _err(f"ripgrep failed: {exc}", field="pattern")
    text = out.decode("utf-8", errors="replace")
    lines = text.splitlines()
    if proc.returncode == 1:  # no matches
        return {"pattern": pattern, "output_mode": output_mode, "matches": [], "count": 0}
    if proc.returncode and proc.returncode > 1:
        return _err(
            f"ripgrep returned {proc.returncode}: {err.decode('utf-8', errors='replace').strip()[:300]}",
            field="pattern",
            received=pattern,
        )
    if output_mode == "files_with_matches":
        out_paths = lines[:head_limit]
        return {
            "pattern": pattern,
            "output_mode": output_mode,
            "matches": out_paths,
            "count": len(out_paths),
            "truncated": len(lines) > head_limit,
        }
    if output_mode == "count":
        rows: list[dict[str, Any]] = []
        for line in lines[:head_limit]:
            if ":" in line:
                p, _, c = line.rpartition(":")
                try:
                    rows.append({"path": p, "count": int(c)})
                except ValueError:
                    continue
        return {"pattern": pattern, "output_mode": output_mode, "matches": rows, "count": len(rows)}
    # content
    return {
        "pattern": pattern,
        "output_mode": output_mode,
        "matches": lines[:head_limit],
        "count": len(lines[:head_limit]),
        "truncated": len(lines) > head_limit,
    }


def _grep_python(
    root: Path,
    pattern: str,
    *,
    glob: str | None,
    output_mode: str,
    case_insensitive: bool,
    line_numbers: bool,
    ctx_after: int,
    ctx_before: int,
    head_limit: int,
) -> dict[str, Any]:
    try:
        flags = re.IGNORECASE if case_insensitive else 0
        rx = re.compile(pattern, flags)
    except re.error as exc:
        return _err(f"invalid regex: {exc}", field="pattern", received=pattern)

    candidates: list[Path] = []
    if root.is_file():
        candidates = [root]
    else:
        glob_pat = glob or "**/*"
        try:
            for p in root.glob(glob_pat):
                if p.is_file():
                    rel = str(p.relative_to(root)) if p.is_relative_to(root) else p.name
                    if _is_denied(rel, []):
                        continue
                    candidates.append(p)
                    if len(candidates) >= MAX_GREP_FILES:
                        break
        except (OSError, ValueError) as exc:
            return _err(f"glob enumeration failed: {exc}", field="path")

    matches_files: list[str] = []
    matches_content: list[str] = []
    matches_count: list[dict[str, Any]] = []
    for p in candidates:
        try:
            with p.open("rb") as fh:
                head = fh.read(2048)
            if _looks_binary(head):
                continue
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        lines = text.splitlines()
        hit_indices = [i for i, line in enumerate(lines) if rx.search(line)]
        if not hit_indices:
            continue
        if output_mode == "files_with_matches":
            matches_files.append(str(p))
            if len(matches_files) >= head_limit:
                break
        elif output_mode == "count":
            matches_count.append({"path": str(p), "count": len(hit_indices)})
            if len(matches_count) >= head_limit:
                break
        else:  # content
            for idx in hit_indices:
                start = max(0, idx - ctx_before)
                end = min(len(lines), idx + ctx_after + 1)
                for j in range(start, end):
                    prefix = f"{p}:{j + 1}:" if line_numbers else f"{p}:"
                    matches_content.append(f"{prefix}{lines[j]}")
                    if len(matches_content) >= head_limit:
                        break
                if len(matches_content) >= head_limit:
                    break
            if len(matches_content) >= head_limit:
                break

    if output_mode == "files_with_matches":
        return {
            "pattern": pattern,
            "output_mode": output_mode,
            "matches": matches_files,
            "count": len(matches_files),
        }
    if output_mode == "count":
        return {
            "pattern": pattern,
            "output_mode": output_mode,
            "matches": matches_count,
            "count": len(matches_count),
        }
    return {
        "pattern": pattern,
        "output_mode": output_mode,
        "matches": matches_content,
        "count": len(matches_content),
    }


# ----------- bash safety helpers -----------
# Patterns that always refuse — user can never run these.
BASH_HARD_BLOCK_PATTERNS = (
    r"\brm\s+-rf?\s*/\s*($|[^a-zA-Z0-9_./])",  # rm -rf / and friends
    r":\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:",  # fork bomb
    r"\bdd\b.*\bof=/dev/(sd[a-z]|nvme|disk|hd[a-z])",
    r"\bmkfs\.\w+\s+/dev/",
    r">\s*/dev/sd[a-z]",
)


def _is_hard_blocked(command: str) -> str | None:
    for pat in BASH_HARD_BLOCK_PATTERNS:
        if re.search(pat, command):
            return pat
    return None


def _truncate_output(text: str, cap: int = 30 * 1024) -> tuple[str, bool]:
    if len(text) <= cap:
        return text, False
    head = text[: cap // 2]
    tail = text[-cap // 2 :]
    return f"{head}\n\n... [{len(text) - cap} bytes truncated] ...\n\n{tail}", True


def build_local_files_executors(
    maker: async_sessionmaker[AsyncSession],
) -> dict[str, ToolExecutor]:
    def _service(session: AsyncSession) -> LocalWorkspaceService:
        return LocalWorkspaceService(repo=SqlLocalWorkspaceRepo(session))

    # ---------------- read_file ----------------
    async def read_file(
        path: str,
        workspace_id: str | None = None,
        offset: int = 0,
        limit: int = DEFAULT_LIMIT,
        **_: Any,
    ) -> dict[str, Any]:
        async with _session_context(maker) as session:
            svc = _service(session)
            ws = await _resolve_workspace(svc, workspace_id)
            if isinstance(ws, dict):
                return ws
            ws_id, root = ws
            resolved = await _resolve_path(svc, ws_id, path)
            if isinstance(resolved, dict):
                return resolved
            ws_record = await svc.get(ws_id)
        if not resolved.exists():
            return _err(
                f"file does not exist: {resolved}",
                field="path",
                received=path,
                hint="use list_directory or glob to find the right path",
            )
        if resolved.is_dir():
            return _err(
                f"path is a directory: {resolved}",
                field="path",
                hint="use list_directory or glob for directories",
            )
        rel = str(resolved.relative_to(root))
        if ws_record and _is_denied(rel, list(ws_record.denied_globs)):
            return _err(
                f"path is denied by workspace policy: {rel}",
                field="path",
                hint="check denied_globs on the workspace",
            )
        size = resolved.stat().st_size
        if size > MAX_READ_BYTES and offset == 0 and limit >= DEFAULT_LIMIT:
            return _err(
                f"file is {size} bytes; exceeds {MAX_READ_BYTES} cap",
                field="limit",
                hint="re-call with smaller `limit` or non-zero `offset`",
                size_bytes=size,
            )
        try:
            with resolved.open("rb") as fh:
                head = fh.read(4096)
                if _looks_binary(head):
                    return {
                        "path": str(resolved),
                        "kind": "binary",
                        "size_bytes": size,
                    }
            text = resolved.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            return _err(f"read failed: {exc}", field="path", received=path)
        all_lines = text.splitlines(keepends=False)
        total = len(all_lines)
        sliced = all_lines[offset : offset + limit]
        formatted = "\n".join(f"{offset + i + 1:6d}\t{line}" for i, line in enumerate(sliced))
        return {
            "path": str(resolved),
            "content": formatted,
            "line_count": total,
            "lines_returned": len(sliced),
            "offset": offset,
            "truncated": offset + len(sliced) < total,
            "encoding": "utf-8",
        }

    # ---------------- list_directory ----------------
    async def list_directory(
        path: str = ".",
        workspace_id: str | None = None,
        **_: Any,
    ) -> dict[str, Any]:
        async with _session_context(maker) as session:
            svc = _service(session)
            ws = await _resolve_workspace(svc, workspace_id)
            if isinstance(ws, dict):
                return ws
            ws_id, root = ws
            resolved = await _resolve_path(svc, ws_id, path)
            if isinstance(resolved, dict):
                return resolved
            ws_record = await svc.get(ws_id)
        if not resolved.exists():
            return _err(f"directory does not exist: {resolved}", field="path", received=path)
        if not resolved.is_dir():
            return _err(f"path is not a directory: {resolved}", field="path", received=path)
        denied = list(ws_record.denied_globs) if ws_record else []
        entries: list[dict[str, Any]] = []
        try:
            iterator = sorted(resolved.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
        except OSError as exc:
            return _err(f"list failed: {exc}", field="path")
        for child in iterator[:MAX_LIST_ENTRIES]:
            try:
                rel = str(child.relative_to(root))
            except ValueError:
                continue
            if _is_denied(rel, denied):
                continue
            try:
                stat = child.lstat()
                kind = "symlink" if child.is_symlink() else ("dir" if child.is_dir() else "file")
                entries.append(
                    {
                        "name": child.name,
                        "type": kind,
                        "size": stat.st_size,
                        "mtime": datetime.fromtimestamp(stat.st_mtime, tz=UTC).isoformat(),
                    }
                )
            except OSError:
                continue
        return {
            "path": str(resolved),
            "entries": entries,
            "count": len(entries),
            "truncated": len(iterator) > MAX_LIST_ENTRIES,
        }

    # ---------------- glob ----------------
    async def glob_files(
        pattern: str,
        path: str = ".",
        workspace_id: str | None = None,
        **_: Any,
    ) -> dict[str, Any]:
        async with _session_context(maker) as session:
            svc = _service(session)
            ws = await _resolve_workspace(svc, workspace_id)
            if isinstance(ws, dict):
                return ws
            ws_id, root = ws
            resolved = await _resolve_path(svc, ws_id, path)
            if isinstance(resolved, dict):
                return resolved
            ws_record = await svc.get(ws_id)
        if not resolved.is_dir():
            return _err(
                f"glob root must be a directory: {resolved}",
                field="path",
                received=path,
            )
        denied = list(ws_record.denied_globs) if ws_record else []
        matched: list[Path] = []
        try:
            for p in resolved.glob(pattern):
                if not p.is_file():
                    continue
                try:
                    rel = str(p.relative_to(root))
                except ValueError:
                    continue
                if _is_denied(rel, denied):
                    continue
                matched.append(p)
                if len(matched) > MAX_GLOB_RESULTS * 4:
                    break
        except (OSError, ValueError) as exc:
            return _err(f"glob failed: {exc}", field="pattern", received=pattern)
        matched.sort(key=lambda p: p.stat().st_mtime, reverse=True)
        matched = matched[:MAX_GLOB_RESULTS]
        return {
            "pattern": pattern,
            "root": str(resolved),
            "paths": [str(p) for p in matched],
            "count": len(matched),
        }

    # ---------------- grep ----------------
    async def grep(
        pattern: str,
        path: str = ".",
        glob: str | None = None,
        output_mode: str = "files_with_matches",
        head_limit: int = 100,
        workspace_id: str | None = None,
        **flags: Any,
    ) -> dict[str, Any]:
        async with _session_context(maker) as session:
            svc = _service(session)
            ws = await _resolve_workspace(svc, workspace_id)
            if isinstance(ws, dict):
                return ws
            ws_id, _root = ws
            resolved = await _resolve_path(svc, ws_id, path)
            if isinstance(resolved, dict):
                return resolved
        if output_mode not in {"files_with_matches", "content", "count"}:
            return _err(
                f"invalid output_mode {output_mode!r}",
                field="output_mode",
                expected="files_with_matches | content | count",
                received=output_mode,
            )
        case_insensitive = bool(flags.get("-i") or flags.get("i"))
        line_numbers = bool(flags.get("-n") or flags.get("n"))
        ctx_after = int(flags.get("-A") or flags.get("A") or 0)
        ctx_before = int(flags.get("-B") or flags.get("B") or 0)
        ctx_around = int(flags.get("-C") or flags.get("C") or 0)
        if ctx_around:
            ctx_after = ctx_around
            ctx_before = ctx_around

        rg = shutil.which("rg")
        if rg is not None:
            return await _grep_ripgrep(
                rg,
                resolved,
                pattern,
                glob=glob,
                output_mode=output_mode,
                case_insensitive=case_insensitive,
                line_numbers=line_numbers,
                ctx_after=ctx_after,
                ctx_before=ctx_before,
                head_limit=head_limit,
            )
        return _grep_python(
            resolved,
            pattern,
            glob=glob,
            output_mode=output_mode,
            case_insensitive=case_insensitive,
            line_numbers=line_numbers,
            ctx_after=ctx_after,
            ctx_before=ctx_before,
            head_limit=head_limit,
        )

    # ---------------- write_local_file ----------------
    async def write_local_file(
        path: str,
        content: str,
        workspace_id: str | None = None,
        **_: Any,
    ) -> dict[str, Any]:
        async with _session_context(maker) as session:
            svc = _service(session)
            ws = await _resolve_workspace(svc, workspace_id)
            if isinstance(ws, dict):
                return ws
            ws_id, root = ws
            resolved = await _resolve_path(svc, ws_id, path)
            if isinstance(resolved, dict):
                return resolved
            ws_record = await svc.get(ws_id)
        if ws_record and ws_record.read_only:
            return _err(
                "workspace is read_only",
                field="workspace_id",
                hint="toggle read_only off in /settings/workspaces if you want to write",
            )
        if resolved.exists() and resolved.is_dir():
            return _err(
                f"path is a directory: {resolved}",
                field="path",
                received=path,
            )
        rel = str(resolved.relative_to(root)) if resolved.is_relative_to(root) else str(resolved)
        if ws_record and _is_denied(rel, list(ws_record.denied_globs)):
            return _err(
                f"path is denied by workspace policy: {rel}",
                field="path",
            )
        existed_before = resolved.exists()
        try:
            resolved.parent.mkdir(parents=True, exist_ok=True)
            resolved.write_text(content, encoding="utf-8")
        except OSError as exc:
            return _err(f"write failed: {exc}", field="path")
        return {
            "path": str(resolved),
            "bytes_written": len(content.encode("utf-8")),
            "created": not existed_before,
        }

    # ---------------- edit_file ----------------
    async def edit_file(
        path: str,
        old_string: str,
        new_string: str,
        replace_all: bool = False,
        workspace_id: str | None = None,
        **_: Any,
    ) -> dict[str, Any]:
        if old_string == new_string:
            return _err(
                "old_string equals new_string — nothing to change",
                field="new_string",
            )
        async with _session_context(maker) as session:
            svc = _service(session)
            ws = await _resolve_workspace(svc, workspace_id)
            if isinstance(ws, dict):
                return ws
            ws_id, _root = ws
            resolved = await _resolve_path(svc, ws_id, path)
            if isinstance(resolved, dict):
                return resolved
            ws_record = await svc.get(ws_id)
        if ws_record and ws_record.read_only:
            return _err("workspace is read_only", field="workspace_id")
        if not resolved.exists():
            return _err(
                f"file does not exist: {resolved}",
                field="path",
                hint="for new files use write_local_file instead",
            )
        if resolved.is_dir():
            return _err(f"path is a directory: {resolved}", field="path")
        try:
            text = resolved.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            return _err(f"read failed: {exc}", field="path")
        occurrences = text.count(old_string)
        if occurrences == 0:
            return _err(
                "old_string not found in file",
                field="old_string",
                hint=(
                    "make sure whitespace and indentation match exactly · "
                    "use grep first to find the precise text"
                ),
            )
        if occurrences > 1 and not replace_all:
            # find first match line for hint
            head = text[: text.index(old_string)]
            line = head.count("\n") + 1
            return _err(
                f"old_string occurs {occurrences} times — must be unique unless replace_all=true",
                field="old_string",
                hint=(
                    f"first match is at line {line} · "
                    "extend old_string with surrounding context to make it unique, "
                    "or pass replace_all=true to replace all occurrences"
                ),
                occurrences=occurrences,
                first_match_line=line,
            )
        new_text = (
            text.replace(old_string, new_string)
            if replace_all
            else text.replace(old_string, new_string, 1)
        )
        try:
            resolved.write_text(new_text, encoding="utf-8")
        except OSError as exc:
            return _err(f"write failed: {exc}", field="path")
        return {
            "path": str(resolved),
            "replacements": occurrences if replace_all else 1,
            "bytes_written": len(new_text.encode("utf-8")),
        }

    # ---------------- bash ----------------
    async def bash(
        command: str,
        cwd: str | None = None,
        workspace_id: str | None = None,
        timeout_ms: int = 120_000,
        **_: Any,
    ) -> dict[str, Any]:
        if not command.strip():
            return _err("command must not be empty", field="command")
        blocked = _is_hard_blocked(command)
        if blocked:
            return _err(
                "command is blocked by safety policy",
                field="command",
                received=command,
                hint=f"matched hard-block pattern: {blocked}",
            )
        async with _session_context(maker) as session:
            svc = _service(session)
            ws = await _resolve_workspace(svc, workspace_id)
            if isinstance(ws, dict):
                return ws
            ws_id, root = ws
            ws_record = await svc.get(ws_id)
            if cwd is not None:
                resolved_cwd = await _resolve_path(svc, ws_id, cwd)
                if isinstance(resolved_cwd, dict):
                    return resolved_cwd
            else:
                resolved_cwd = root
        if ws_record and ws_record.read_only:
            return _err("workspace is read_only", field="workspace_id")
        if not resolved_cwd.is_dir():
            return _err(
                f"cwd is not a directory: {resolved_cwd}",
                field="cwd",
                received=cwd,
            )
        timeout_s = max(1.0, min(timeout_ms / 1000, 600.0))
        try:
            proc = await asyncio.create_subprocess_shell(
                command,
                cwd=str(resolved_cwd),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                stdout_b, stderr_b = await asyncio.wait_for(proc.communicate(), timeout=timeout_s)
            except TimeoutError:
                proc.kill()
                await proc.wait()
                return _err(
                    f"command timed out after {timeout_s}s",
                    field="timeout_ms",
                    hint="raise timeout_ms or split the command",
                )
        except OSError as exc:
            return _err(f"command failed to start: {exc}", field="command")
        stdout = stdout_b.decode("utf-8", errors="replace")
        stderr = stderr_b.decode("utf-8", errors="replace")
        stdout_text, stdout_trunc = _truncate_output(stdout)
        stderr_text, stderr_trunc = _truncate_output(stderr)
        return {
            "command": command,
            "cwd": str(resolved_cwd),
            "exit_code": proc.returncode,
            "stdout": stdout_text,
            "stderr": stderr_text,
            "stdout_truncated": stdout_trunc,
            "stderr_truncated": stderr_trunc,
        }

    return {
        "allhands.local.read_file": read_file,
        "allhands.local.list_directory": list_directory,
        "allhands.local.glob": glob_files,
        "allhands.local.grep": grep,
        "allhands.local.write_file": write_local_file,
        "allhands.local.edit_file": edit_file,
        "allhands.local.bash": bash,
    }
