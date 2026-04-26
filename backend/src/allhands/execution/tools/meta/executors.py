"""Real executors for Agent-managed READ meta tools (E21).

**Bug context:** before this module, every meta tool registered via
``discover_builtin_tools`` was bound to ``_async_noop`` (returns ``{}``).
The Lead Agent would dutifully call ``list_providers`` / ``list_skills`` etc.
— the discovery protocol in the prompt was working — but the tools
themselves returned nothing, so Lead reported "0 of each" and the user
(rightly) thought the prompt was ignored. Root cause is documented in
[error-patterns.md § E21](../../../../../docs/claude/error-patterns.md) and
[learnings.md § L12](../../../../../docs/claude/learnings.md).

**This module** gives each READ-scope meta tool a real executor. Each
executor is a closure over the async session_maker; it opens a fresh
session per invocation, uses the canonical service / repo layer, and
returns a JSON-safe ``dict`` (not a Pydantic model) because LangChain's
``StructuredTool`` needs pure JSON for the tool-result frame.

**Scope:** we only wire list_* / get_* READ tools here. Write-scope tools
(create / update / delete) stay no-op for now — they need the same
session-maker plumbing but have richer Confirmation-Gate semantics that
belong in a follow-up. The immediate user-visible damage is READ-side: if
Lead can't *see* the platform, Lead can't suggest the right action.
"""

from __future__ import annotations

import base64
import binascii
import difflib
import mimetypes
import re
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from allhands.config.settings import get_settings
from allhands.core import (
    BINARY_KINDS,
    TEXT_KINDS,
    Artifact,
    ArtifactKind,
    ArtifactVersion,
)
from allhands.core.errors import DomainError
from allhands.persistence.sql_repos import (
    SqlArtifactRepo,
    SqlEmployeeRepo,
    SqlLLMModelRepo,
    SqlLLMProviderRepo,
    SqlMCPServerRepo,
    SqlSkillRepo,
)

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    ToolExecutor = Callable[..., Awaitable[Any]]


_REDACT_KEYS = frozenset({"api_key", "secret_key", "admin_password", "password", "token"})


def _safe_dump(obj: Any) -> Any:
    """Pydantic → dict with secret-field redaction, fallback to str.

    Meta tool results land in the LLM's tool_result frame → provider → model
    context. Leaking an ``api_key`` into that stream means any subsequent
    assistant turn could echo it back to the user verbatim, or into a render
    tool payload. Redact every well-known secret key field to
    ``"***set***"`` (preserves the *has-a-value* signal the model needs to
    decide "can I use this provider?") without exposing the value itself.
    The REST gateway uses the same convention (``api_key_set: bool``) — this
    keeps parity so Lead sees the same shape tools and UI do.
    """
    if obj is None:
        return None
    if hasattr(obj, "model_dump"):
        data = obj.model_dump(mode="json")
    else:
        return str(obj)
    if isinstance(data, dict):
        return _redact(data)
    return data


def _redact(data: Any) -> Any:
    if isinstance(data, dict):
        return {
            k: ("***set***" if k in _REDACT_KEYS and v else _redact(v)) for k, v in data.items()
        }
    if isinstance(data, list):
        return [_redact(v) for v in data]
    return data


def _session_context(maker: async_sessionmaker[AsyncSession]) -> Any:
    """Context manager that opens a session + begins a transaction.

    Mirrors ``api/deps.get_session`` so READ tools get the same semantics
    (expire_on_commit=False · autoflush=False from the sessionmaker config).
    """
    session = maker()

    class _Ctx:
        async def __aenter__(self) -> AsyncSession:
            await session.__aenter__()
            # READ tools don't need an explicit transaction — but opening one
            # matches the FastAPI dep pattern and keeps aiosqlite happy.
            await session.begin()
            return session

        async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
            if exc is None:
                await session.commit()
            else:
                await session.rollback()
            await session.__aexit__(exc_type, exc, tb)

    return _Ctx()


def make_list_providers_executor(
    maker: async_sessionmaker[AsyncSession],
) -> ToolExecutor:
    async def _exec(**_: Any) -> dict[str, Any]:
        async with _session_context(maker) as session:
            rows = await SqlLLMProviderRepo(session).list_all()
        return {
            "providers": [_safe_dump(p) for p in rows],
            "count": len(rows),
        }

    return _exec


def make_get_provider_executor(
    maker: async_sessionmaker[AsyncSession],
) -> ToolExecutor:
    async def _exec(provider_id: str, **_: Any) -> dict[str, Any]:
        async with _session_context(maker) as session:
            p = await SqlLLMProviderRepo(session).get(provider_id)
        if p is None:
            return {"error": f"provider {provider_id!r} not found"}
        return {"provider": _safe_dump(p)}

    return _exec


def make_list_models_executor(
    maker: async_sessionmaker[AsyncSession],
) -> ToolExecutor:
    async def _exec(**_: Any) -> dict[str, Any]:
        async with _session_context(maker) as session:
            rows = await SqlLLMModelRepo(session).list_all()
        return {
            "models": [_safe_dump(m) for m in rows],
            "count": len(rows),
        }

    return _exec


def make_get_model_executor(
    maker: async_sessionmaker[AsyncSession],
) -> ToolExecutor:
    async def _exec(model_id: str, **_: Any) -> dict[str, Any]:
        async with _session_context(maker) as session:
            m = await SqlLLMModelRepo(session).get(model_id)
        if m is None:
            return {"error": f"model {model_id!r} not found"}
        return {"model": _safe_dump(m)}

    return _exec


def make_list_skills_executor(
    maker: async_sessionmaker[AsyncSession],
) -> ToolExecutor:
    async def _exec(**_: Any) -> dict[str, Any]:
        async with _session_context(maker) as session:
            rows = await SqlSkillRepo(session).list_all()
        return {
            "skills": [_safe_dump(s) for s in rows],
            "count": len(rows),
        }

    return _exec


