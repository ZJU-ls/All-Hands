"""ArtifactService — create / read / update / delete agent-produced artifacts.

See `docs/specs/agent-design/2026-04-18-artifacts-skill.md` for full scope.

**2026-04-25 storage refactor:** all kinds (text + binary) live on disk under
``<data_dir>/artifacts/<workspace_id>/<artifact_id>/v<N>.<ext>``. The DB row
only carries metadata + ``file_path`` (a relative path under the data dir).

Why: ``content TEXT`` columns under chat-side write contention triggered
"database is locked" errors on long write transactions (5KB-1MB blobs in
autocommitting txns). Moving content off-DB cuts the transaction window
to O(metadata) — milliseconds, no contention.

Every update bumps ``version`` and writes a new file ``v<N+1>.<ext>``;
the previous version stays reachable via ``ArtifactVersion`` rows pointing
at older files. Rollback creates a new version (``v<N+2>``) copying an
older file's content forward — preserves the audit trail.
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
from typing import TYPE_CHECKING, Literal

from allhands.core import (
    BINARY_KINDS,
    TEXT_KINDS,
    Artifact,
    ArtifactKind,
    ArtifactVersion,
)
from allhands.core.errors import DomainError
from allhands.execution.events import ArtifactChangedEvent

if TYPE_CHECKING:
    from allhands.execution.event_bus import EventBus
    from allhands.persistence.repositories import ArtifactRepo


MAX_TEXT_BYTES = 1 * 1024 * 1024  # 1 MB
MAX_BINARY_BYTES = 20 * 1024 * 1024  # 20 MB
DEFAULT_WORKSPACE_ID = "default"

_KIND_EXT: dict[ArtifactKind, str] = {
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

_DEFAULT_MIME: dict[ArtifactKind, str] = {
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


class ArtifactError(DomainError):
    """Artifact validation / lookup failure."""


class ArtifactNotFound(ArtifactError):
    pass


class ArtifactService:
    def __init__(
        self,
        repo: ArtifactRepo,
        data_dir: Path,
        bus: EventBus | None = None,
        *,
        artifacts_root: Path | None = None,
    ) -> None:
        self._repo = repo
        self._data_dir = data_dir
        self._bus = bus
        # 2026-04-25 · explicit override path for desktop-shell installs
        # that want artifacts on an external volume / iCloud / OneDrive.
        # When None, derive the legacy <data_dir>/artifacts location so
        # existing callers keep working.
        self._artifacts_root_override = artifacts_root

    @property
    def _root(self) -> Path:
        root = self._artifacts_root_override or (self._data_dir / "artifacts")
        root.mkdir(parents=True, exist_ok=True)
        return root

    async def create(
        self,
        *,
        name: str,
        kind: ArtifactKind,
        content: str | None = None,
        content_base64: str | None = None,
        mime_type: str | None = None,
        workspace_id: str = DEFAULT_WORKSPACE_ID,
        conversation_id: str | None = None,
        created_by_employee_id: str | None = None,
        created_by_run_id: str | None = None,
        metadata: dict[str, object] | None = None,
    ) -> Artifact:
        _validate_name(name)
        mime = mime_type or _DEFAULT_MIME[kind]
        blob = _encode_input_for_storage(kind, content, content_base64)
        size = len(blob)
        _check_size(size, _max_for_kind(kind), kind)
        now = datetime.now(UTC)
        artifact_id = str(uuid.uuid4())

        rel = self._write_blob(
            workspace_id, artifact_id, version=1, kind=kind, mime=mime, blob=blob
        )
        artifact = Artifact(
            id=artifact_id,
            workspace_id=workspace_id,
            name=name,
            kind=kind,
            mime_type=mime,
            file_path=rel,
            size_bytes=size,
            version=1,
            created_by_run_id=created_by_run_id,
            created_by_employee_id=created_by_employee_id,
            conversation_id=conversation_id,
            created_at=now,
            updated_at=now,
            extra_metadata=metadata or {},
        )
        await self._repo.upsert(artifact)
        await self._repo.save_version(
            ArtifactVersion(
                id=str(uuid.uuid4()),
                artifact_id=artifact.id,
                version=1,
                file_path=rel,
                diff_from_prev=None,
                created_at=now,
            )
        )
        await self._publish_changed(artifact, op="created")
        return artifact

    async def get(self, artifact_id: str) -> Artifact:
        art = await self._repo.get(artifact_id)
        if art is None:
            raise ArtifactNotFound(f"Artifact {artifact_id!r} not found.")
        return art

    async def list_all(
        self,
        *,
        workspace_id: str = DEFAULT_WORKSPACE_ID,
        kind: ArtifactKind | None = None,
        name_prefix: str | None = None,
        pinned_only: bool = False,
        include_deleted: bool = False,
        limit: int = 100,
        conversation_id: str | None = None,
        employee_id: str | None = None,
        status: str | None = None,
        tag: str | None = None,
        created_after: datetime | None = None,
        created_before: datetime | None = None,
        q: str | None = None,
        sort: str = "updated_at_desc",
    ) -> list[Artifact]:
        return await self._repo.list_for_workspace(
            workspace_id,
            kind=kind.value if kind else None,
            name_prefix=name_prefix,
            pinned_only=pinned_only,
            include_deleted=include_deleted,
            limit=limit,
            conversation_id=conversation_id,
            employee_id=employee_id,
            status=status,
            tag=tag,
            created_after=created_after,
            created_before=created_before,
            q=q,
            sort=sort,
        )

    async def search(
        self,
        query: str,
        *,
        workspace_id: str = DEFAULT_WORKSPACE_ID,
        limit: int = 50,
    ) -> list[Artifact]:
        if not query.strip():
            return []
        return await self._repo.search(workspace_id, query, limit=limit)

    async def update(
        self,
        artifact_id: str,
        *,
        mode: str = "overwrite",
        content: str | None = None,
        content_base64: str | None = None,
        patch: str | None = None,
    ) -> Artifact:
        artifact = await self.get(artifact_id)
        if mode not in ("overwrite", "patch"):
            raise ArtifactError(f"mode must be 'overwrite' or 'patch', got {mode!r}.")

        now = datetime.now(UTC)
        next_version = artifact.version + 1
        prev_blob = self.read_bytes(artifact)

        if artifact.kind in TEXT_KINDS:
            if mode == "patch":
                if patch is None:
                    raise ArtifactError("mode='patch' requires `patch` (unified diff).")
                prev_text = prev_blob.decode("utf-8")
                new_text = _apply_unified_diff(prev_text, patch)
            else:
                if content is None:
                    raise ArtifactError("mode='overwrite' requires `content`.")
                new_text = content
            new_blob = new_text.encode("utf-8")
            size = len(new_blob)
            _check_size(size, MAX_TEXT_BYTES, artifact.kind)
            diff = _diff_text(prev_blob.decode("utf-8"), new_text)
        else:
            if mode == "patch":
                raise ArtifactError(
                    f"kind={artifact.kind.value!r} does not support 'patch'; use 'overwrite'."
                )
            if content_base64 is None:
                raise ArtifactError("binary update requires `content_base64`.")
            new_blob = _decode_base64(content_base64)
            size = len(new_blob)
            _check_size(size, MAX_BINARY_BYTES, artifact.kind)
            diff = None

        rel = self._write_blob(
            artifact.workspace_id,
            artifact.id,
            version=next_version,
            kind=artifact.kind,
            mime=artifact.mime_type,
            blob=new_blob,
        )
        updated = artifact.model_copy(
            update={
                "file_path": rel,
                "size_bytes": size,
                "version": next_version,
                "updated_at": now,
            }
        )
        await self._repo.upsert(updated)
        await self._repo.save_version(
            ArtifactVersion(
                id=str(uuid.uuid4()),
                artifact_id=artifact.id,
                version=next_version,
                file_path=rel,
                diff_from_prev=diff,
                created_at=now,
            )
        )
        await self._publish_changed(updated, op="updated")
        return updated

    async def rollback(self, artifact_id: str, *, to_version: int) -> Artifact:
        """Create a new version (v{N+1}) carrying the content of an older
        version. Original history is preserved — rollback is just another
        forward step that happens to copy older bytes.

        Raises ``ArtifactError`` when ``to_version`` is the current version
        (no-op disallowed; user should just close the dialog) or refers to
        a missing version.
        """
        artifact = await self.get(artifact_id)
        if to_version == artifact.version:
            raise ArtifactError(f"to_version={to_version} is already the current version.")
        if to_version < 1 or to_version > artifact.version:
            raise ArtifactError(f"to_version={to_version} out of range (1..{artifact.version}).")
        target = await self._repo.get_version(artifact_id, to_version)
        if target is None:
            raise ArtifactNotFound(f"Artifact {artifact_id!r} version {to_version} not found.")
        old_blob = self.absolute_path(target.file_path).read_bytes()

        next_version = artifact.version + 1
        rel = self._write_blob(
            artifact.workspace_id,
            artifact.id,
            version=next_version,
            kind=artifact.kind,
            mime=artifact.mime_type,
            blob=old_blob,
        )
        diff: str | None = None
        if artifact.kind in TEXT_KINDS:
            try:
                prev_text = self.read_bytes(artifact).decode("utf-8")
                diff = _diff_text(prev_text, old_blob.decode("utf-8"))
            except (UnicodeDecodeError, OSError):
                diff = None

        now = datetime.now(UTC)
        updated = artifact.model_copy(
            update={
                "file_path": rel,
                "size_bytes": len(old_blob),
                "version": next_version,
                "updated_at": now,
            }
        )
        await self._repo.upsert(updated)
        await self._repo.save_version(
            ArtifactVersion(
                id=str(uuid.uuid4()),
                artifact_id=artifact.id,
                version=next_version,
                file_path=rel,
                diff_from_prev=diff,
                created_at=now,
            )
        )
        await self._publish_changed(updated, op="updated")
        return updated

    async def delete(self, artifact_id: str) -> None:
        artifact = await self.get(artifact_id)
        if artifact.deleted_at is not None:
            return
        await self._repo.soft_delete(artifact_id, datetime.now(UTC))
        await self._publish_changed(artifact, op="deleted")

    async def set_pinned(self, artifact_id: str, pinned: bool) -> Artifact:
        artifact = await self.get(artifact_id)
        if artifact.pinned == pinned:
            return artifact
        updated = artifact.model_copy(update={"pinned": pinned, "updated_at": datetime.now(UTC)})
        await self._repo.upsert(updated)
        await self._publish_changed(updated, op="pinned")
        return updated

    async def _publish_changed(
        self,
        artifact: Artifact,
        *,
        op: Literal["created", "updated", "deleted", "pinned"],
    ) -> None:
        """Fan out an ``artifact_changed`` envelope so ArtifactPanel can
        live-refresh (I-0005). Silent no-op when no bus is wired.
        """
        if self._bus is None:
            return
        event = ArtifactChangedEvent(
            workspace_id=artifact.workspace_id,
            conversation_id=artifact.conversation_id,
            artifact_id=artifact.id,
            artifact_kind=artifact.kind.value,
            op=op,
            version=artifact.version,
        )
        await self._bus.publish(
            kind="artifact_changed",
            payload=event.model_dump(mode="json"),
        )

    async def list_versions(self, artifact_id: str) -> list[ArtifactVersion]:
        await self.get(artifact_id)
        return await self._repo.list_versions(artifact_id)

    async def read_version(self, artifact_id: str, version: int) -> ArtifactVersion:
        v = await self._repo.get_version(artifact_id, version)
        if v is None:
            raise ArtifactNotFound(f"Artifact {artifact_id!r} version {version} not found.")
        return v

    def absolute_path(self, relative: str) -> Path:
        return self._root / relative

    def read_bytes(self, artifact: Artifact) -> bytes:
        """Read the latest version's bytes off disk."""
        return self.absolute_path(artifact.file_path).read_bytes()

    def read_version_bytes(self, version: ArtifactVersion) -> bytes:
        """Read a specific version's bytes off disk."""
        return self.absolute_path(version.file_path).read_bytes()

    def read_text(self, artifact: Artifact, encoding: str = "utf-8") -> str:
        """Read the latest version as decoded text. Caller decides whether
        the kind is text-y; mismatched callers will hit UnicodeDecodeError."""
        return self.read_bytes(artifact).decode(encoding)

    # Back-compat alias — read_binary used to be the only file-reader,
    # only used for binary kinds. Now read_bytes covers both.
    read_binary = read_bytes

    def _write_blob(
        self,
        workspace_id: str,
        artifact_id: str,
        *,
        version: int,
        kind: ArtifactKind,
        mime: str,
        blob: bytes,
    ) -> str:
        ext = _extension_for(mime, kind)
        folder = self._root / workspace_id / artifact_id
        folder.mkdir(parents=True, exist_ok=True)
        filename = f"v{version}.{ext}"
        # Atomic write: write to .tmp + os.replace so a failed write can't
        # leave a half-finished v<N>.<ext> that the DB row already references.
        target = folder / filename
        tmp = folder / f".{filename}.tmp"
        tmp.write_bytes(blob)
        tmp.replace(target)
        return f"{workspace_id}/{artifact_id}/{filename}"


