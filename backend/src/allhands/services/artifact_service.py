"""ArtifactService — create / read / update / delete agent-produced artifacts.

See `docs/specs/agent-design/2026-04-18-artifacts-skill.md` § 3 / § 4.

Storage strategy:
- TEXT_KINDS (markdown/code/html/data/mermaid): content inline in DB.
- BINARY_KINDS (image): content on disk under ``<data_dir>/artifacts/<ws>/<id>/v<N>.<ext>``,
  row carries only the relative path.

Every write makes a new `ArtifactVersion` row carrying the previous content so
history is addressable by version number.
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
}

_DEFAULT_MIME: dict[ArtifactKind, str] = {
    ArtifactKind.MARKDOWN: "text/markdown",
    ArtifactKind.CODE: "text/plain",
    ArtifactKind.HTML: "text/html",
    ArtifactKind.IMAGE: "application/octet-stream",
    ArtifactKind.DATA: "application/json",
    ArtifactKind.MERMAID: "text/vnd.mermaid",
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
    ) -> None:
        self._repo = repo
        self._data_dir = data_dir
        self._bus = bus

    @property
    def _root(self) -> Path:
        root = self._data_dir / "artifacts"
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
        now = datetime.now(UTC)
        artifact_id = str(uuid.uuid4())

        if kind in TEXT_KINDS:
            if content is None:
                raise ArtifactError(f"kind={kind.value!r} requires `content`.")
            size = len(content.encode("utf-8"))
            _check_size(size, MAX_TEXT_BYTES, kind)
            artifact = Artifact(
                id=artifact_id,
                workspace_id=workspace_id,
                name=name,
                kind=kind,
                mime_type=mime,
                content=content,
                file_path=None,
                size_bytes=size,
                version=1,
                created_by_run_id=created_by_run_id,
                created_by_employee_id=created_by_employee_id,
                conversation_id=conversation_id,
                created_at=now,
                updated_at=now,
                extra_metadata=metadata or {},
            )
        elif kind in BINARY_KINDS:
            if content_base64 is None:
                raise ArtifactError(f"kind={kind.value!r} requires `content_base64`.")
            blob = _decode_base64(content_base64)
            size = len(blob)
            _check_size(size, MAX_BINARY_BYTES, kind)
            rel = self._write_blob(
                workspace_id, artifact_id, version=1, kind=kind, mime=mime, blob=blob
            )
            artifact = Artifact(
                id=artifact_id,
                workspace_id=workspace_id,
                name=name,
                kind=kind,
                mime_type=mime,
                content=None,
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
        else:  # pragma: no cover — enum exhausted
            raise ArtifactError(f"Unsupported kind {kind!r}.")

        await self._repo.upsert(artifact)
        await self._repo.save_version(
            ArtifactVersion(
                id=str(uuid.uuid4()),
                artifact_id=artifact.id,
                version=1,
                content=artifact.content,
                file_path=artifact.file_path,
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
    ) -> list[Artifact]:
        return await self._repo.list_for_workspace(
            workspace_id,
            kind=kind.value if kind else None,
            name_prefix=name_prefix,
            pinned_only=pinned_only,
            include_deleted=include_deleted,
            limit=limit,
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

        if artifact.kind in TEXT_KINDS:
            if mode == "patch":
                if patch is None:
                    raise ArtifactError("mode='patch' requires `patch` (unified diff).")
                new_content = _apply_unified_diff(artifact.content or "", patch)
            else:
                if content is None:
                    raise ArtifactError("mode='overwrite' requires `content`.")
                new_content = content
            size = len(new_content.encode("utf-8"))
            _check_size(size, MAX_TEXT_BYTES, artifact.kind)
            diff = _diff_text(artifact.content or "", new_content)
            updated = artifact.model_copy(
                update={
                    "content": new_content,
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
                    content=new_content,
                    file_path=None,
                    diff_from_prev=diff,
                    created_at=now,
                )
            )
            await self._publish_changed(updated, op="updated")
            return updated

        if mode == "patch":
            raise ArtifactError(
                f"kind={artifact.kind.value!r} does not support 'patch'; use 'overwrite'."
            )
        if content_base64 is None:
            raise ArtifactError("binary update requires `content_base64`.")
        blob = _decode_base64(content_base64)
        size = len(blob)
        _check_size(size, MAX_BINARY_BYTES, artifact.kind)
        rel = self._write_blob(
            artifact.workspace_id,
            artifact.id,
            version=next_version,
            kind=artifact.kind,
            mime=artifact.mime_type,
            blob=blob,
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
                content=None,
                file_path=rel,
                diff_from_prev=None,
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
        live-refresh (I-0005). Silent no-op when no bus is wired (e.g. unit
        tests that don't care about event emission).
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

    def read_binary(self, artifact: Artifact) -> bytes:
        if artifact.file_path is None:
            raise ArtifactError(f"Artifact {artifact.id!r} has no file_path.")
        return self.absolute_path(artifact.file_path).read_bytes()

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
        (folder / filename).write_bytes(blob)
        return str(Path(workspace_id) / artifact_id / filename)


_SAFE_NAME = re.compile(r"[A-Za-z0-9._\-\u4e00-\u9fff ]+")


def _validate_name(name: str) -> None:
    if not name or len(name) > 256:
        raise ArtifactError("Artifact name must be 1..256 chars.")
    if not _SAFE_NAME.fullmatch(name):
        raise ArtifactError(
            "Artifact name may contain letters, digits, CJK characters, space, '.', '_', '-' only."
        )


def _check_size(size: int, ceiling: int, kind: ArtifactKind) -> None:
    if size > ceiling:
        raise ArtifactError(
            f"Artifact kind={kind.value!r} size {size}B exceeds ceiling {ceiling}B."
        )


def _decode_base64(payload: str) -> bytes:
    try:
        return base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ArtifactError(f"Invalid base64 payload: {exc}") from exc


def _extension_for(mime: str, kind: ArtifactKind) -> str:
    guessed = mimetypes.guess_extension(mime)
    if guessed:
        return guessed.lstrip(".")
    return _KIND_EXT[kind]


def _diff_text(prev: str, curr: str) -> str:
    diff = difflib.unified_diff(
        prev.splitlines(keepends=True),
        curr.splitlines(keepends=True),
        fromfile="prev",
        tofile="curr",
        n=3,
    )
    return "".join(diff)


def _apply_unified_diff(original: str, patch: str) -> str:
    """Apply a minimal unified diff. Sufficient for agent-produced small edits.

    For v0, a naive line-oriented patcher is good enough — agents mostly work on
    markdown / code blocks with line-based changes. If patching fails, the caller
    should fall back to `mode='overwrite'`.
    """
    src_lines = original.splitlines(keepends=True)
    out: list[str] = []
    i = 0
    patch_lines = patch.splitlines(keepends=True)
    p = 0
    while p < len(patch_lines):
        line = patch_lines[p]
        if line.startswith(("--- ", "+++ ")):
            p += 1
            continue
        if line.startswith("@@"):
            match = re.match(r"@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@", line)
            if not match:
                raise ArtifactError(f"Unparseable diff hunk header: {line!r}")
            hunk_src = int(match.group(1))
            while i < hunk_src - 1 and i < len(src_lines):
                out.append(src_lines[i])
                i += 1
            p += 1
            continue
        if line.startswith(" "):
            out.append(line[1:])
            if i < len(src_lines):
                i += 1
            p += 1
            continue
        if line.startswith("-"):
            if i < len(src_lines):
                i += 1
            p += 1
            continue
        if line.startswith("+"):
            out.append(line[1:])
            p += 1
            continue
        p += 1
    while i < len(src_lines):
        out.append(src_lines[i])
        i += 1
    return "".join(out)