def make_get_skill_detail_executor(
    maker: async_sessionmaker[AsyncSession],
) -> ToolExecutor:
    async def _exec(skill_id: str, **_: Any) -> dict[str, Any]:
        async with _session_context(maker) as session:
            s = await SqlSkillRepo(session).get(skill_id)
        if s is None:
            return {"error": f"skill {skill_id!r} not found"}
        return {"skill": _safe_dump(s)}

    return _exec


def make_list_mcp_servers_executor(
    maker: async_sessionmaker[AsyncSession],
) -> ToolExecutor:
    async def _exec(**_: Any) -> dict[str, Any]:
        async with _session_context(maker) as session:
            rows = await SqlMCPServerRepo(session).list_all()
        return {
            "mcp_servers": [_safe_dump(m) for m in rows],
            "count": len(rows),
        }

    return _exec


def make_get_mcp_server_executor(
    maker: async_sessionmaker[AsyncSession],
) -> ToolExecutor:
    async def _exec(server_id: str, **_: Any) -> dict[str, Any]:
        async with _session_context(maker) as session:
            m = await SqlMCPServerRepo(session).get(server_id)
        if m is None:
            return {"error": f"mcp_server {server_id!r} not found"}
        return {"mcp_server": _safe_dump(m)}

    return _exec


def make_list_employees_executor(
    maker: async_sessionmaker[AsyncSession],
) -> ToolExecutor:
    async def _exec(status: str | None = None, **_: Any) -> dict[str, Any]:
        async with _session_context(maker) as session:
            rows = await SqlEmployeeRepo(session).list_all(status=status)
        # Trim the system_prompt on the list view — it's long and usually
        # not needed on discovery; Lead can call get_employee_detail for one.
        out: list[dict[str, Any]] = []
        for e in rows:
            d = _safe_dump(e)
            if isinstance(d, dict) and isinstance(d.get("system_prompt"), str):
                sp: str = d["system_prompt"]
                d["system_prompt"] = sp[:140] + ("…" if len(sp) > 140 else "")
            out.append(d)
        return {"employees": out, "count": len(rows)}

    return _exec


def make_get_employee_detail_executor(
    maker: async_sessionmaker[AsyncSession],
) -> ToolExecutor:
    async def _exec(
        employee_id: str | None = None, name: str | None = None, **_: Any
    ) -> dict[str, Any]:
        if not employee_id and not name:
            return {"error": "Provide employee_id or name."}
        async with _session_context(maker) as session:
            repo = SqlEmployeeRepo(session)
            e = None
            if employee_id:
                e = await repo.get(employee_id)
            if e is None and name:
                e = await repo.get_by_name(name)
        if e is None:
            return {"error": f"employee not found (id={employee_id!r} name={name!r})"}
        return {"employee": _safe_dump(e)}

    return _exec


# ─────────────────────────────────────────────────────────────────────────────
# Artifact tools — WRITE + READ executors bridging to ArtifactService.
#
# Context: the Tool() schemas in tools/meta/artifact_tools.py declare the tool
# surface, but before this block the registry bound them to `_async_noop`,
# so agent calls to `artifact_create` silently returned {} without persisting
# anything. That's the "agent can't draw HTML" regression — the tool "works"
# but the side effect was a no-op. These executors open a fresh session per
# invocation (same pattern as the READ executors above), construct an
# ArtifactService around SqlArtifactRepo + settings.data_dir, and return
# JSON-safe payloads. No event bus wired here — live UI refresh still works
# because ArtifactPanel polls on-mount and reloads when conversationId changes.
# ─────────────────────────────────────────────────────────────────────────────


# Private helpers that replicate the ArtifactService surface using only
# persistence + core, so executors stay within the execution layer's allowed
# imports (layer contract: execution MUST NOT import services). The logic is
# a narrow copy of services/artifact_service.py; keep the two in sync when
# either changes. DRY is tempting, but pushing an import into execution →
# services would violate ADR-wide layer discipline.

_SAFE_NAME = re.compile(r"[A-Za-z0-9._\-一-鿿 ]+")
_MAX_TEXT_BYTES = 1 * 1024 * 1024
_MAX_BINARY_BYTES = 20 * 1024 * 1024
_DEFAULT_WORKSPACE_ID = "default"

_ARTIFACT_DEFAULT_MIME: dict[ArtifactKind, str] = {
    ArtifactKind.MARKDOWN: "text/markdown",
    ArtifactKind.CODE: "text/plain",
    ArtifactKind.HTML: "text/html",
    ArtifactKind.IMAGE: "application/octet-stream",
    ArtifactKind.DATA: "application/json",
    ArtifactKind.MERMAID: "text/vnd.mermaid",
    ArtifactKind.DRAWIO: "application/vnd.jgraph.mxfile",
    ArtifactKind.PDF: "application/pdf",
    ArtifactKind.XLSX: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ArtifactKind.CSV: "text/csv",
    ArtifactKind.DOCX: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ArtifactKind.PPTX: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}

_ARTIFACT_EXT: dict[ArtifactKind, str] = {
    ArtifactKind.MARKDOWN: "md",
    ArtifactKind.CODE: "txt",
    ArtifactKind.HTML: "html",
    ArtifactKind.IMAGE: "bin",
    ArtifactKind.DATA: "json",
    ArtifactKind.MERMAID: "mmd",
    ArtifactKind.DRAWIO: "drawio",
    ArtifactKind.PDF: "pdf",
    ArtifactKind.XLSX: "xlsx",
    ArtifactKind.CSV: "csv",
    ArtifactKind.DOCX: "docx",
    ArtifactKind.PPTX: "pptx",
}


class _ArtifactExecutorError(DomainError):
    pass


def _data_dir() -> Path:
    return Path(get_settings().data_dir)


def _artifact_root() -> Path:
    # Honour ``settings.artifacts_dir`` override so the meta-tool path
    # matches the REST service path — both must point at the same blob
    # folder or rollback / version diff break across the two surfaces.
    root = get_settings().resolved_artifacts_dir()
    root.mkdir(parents=True, exist_ok=True)
    return root