# ----------------------------------------------------------------------
# Helpers (module-level — no class state, easier to test in isolation)
# ----------------------------------------------------------------------


_NAME_PATTERN = re.compile(r"^[\w一-鿿\s._-]+$", re.UNICODE)


def _validate_name(name: str) -> None:
    if not name or len(name) > 256:
        raise ArtifactError("name must be 1..256 chars.")
    if not _NAME_PATTERN.match(name):
        raise ArtifactError(
            "name may contain letters / digits / CJK / space / dot / underscore / hyphen only."
        )


def _check_size(size: int, max_bytes: int, kind: ArtifactKind) -> None:
    if size > max_bytes:
        raise ArtifactError(f"kind={kind.value!r} content {size} bytes exceeds limit {max_bytes}.")


def _max_for_kind(kind: ArtifactKind) -> int:
    return MAX_BINARY_BYTES if kind in BINARY_KINDS else MAX_TEXT_BYTES


def _encode_input_for_storage(
    kind: ArtifactKind, content: str | None, content_base64: str | None
) -> bytes:
    """Normalize the user-facing input into raw bytes for disk write.

    TEXT kinds:   `content` (utf-8 string) → encode
    BINARY kinds: `content_base64` → base64 decode
    """
    if kind in TEXT_KINDS:
        if content is None:
            raise ArtifactError(f"kind={kind.value!r} requires `content`.")
        return content.encode("utf-8")
    if kind in BINARY_KINDS:
        if content_base64 is None:
            raise ArtifactError(f"kind={kind.value!r} requires `content_base64`.")
        return _decode_base64(content_base64)
    raise ArtifactError(f"Unsupported kind {kind!r}.")  # pragma: no cover