def _validate_artifact_name(name: str) -> None:
    if not name or len(name) > 256:
        raise _ArtifactExecutorError("Artifact name must be 1..256 chars.")
    if not _SAFE_NAME.fullmatch(name):
        raise _ArtifactExecutorError(
            "Artifact name may contain letters, digits, CJK characters, space, '.', '_', '-' only."
        )


def _decode_artifact_base64(payload: str) -> bytes:
    try:
        return base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise _ArtifactExecutorError(f"Invalid base64 payload: {exc}") from exc


def _artifact_ext(mime: str, kind: ArtifactKind) -> str:
    guessed = mimetypes.guess_extension(mime)
    if guessed:
        return guessed.lstrip(".")
    return _ARTIFACT_EXT[kind]


def _write_artifact_blob(
    workspace_id: str,
    artifact_id: str,
    *,
    version: int,
    kind: ArtifactKind,
    mime: str,
    blob: bytes,
) -> str:
    ext = _artifact_ext(mime, kind)
    folder = _artifact_root() / workspace_id / artifact_id
    folder.mkdir(parents=True, exist_ok=True)
    filename = f"v{version}.{ext}"
    (folder / filename).write_bytes(blob)
    return str(Path(workspace_id) / artifact_id / filename)


def _artifact_diff(prev: str, curr: str) -> str:
    return "".join(
        difflib.unified_diff(
            prev.splitlines(keepends=True),
            curr.splitlines(keepends=True),
            fromfile="prev",
            tofile="curr",
            n=3,
        )
    )


def make_artifact_create_executor(
    maker: async_sessionmaker[AsyncSession],
    *,
    conversation_id: str | None = None,
    employee_id: str | None = None,
    run_id: str | None = None,
) -> ToolExecutor:
    """Build the artifact_create executor, optionally bound to chat-turn
    context. AgentLoop calls this with conversation_id / employee_id /
    run_id so the produced artifact carries provenance — that's how the
    /artifacts page can filter by 「这条对话产的」 / 「这个员工产的」.
    Triggers / cron / one-off code paths pass nothing → produce orphan
    artifacts at workspace root, still discoverable in the global view.
    """

    async def _exec(
        name: str,
        kind: str,
        content: str | None = None,
        content_base64: str | None = None,
        mime_type: str | None = None,
        description: str | None = None,
        tags: list[str] | None = None,
        change_message: str | None = None,
        **_: Any,
    ) -> dict[str, Any]:
        try:
            kind_enum = ArtifactKind(kind)
        except ValueError:
            return {
                "error": f"unknown kind {kind!r}; expected one of "
                "markdown/code/html/image/data/mermaid/drawio",
            }
        try:
            _validate_artifact_name(name)
            mime = mime_type or _ARTIFACT_DEFAULT_MIME[kind_enum]
            now = datetime.now(UTC)
            artifact_id = str(uuid.uuid4())
            # 2026-04-25 storage refactor: every kind goes to disk now.
            if kind_enum in TEXT_KINDS:
                if content is None:
                    return {"error": f"kind={kind!r} requires `content`"}
                size = len(content.encode("utf-8"))
                if size > _MAX_TEXT_BYTES:
                    return {"error": f"size {size}B exceeds text ceiling {_MAX_TEXT_BYTES}B"}
                blob = content.encode("utf-8")
            elif kind_enum in BINARY_KINDS:
                if content_base64 is None:
                    return {"error": f"kind={kind!r} requires `content_base64`"}
                blob = _decode_artifact_base64(content_base64)
                size = len(blob)
                if size > _MAX_BINARY_BYTES:
                    return {"error": f"size {size}B exceeds binary ceiling {_MAX_BINARY_BYTES}B"}
            else:  # pragma: no cover
                return {"error": f"unsupported kind {kind!r}"}

            file_path = _write_artifact_blob(
                _DEFAULT_WORKSPACE_ID,
                artifact_id,
                version=1,
                kind=kind_enum,
                mime=mime,
                blob=blob,
            )
            artifact = Artifact(
                id=artifact_id,
                workspace_id=_DEFAULT_WORKSPACE_ID,
                name=name,
                kind=kind_enum,
                mime_type=mime,
                file_path=file_path,
                size_bytes=size,
                version=1,
                created_at=now,
                updated_at=now,
                # 2026-04-25 v2 · provenance + metadata bound at create time
                conversation_id=conversation_id,
                created_by_employee_id=employee_id,
                created_by_run_id=run_id,
                description=description,
                tags=list(tags) if tags else [],
            )
            async with _session_context(maker) as session:
                repo = SqlArtifactRepo(session)
                await repo.upsert(artifact)
                await repo.save_version(
                    ArtifactVersion(
                        id=str(uuid.uuid4()),
                        artifact_id=artifact.id,
                        version=1,
                        file_path=artifact.file_path,
                        diff_from_prev=None,
                        created_at=now,
                        change_message=change_message or "initial",
                        parent_version=None,
                        created_by_employee_id=employee_id,
                        created_by_run_id=run_id,
                        size_bytes=size,
                    )
                )
        except _ArtifactExecutorError as exc:
            return {"error": str(exc)}
        except Exception as exc:
            return {"error": f"artifact_create failed: {exc}"}
        return _artifact_create_result(
            artifact_id=artifact.id,
            version=artifact.version,
            kind_value=artifact.kind.value,
            size_bytes=artifact.size_bytes,
        )

    return _exec


def make_artifact_render_executor(
    maker: async_sessionmaker[AsyncSession],
) -> ToolExecutor:
    """Return a render payload targeting the Artifact.Preview component.

    The agent calls this after `artifact_create` / `artifact_update` so the
    chat renders a rich preview card without replaying the content through
    the LLM's context window. The frontend ComponentRegistry maps
    `Artifact.Preview` to `components/render/Artifact/Preview.tsx`.
    """

    async def _exec(
        artifact_id: str,
        version: int | None = None,
        **_: Any,
    ) -> dict[str, Any]:
        # Touch the artifact to fail fast if the id is invalid — avoids
        # rendering a dead card the user has to click to discover is broken.
        async with _session_context(maker) as session:
            art = await SqlArtifactRepo(session).get(artifact_id)
        if art is None:
            return {"error": f"artifact {artifact_id!r} not found"}
        props: dict[str, Any] = {"artifact_id": artifact_id}
        if version is not None:
            props["version"] = version
        return {
            "component": "Artifact.Preview",
            "props": props,
            "interactions": [],
        }

    return _exec


def make_artifact_list_executor(
    maker: async_sessionmaker[AsyncSession],
) -> ToolExecutor:
    async def _exec(
        kind: str | None = None,
        name_prefix: str | None = None,
        pinned: bool | None = None,
        limit: int = 100,
        include_deleted: bool = False,
        **_: Any,
    ) -> dict[str, Any]:
        kind_filter: str | None = None
        if kind is not None:
            try:
                kind_filter = ArtifactKind(kind).value
            except ValueError:
                return {"error": f"unknown kind {kind!r}"}
        async with _session_context(maker) as session:
            rows = await SqlArtifactRepo(session).list_for_workspace(
                _DEFAULT_WORKSPACE_ID,
                kind=kind_filter,
                name_prefix=name_prefix,
                pinned_only=bool(pinned),
                include_deleted=include_deleted,
                limit=limit,
            )
        return {
            "artifacts": [
                {
                    "id": a.id,
                    "name": a.name,
                    "kind": a.kind.value,
                    "version": a.version,
                    "size_bytes": a.size_bytes,
                    "updated_at": a.updated_at.isoformat(),
                    "pinned": a.pinned,
                }
                for a in rows
            ],
            "count": len(rows),
        }

    return _exec


def make_artifact_read_executor(
    maker: async_sessionmaker[AsyncSession],
) -> ToolExecutor:
    async def _exec(
        artifact_id: str,
        version: int | None = None,
        **_: Any,
    ) -> dict[str, Any]:
        async with _session_context(maker) as session:
            repo = SqlArtifactRepo(session)
            art = await repo.get(artifact_id)
            if art is None:
                return {"error": f"artifact {artifact_id!r} not found"}
            target_path = art.file_path
            resolved_version = art.version
            if version is not None and version != art.version:
                v = await repo.get_version(artifact_id, version)
                if v is None:
                    return {"error": f"artifact {artifact_id!r} version {version} not found"}
                target_path = v.file_path
                resolved_version = version
        # Read content off disk (storage refactor 2026-04-25). Binary kinds
        # are returned base64'd; text kinds as utf-8 string.
        try:
            blob = (_artifact_root() / target_path).read_bytes()
        except OSError as exc:
            return {"error": f"failed reading artifact bytes: {exc}"}
        content: str | None
        if art.kind in BINARY_KINDS:
            content = base64.b64encode(blob).decode("ascii")
        else:
            try:
                content = blob.decode("utf-8")
            except UnicodeDecodeError as exc:
                return {"error": f"non-utf-8 content for text kind {art.kind.value!r}: {exc}"}
        return {
            "artifact_id": art.id,
            "name": art.name,
            "kind": art.kind.value,
            "version": resolved_version,
            "mime_type": art.mime_type,
            "size_bytes": art.size_bytes,
            "content": content,
        }

    return _exec


def make_artifact_update_executor(
    maker: async_sessionmaker[AsyncSession],
    *,
    conversation_id: str | None = None,
    employee_id: str | None = None,
    run_id: str | None = None,
) -> ToolExecutor:
    async def _exec(
        artifact_id: str,
        mode: str = "overwrite",
        content: str | None = None,
        content_base64: str | None = None,
        patch: str | None = None,
        change_message: str | None = None,
        **_: Any,
    ) -> dict[str, Any]:
        if mode not in ("overwrite", "patch"):
            return {"error": f"mode must be 'overwrite' or 'patch', got {mode!r}"}
        try:
            async with _session_context(maker) as session:
                repo = SqlArtifactRepo(session)
                existing = await repo.get(artifact_id)
                if existing is None:
                    return {"error": f"artifact {artifact_id!r} not found"}
                now = datetime.now(UTC)
                next_version = existing.version + 1

                # 2026-04-25 storage refactor: every update writes to disk.
                if existing.kind in TEXT_KINDS:
                    if mode == "patch":
                        return {
                            "error": "mode='patch' is not supported by the inline "
                            "execution-layer executor yet; use mode='overwrite'"
                        }
                    if content is None:
                        return {"error": "mode='overwrite' requires `content`"}
                    new_blob = content.encode("utf-8")
                    size = len(new_blob)
                    if size > _MAX_TEXT_BYTES:
                        return {"error": f"size {size}B exceeds text ceiling {_MAX_TEXT_BYTES}B"}
                    try:
                        prev_text = (_artifact_root() / existing.file_path).read_text(
                            encoding="utf-8"
                        )
                    except OSError:
                        prev_text = ""
                    diff: str | None = _artifact_diff(prev_text, content)
                else:
                    if mode == "patch":
                        return {"error": f"kind={existing.kind.value!r} does not support 'patch'"}
                    if content_base64 is None:
                        return {"error": "binary update requires `content_base64`"}
                    new_blob = _decode_artifact_base64(content_base64)
                    size = len(new_blob)
                    if size > _MAX_BINARY_BYTES:
                        return {
                            "error": f"size {size}B exceeds binary ceiling {_MAX_BINARY_BYTES}B"
                        }
                    diff = None

                rel = _write_artifact_blob(
                    existing.workspace_id,
                    existing.id,
                    version=next_version,
                    kind=existing.kind,
                    mime=existing.mime_type,
                    blob=new_blob,
                )
                updated = existing.model_copy(
                    update={
                        "file_path": rel,
                        "size_bytes": size,
                        "version": next_version,
                        "updated_at": now,
                        "edit_count": existing.edit_count + 1,
                    }
                )
                await repo.upsert(updated)
                await repo.save_version(
                    ArtifactVersion(
                        id=str(uuid.uuid4()),
                        artifact_id=existing.id,
                        version=next_version,
                        file_path=rel,
                        diff_from_prev=diff,
                        created_at=now,
                        change_message=change_message or f"v{next_version}",
                        parent_version=existing.version,
                        created_by_employee_id=employee_id,
                        created_by_run_id=run_id,
                        size_bytes=size,
                    )
                )
                return {"artifact_id": updated.id, "version": updated.version}
        except _ArtifactExecutorError as exc:
            return {"error": str(exc)}
        except Exception as exc:
            return {"error": f"artifact_update failed: {exc}"}

    return _exec