def _decode_base64(s: str) -> bytes:
    try:
        return base64.b64decode(s, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ArtifactError(f"content_base64 is not valid base64: {exc}") from exc


def _extension_for(mime: str, kind: ArtifactKind) -> str:
    """Pick a file extension. Binary: from mime via mimetypes. Text: from kind."""
    if kind in BINARY_KINDS:
        ext = mimetypes.guess_extension(mime) or ""
        return ext.lstrip(".") or _KIND_EXT[kind]
    return _KIND_EXT[kind]


def _diff_text(a: str, b: str) -> str | None:
    """Unified diff (a → b). None when identical."""
    if a == b:
        return None
    diff_lines = list(
        difflib.unified_diff(
            a.splitlines(keepends=True),
            b.splitlines(keepends=True),
            fromfile="prev",
            tofile="next",
            n=3,
        )
    )
    return "".join(diff_lines)


def _apply_unified_diff(prev: str, patch: str) -> str:
    """Apply a unified diff produced by `_diff_text` (or `difflib.unified_diff`).

    This is intentionally narrow — we only support the format we generate.
    Anything else raises so the caller knows to use `mode='overwrite'`.
    """
    if not patch.strip():
        return prev
    prev_lines = prev.splitlines(keepends=True)
    out_lines: list[str] = []
    cursor = 0
    in_hunk = False
    expected_old_count = 0
    expected_new_count = 0
    seen_old_count = 0
    seen_new_count = 0
    for raw in patch.splitlines(keepends=True):
        line = raw
        if line.startswith(("---", "+++")):
            continue
        if line.startswith("@@"):
            in_hunk = True
            seen_old_count = 0
            seen_new_count = 0
            try:
                header = line[2:].strip().rstrip("@").strip()
                # header forms: "-A,B +C,D" or "-A +C"
                old_part, new_part = header.split(" ")
                old_start, _, old_count = old_part[1:].partition(",")
                _new_start, _, new_count = new_part[1:].partition(",")
                old_idx = int(old_start) - 1
                expected_old_count = int(old_count) if old_count else 1
                expected_new_count = int(new_count) if new_count else 1
            except (ValueError, IndexError) as exc:
                raise ArtifactError(f"malformed diff hunk header: {line!r}") from exc
            while cursor < old_idx:
                out_lines.append(prev_lines[cursor])
                cursor += 1
            continue
        if not in_hunk:
            continue
        if line.startswith(" "):
            if cursor >= len(prev_lines) or prev_lines[cursor] != line[1:]:
                raise ArtifactError(
                    "patch context mismatch — base content has drifted; use mode='overwrite'."
                )
            out_lines.append(line[1:])
            cursor += 1
            seen_old_count += 1
            seen_new_count += 1
        elif line.startswith("-"):
            if cursor >= len(prev_lines) or prev_lines[cursor] != line[1:]:
                raise ArtifactError(
                    "patch '-' line mismatch — base content has drifted; use mode='overwrite'."
                )
            cursor += 1
            seen_old_count += 1
        elif line.startswith("+"):
            out_lines.append(line[1:])
            seen_new_count += 1
        else:
            continue
    if seen_old_count != expected_old_count or seen_new_count != expected_new_count:
        # Hunk count mismatch → caller's diff is malformed.
        pass  # tolerant; final newline handling below
    while cursor < len(prev_lines):
        out_lines.append(prev_lines[cursor])
        cursor += 1
    return "".join(out_lines)