def make_artifact_delete_executor(
    maker: async_sessionmaker[AsyncSession],
) -> ToolExecutor:
    async def _exec(artifact_id: str, **_: Any) -> dict[str, Any]:
        async with _session_context(maker) as session:
            repo = SqlArtifactRepo(session)
            existing = await repo.get(artifact_id)
            if existing is None:
                return {"error": f"artifact {artifact_id!r} not found"}
            if existing.deleted_at is None:
                await repo.soft_delete(artifact_id, datetime.now(UTC))
        return {"artifact_id": artifact_id, "deleted": True}

    return _exec


def make_artifact_rollback_executor(
    maker: async_sessionmaker[AsyncSession],
    *,
    conversation_id: str | None = None,
    employee_id: str | None = None,
    run_id: str | None = None,
) -> ToolExecutor:
    async def _exec(
        artifact_id: str,
        to_version: int,
        change_message: str | None = None,
        **_: Any,
    ) -> dict[str, Any]:
        try:
            async with _session_context(maker) as session:
                repo = SqlArtifactRepo(session)
                existing = await repo.get(artifact_id)
                if existing is None:
                    return {"error": f"artifact {artifact_id!r} not found"}
                if to_version == existing.version:
                    return {"error": f"to_version={to_version} is already current; nothing to do"}
                if to_version < 1 or to_version > existing.version:
                    return {
                        "error": f"to_version={to_version} out of range (1..{existing.version})"
                    }
                target = await repo.get_version(artifact_id, to_version)
                if target is None:
                    return {"error": f"artifact {artifact_id!r} version {to_version} not found"}
                old_blob = (_artifact_root() / target.file_path).read_bytes()
                next_version = existing.version + 1
                rel = _write_artifact_blob(
                    existing.workspace_id,
                    existing.id,
                    version=next_version,
                    kind=existing.kind,
                    mime=existing.mime_type,
                    blob=old_blob,
                )
                diff: str | None = None
                if existing.kind in TEXT_KINDS:
                    try:
                        cur_text = (_artifact_root() / existing.file_path).read_text(
                            encoding="utf-8"
                        )
                        diff = _artifact_diff(cur_text, old_blob.decode("utf-8"))
                    except (OSError, UnicodeDecodeError):
                        diff = None
                now = datetime.now(UTC)
                updated = existing.model_copy(
                    update={
                        "file_path": rel,
                        "size_bytes": len(old_blob),
                        "version": next_version,
                        "updated_at": now,
                        "edit_count": existing.edit_count + 1,
                    }
                )
                await repo.upsert(updated)
                await repo.save_version(
                    ArtifactVersion(
                        id=str(uuid.uuid4()),
                        artifact_id=existing.id,
                        version=next_version,
                        file_path=rel,
                        diff_from_prev=diff,
                        created_at=now,
                        change_message=change_message or f"回退到 v{to_version}",
                        parent_version=to_version,
                        created_by_employee_id=employee_id,
                        created_by_run_id=run_id,
                        size_bytes=len(old_blob),
                    )
                )
                return {
                    "artifact_id": updated.id,
                    "version": updated.version,
                    "rolled_back_to": to_version,
                }
        except _ArtifactExecutorError as exc:
            return {"error": str(exc)}
        except Exception as exc:
            return {"error": f"artifact_rollback failed: {exc}"}

    return _exec


def make_artifact_pin_executor(
    maker: async_sessionmaker[AsyncSession],
) -> ToolExecutor:
    async def _exec(
        artifact_id: str,
        pinned: bool = True,
        **_: Any,
    ) -> dict[str, Any]:
        async with _session_context(maker) as session:
            repo = SqlArtifactRepo(session)
            existing = await repo.get(artifact_id)
            if existing is None:
                return {"error": f"artifact {artifact_id!r} not found"}
            if existing.pinned == pinned:
                return {"artifact_id": existing.id, "pinned": existing.pinned}
            updated = existing.model_copy(
                update={"pinned": pinned, "updated_at": datetime.now(UTC)},
            )
            await repo.upsert(updated)
        return {"artifact_id": updated.id, "pinned": updated.pinned}

    return _exec


def make_artifact_search_executor(
    maker: async_sessionmaker[AsyncSession],
) -> ToolExecutor:
    async def _exec(query: str, limit: int = 50, **_: Any) -> dict[str, Any]:
        if not query.strip():
            return {"artifacts": [], "count": 0}
        async with _session_context(maker) as session:
            rows = await SqlArtifactRepo(session).search(_DEFAULT_WORKSPACE_ID, query, limit=limit)
        return {
            "artifacts": [
                {
                    "id": a.id,
                    "name": a.name,
                    "kind": a.kind.value,
                    "version": a.version,
                    "updated_at": a.updated_at.isoformat(),
                }
                for a in rows
            ],
            "count": len(rows),
        }

    return _exec


# 2026-04-25 · structured-build artifact factories. Each follows the same
# pattern as make_artifact_create_executor: build bytes via a generator
# module, persist + emit a v1 ArtifactVersion, return {artifact_id, version,
# warnings?}. The provenance binding (conversation_id / employee_id /
# run_id) is identical across all five so the /artifacts page can filter by
# any of them.


# Inline-renderable kinds (聊天里直接显示完整内容)
_INLINE_KINDS: frozenset[str] = frozenset({"html", "drawio", "mermaid", "image", "csv", "data"})
# Always Card-only — 内联体验差(只能看占位)
_CARD_ONLY_KINDS: frozenset[str] = frozenset({"pptx", "docx"})
# Size threshold for text kinds (markdown / code / xlsx) — 超就降级 Card
_INLINE_SIZE_LIMIT_BYTES = 200_000
# PDF 单独阈值(2MB)— 小 PDF 仍内联,大 PDF 给卡片
_PDF_INLINE_LIMIT_BYTES = 2_000_000


def _pick_artifact_envelope(kind_value: str, size_bytes: int | None) -> str:
    """Return "Artifact.Preview" or "Artifact.Card" based on kind + size.

    See ADR-pending (artifacts unification 2026-04-26 §5):
    - INLINE_KINDS (html, drawio, mermaid, image, csv, data) → Preview · 聊天里
      直接显示完整内容
    - CARD_ONLY_KINDS (pptx, docx) → Card · 点击在制品区打开
    - markdown / code / xlsx → Preview if size ≤ 200KB else Card
    - pdf → Preview if size ≤ 2MB else Card
    Default: Card (safe — visible affordance, no broken inline)
    """
    if kind_value in _CARD_ONLY_KINDS:
        return "Artifact.Card"
    if kind_value in _INLINE_KINDS:
        return "Artifact.Preview"
    if kind_value == "pdf":
        if size_bytes is None or size_bytes <= _PDF_INLINE_LIMIT_BYTES:
            return "Artifact.Preview"
        return "Artifact.Card"
    if kind_value in {"markdown", "code", "xlsx"}:
        if size_bytes is None or size_bytes <= _INLINE_SIZE_LIMIT_BYTES:
            return "Artifact.Preview"
        return "Artifact.Card"
    return "Artifact.Card"


def _artifact_create_result(
    *,
    artifact_id: str,
    version: int,
    kind_value: str,
    size_bytes: int | None = None,
    warnings: list[str] | None = None,
) -> dict[str, Any]:
    """Unified return shape for every artifact_create* tool.

    Carries BOTH a render envelope (so the chat shows an Artifact preview
    card automatically · the agent no longer needs a follow-up
    artifact_render call · _as_render_envelope picks up component+props)
    AND the flat artifact_id / version / kind keys (so downstream tools
    like artifact_update / artifact_pin / agent prose can chain).

    The component split (Preview vs Card) decides whether the chat
    inlines the full content or shows a click-to-open card. See
    `_pick_artifact_envelope` for the routing.
    """
    component = _pick_artifact_envelope(kind_value, size_bytes)
    out: dict[str, Any] = {
        "component": component,
        "props": {
            "artifact_id": artifact_id,
            "version": version,
            "kind": kind_value,
        },
        "interactions": [],
        # Flat fields for agent ergonomics + backwards compat. Agents call
        # `result["artifact_id"]` to chain into update/delete/pin.
        "artifact_id": artifact_id,
        "version": version,
        "kind": kind_value,
    }
    if warnings:
        out["warnings"] = warnings
    return out


async def _persist_office_artifact(
    *,
    maker: async_sessionmaker[AsyncSession],
    name: str,
    kind: ArtifactKind,
    blob: bytes,
    description: str | None,
    tags: list[str] | None,
    change_message: str | None,
    conversation_id: str | None,
    employee_id: str | None,
    run_id: str | None,
) -> dict[str, Any]:
    """Shared write path for office artifacts. Validates name, sizes the
    blob, writes the v1 file, and persists Artifact + ArtifactVersion."""
    _validate_artifact_name(name)
    size = len(blob)
    if size > _MAX_BINARY_BYTES:
        raise _ArtifactExecutorError(f"size {size}B exceeds binary ceiling {_MAX_BINARY_BYTES}B")
    mime = _ARTIFACT_DEFAULT_MIME[kind]
    now = datetime.now(UTC)
    artifact_id = str(uuid.uuid4())
    file_path = _write_artifact_blob(
        _DEFAULT_WORKSPACE_ID,
        artifact_id,
        version=1,
        kind=kind,
        mime=mime,
        blob=blob,
    )
    artifact = Artifact(
        id=artifact_id,
        workspace_id=_DEFAULT_WORKSPACE_ID,
        name=name,
        kind=kind,
        mime_type=mime,
        file_path=file_path,
        size_bytes=size,
        version=1,
        created_at=now,
        updated_at=now,
        conversation_id=conversation_id,
        created_by_employee_id=employee_id,
        created_by_run_id=run_id,
        description=description,
        tags=list(tags) if tags else [],
    )
    async with _session_context(maker) as session:
        repo = SqlArtifactRepo(session)
        await repo.upsert(artifact)
        await repo.save_version(
            ArtifactVersion(
                id=str(uuid.uuid4()),
                artifact_id=artifact.id,
                version=1,
                file_path=file_path,
                diff_from_prev=None,
                created_at=now,
                change_message=change_message or "initial",
                parent_version=None,
                created_by_employee_id=employee_id,
                created_by_run_id=run_id,
                size_bytes=size,
            )
        )
    return _artifact_create_result(
        artifact_id=artifact.id,
        version=1,
        kind_value=kind.value,
        size_bytes=size,
    )


def make_artifact_create_pdf_executor(
    maker: async_sessionmaker[AsyncSession],
    *,
    conversation_id: str | None = None,
    employee_id: str | None = None,
    run_id: str | None = None,
) -> ToolExecutor:
    from allhands.execution.artifact_generators.pdf import (
        ArtifactGenerationError,
        render_pdf,
    )

    async def _exec(
        name: str,
        source: str = "markdown",
        content: str = "",
        title: str | None = None,
        description: str | None = None,
        tags: list[str] | None = None,
        change_message: str | None = None,
        **_: Any,
    ) -> dict[str, Any]:
        if source not in ("markdown", "html"):
            return {"error": f"source must be 'markdown' or 'html', got {source!r}"}
        try:
            blob = render_pdf(source=source, content=content, title=title)  # type: ignore[arg-type]
            return await _persist_office_artifact(
                maker=maker,
                name=name,
                kind=ArtifactKind.PDF,
                blob=blob,
                description=description,
                tags=tags,
                change_message=change_message,
                conversation_id=conversation_id,
                employee_id=employee_id,
                run_id=run_id,
            )
        except (ArtifactGenerationError, _ArtifactExecutorError) as exc:
            return {"error": str(exc)}
        except Exception as exc:
            return {"error": f"artifact_create_pdf failed: {exc}"}

    return _exec


def make_artifact_create_xlsx_executor(
    maker: async_sessionmaker[AsyncSession],
    *,
    conversation_id: str | None = None,
    employee_id: str | None = None,
    run_id: str | None = None,
) -> ToolExecutor:
    from allhands.execution.artifact_generators.pdf import ArtifactGenerationError
    from allhands.execution.artifact_generators.xlsx import render_xlsx

    async def _exec(
        name: str,
        sheets: list[dict[str, Any]] | None = None,
        description: str | None = None,
        tags: list[str] | None = None,
        change_message: str | None = None,
        **_: Any,
    ) -> dict[str, Any]:
        try:
            blob = render_xlsx(sheets=sheets or [])
            return await _persist_office_artifact(
                maker=maker,
                name=name,
                kind=ArtifactKind.XLSX,
                blob=blob,
                description=description,
                tags=tags,
                change_message=change_message,
                conversation_id=conversation_id,
                employee_id=employee_id,
                run_id=run_id,
            )
        except (ArtifactGenerationError, _ArtifactExecutorError) as exc:
            return {"error": str(exc)}
        except Exception as exc:
            return {"error": f"artifact_create_xlsx failed: {exc}"}

    return _exec


def make_artifact_create_csv_executor(
    maker: async_sessionmaker[AsyncSession],
    *,
    conversation_id: str | None = None,
    employee_id: str | None = None,
    run_id: str | None = None,
) -> ToolExecutor:
    from allhands.execution.artifact_generators.csv import render_csv
    from allhands.execution.artifact_generators.pdf import ArtifactGenerationError

    async def _exec(
        name: str,
        rows: list[list[Any]] | None = None,
        headers: list[str] | None = None,
        description: str | None = None,
        tags: list[str] | None = None,
        change_message: str | None = None,
        **_: Any,
    ) -> dict[str, Any]:
        try:
            blob = render_csv(headers=headers, rows=rows or [])
            return await _persist_office_artifact(
                maker=maker,
                name=name,
                kind=ArtifactKind.CSV,
                blob=blob,
                description=description,
                tags=tags,
                change_message=change_message,
                conversation_id=conversation_id,
                employee_id=employee_id,
                run_id=run_id,
            )
        except (ArtifactGenerationError, _ArtifactExecutorError) as exc:
            return {"error": str(exc)}
        except Exception as exc:
            return {"error": f"artifact_create_csv failed: {exc}"}

    return _exec


def make_artifact_create_docx_executor(
    maker: async_sessionmaker[AsyncSession],
    *,
    conversation_id: str | None = None,
    employee_id: str | None = None,
    run_id: str | None = None,
) -> ToolExecutor:
    from allhands.execution.artifact_generators.docx import render_docx
    from allhands.execution.artifact_generators.pdf import ArtifactGenerationError

    async def _exec(
        name: str,
        blocks: list[dict[str, Any]] | None = None,
        description: str | None = None,
        tags: list[str] | None = None,
        change_message: str | None = None,
        **_: Any,
    ) -> dict[str, Any]:
        try:
            blob, warnings = render_docx(blocks=blocks or [])
            result = await _persist_office_artifact(
                maker=maker,
                name=name,
                kind=ArtifactKind.DOCX,
                blob=blob,
                description=description,
                tags=tags,
                change_message=change_message,
                conversation_id=conversation_id,
                employee_id=employee_id,
                run_id=run_id,
            )
            if warnings:
                result["warnings"] = warnings
            return result
        except (ArtifactGenerationError, _ArtifactExecutorError) as exc:
            return {"error": str(exc)}
        except Exception as exc:
            return {"error": f"artifact_create_docx failed: {exc}"}

    return _exec


def make_artifact_create_pptx_executor(
    maker: async_sessionmaker[AsyncSession],
    *,
    conversation_id: str | None = None,
    employee_id: str | None = None,
    run_id: str | None = None,
) -> ToolExecutor:
    from allhands.execution.artifact_generators.pdf import ArtifactGenerationError
    from allhands.execution.artifact_generators.pptx import render_pptx

    async def _exec(
        name: str,
        slides: list[dict[str, Any]] | None = None,
        description: str | None = None,
        tags: list[str] | None = None,
        change_message: str | None = None,
        **_: Any,
    ) -> dict[str, Any]:
        try:
            blob, warnings = render_pptx(slides=slides or [])
            result = await _persist_office_artifact(
                maker=maker,
                name=name,
                kind=ArtifactKind.PPTX,
                blob=blob,
                description=description,
                tags=tags,
                change_message=change_message,
                conversation_id=conversation_id,
                employee_id=employee_id,
                run_id=run_id,
            )
            if warnings:
                result["warnings"] = warnings
            return result
        except (ArtifactGenerationError, _ArtifactExecutorError) as exc:
            return {"error": str(exc)}
        except Exception as exc:
            return {"error": f"artifact_create_pptx failed: {exc}"}

    return _exec


_DRAWIO_WRAPPER_OPEN = (
    '<mxfile host="app.diagrams.net" agent="allhands">'
    '<diagram id="diagram" name="Diagram">'
    '<mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" '
    'tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" '
    'pageWidth="850" pageHeight="1100" math="0" shadow="0"><root>'
    '<mxCell id="0"/><mxCell id="1" parent="0"/>'
)
_DRAWIO_WRAPPER_CLOSE = "</root></mxGraphModel></diagram></mxfile>"


def _normalize_drawio_xml(xml: str) -> str:
    """Make agent-supplied XML render-ready.

    drawio renders nothing if the outer ``<mxfile>`` envelope is missing
    or if ``<mxCell id="0"/>`` / ``<mxCell id="1" parent="0"/>`` aren't
    present. We accept three input shapes and normalize:

    1. Full ``<mxfile>...`` — passed through.
    2. Bare ``<mxGraphModel>...`` — wrap in mxfile/diagram.
    3. Just a list of ``<mxCell>`` shapes — wrap in full scaffolding.
    """
    body = xml.strip()
    if body.startswith("<mxfile"):
        return body
    if body.startswith("<diagram"):
        return f'<mxfile host="app.diagrams.net" agent="allhands">{body}</mxfile>'
    if body.startswith("<mxGraphModel"):
        return (
            '<mxfile host="app.diagrams.net" agent="allhands">'
            '<diagram id="diagram" name="Diagram">'
            f"{body}"
            "</diagram></mxfile>"
        )
    return f"{_DRAWIO_WRAPPER_OPEN}{body}{_DRAWIO_WRAPPER_CLOSE}"


def _normalize_drawio_name(name: str) -> str:
    name = name.strip()
    if not name.lower().endswith(".drawio"):
        name = f"{name}.drawio"
    return name


def make_render_drawio_executor(
    maker: async_sessionmaker[AsyncSession],
    *,
    conversation_id: str | None = None,
    employee_id: str | None = None,
    run_id: str | None = None,
) -> ToolExecutor:
    """Single-call drawio: persist XML as artifact AND return render envelope.

    The product intent (2026-04-26): drop the four-step ritual
    (read_skill_file → fill placeholders → artifact_create → artifact_render).
    One tool · one call · the chat shows the diagram, the artifact panel
    shows the file. XML auto-wraps if the model only sent the inner body.
    """

    async def _exec(
        name: str,
        xml: str = "",
        description: str | None = None,
        tags: list[str] | None = None,
        change_message: str | None = None,
        **_: Any,
    ) -> dict[str, Any]:
        if not xml or not xml.strip():
            return {"error": "xml is empty — pass a mxfile or mxGraphModel body"}
        try:
            normalized_xml = _normalize_drawio_xml(xml)
            normalized_name = _normalize_drawio_name(name)
            blob = normalized_xml.encode("utf-8")
            persisted = await _persist_office_artifact(
                maker=maker,
                name=normalized_name,
                kind=ArtifactKind.DRAWIO,
                blob=blob,
                description=description,
                tags=tags,
                change_message=change_message,
                conversation_id=conversation_id,
                employee_id=employee_id,
                run_id=run_id,
            )
        except _ArtifactExecutorError as exc:
            return {"error": str(exc)}
        except Exception as exc:
            return {"error": f"render_drawio failed: {exc}"}
        # _persist_office_artifact already returns the unified shape
        # (component + props + flat artifact_id/version/kind), so a bare
        # passthrough is correct. Keeps drawio in lock-step with all the
        # other artifact_create* tools — same auto-render contract.
        return persisted

    return _exec


def _make_delete_conversation_exec_factory() -> Callable[
    [async_sessionmaker[AsyncSession]], ToolExecutor
]:
    """Deferred import keeps this module independent of ``conversation_tools``
    so the import graph stays flat (``conversation_tools`` already imports
    ``persistence/``; we don't want a cycle from this side)."""

    from allhands.execution.tools.meta.conversation_tools import (
        make_delete_conversation_executor,
    )

    return make_delete_conversation_executor


# Tool-id → executor-factory map. Keys match the ``Tool.id`` strings in
# ``tools/meta/*.py``; values are callables that take a session_maker and
# return an executor. Resolved in ``tools/__init__.discover_builtin_tools``.
READ_META_EXECUTORS: dict[str, Callable[[async_sessionmaker[AsyncSession]], ToolExecutor]] = {
    "allhands.meta.list_providers": make_list_providers_executor,
    "allhands.meta.get_provider": make_get_provider_executor,
    "allhands.meta.list_models": make_list_models_executor,
    "allhands.meta.get_model": make_get_model_executor,
    "allhands.meta.list_skills": make_list_skills_executor,
    "allhands.meta.get_skill_detail": make_get_skill_detail_executor,
    # Note: list_skill_market / preview_skill_market / install_skill_from_*
    # / update_skill / delete_skill executors live in api/skill_executors.py
    # because they close over SkillService (services/). The execution/ layer
    # is forbidden from importing services/ by the import-linter contract,
    # so api/deps.py injects them via ``discover_builtin_tools(..., extra_executors=...)``.
    "allhands.meta.list_mcp_servers": make_list_mcp_servers_executor,
    "allhands.meta.get_mcp_server": make_get_mcp_server_executor,
    "allhands.meta.list_employees": make_list_employees_executor,
    "allhands.meta.get_employee_detail": make_get_employee_detail_executor,
    # Artifact executors — originally stuck on _async_noop, now bridged to
    # ArtifactService so agent-produced HTML / markdown / code / images /
    # mermaid / data actually persist and can be re-rendered.
    "allhands.artifacts.create": make_artifact_create_executor,
    "allhands.artifacts.create_pdf": make_artifact_create_pdf_executor,
    "allhands.artifacts.create_xlsx": make_artifact_create_xlsx_executor,
    "allhands.artifacts.create_csv": make_artifact_create_csv_executor,
    "allhands.artifacts.create_docx": make_artifact_create_docx_executor,
    "allhands.artifacts.create_pptx": make_artifact_create_pptx_executor,
    "allhands.artifacts.render_drawio": make_render_drawio_executor,
    "allhands.artifacts.render": make_artifact_render_executor,
    "allhands.artifacts.list": make_artifact_list_executor,
    "allhands.artifacts.read": make_artifact_read_executor,
    "allhands.artifacts.update": make_artifact_update_executor,
    "allhands.artifacts.rollback": make_artifact_rollback_executor,
    "allhands.artifacts.delete": make_artifact_delete_executor,
    "allhands.artifacts.pin": make_artifact_pin_executor,
    "allhands.artifacts.search": make_artifact_search_executor,
    # History-panel conversation lifecycle (Tool First · L01).
    "allhands.meta.delete_conversation": _make_delete_conversation_exec_factory(),
}
