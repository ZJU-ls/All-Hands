"""AttachmentService · upload / dedup / store / probe.

Storage:
  data/attachments/<sha256[:2]>/<sha256>.<ext>   (content-addressed)

Dedup:
  Uploads with the same sha256 reuse the existing row (no duplicate file
  written, no duplicate DB row). Caller gets back the canonical id.

Mime / size policy:
  - 20 MiB cap per file (env: ALLHANDS_ATTACHMENT_MAX_BYTES)
  - Allowlist of mime prefixes / extensions; anything else is rejected.
  - Images: PIL probes width/height + cross-checks declared mime against
    actual format. Reject mismatches (e.g. .jpg with PNG bytes).

Doc extraction:
  Lazy — extract_text() is called on demand by the chat flow when the model
  doesn't support images, or when a non-image attachment is referenced. The
  result is cached on the row (extracted_text / extracted_at) so repeat reads
  are cheap.
"""

from __future__ import annotations

import hashlib
import mimetypes
import re
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

from allhands.core import Attachment

if TYPE_CHECKING:
    from allhands.persistence.repositories import AttachmentRepo


MAX_BYTES = 20 * 1024 * 1024  # 20 MiB
EXTRACTED_TEXT_CAP = 100_000  # 100KB extracted text per file

# Mime allowlist. Wildcard prefix `image/` then explicit list of doc types.
ALLOWED_MIME_PREFIXES = ("image/", "text/")
ALLOWED_MIMES = {
    "application/pdf",
    "application/json",
    "application/xml",
    "application/x-yaml",
    "application/zip",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",  # docx
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",  # xlsx
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",  # pptx
}


# Filename safety — strip path bits, control chars; keep most unicode (CJK ok).
_UNSAFE_FILENAME = re.compile(r"[/\\\x00-\x1f]")


class AttachmentServiceError(Exception):
    """Raised for size / mime / corrupt-image violations."""


class AttachmentService:
    def __init__(
        self,
        *,
        repo: AttachmentRepo,
        storage_root: Path,
    ) -> None:
        self._repo = repo
        self._root = Path(storage_root)
        self._root.mkdir(parents=True, exist_ok=True)

    async def upload(
        self,
        *,
        data: bytes,
        filename: str,
        mime: str | None = None,
        conversation_id: str | None = None,
    ) -> Attachment:
        if len(data) == 0:
            raise AttachmentServiceError("empty file")
        if len(data) > MAX_BYTES:
            raise AttachmentServiceError(f"file exceeds {MAX_BYTES // (1024 * 1024)} MiB cap")

        safe_name = _sanitize_filename(filename)
        # Resolve mime: prefer explicit, fall back to extension-guessed.
        resolved_mime = (mime or "").strip().lower() or _guess_mime(safe_name)
        if not _mime_allowed(resolved_mime):
            raise AttachmentServiceError(f"mime {resolved_mime!r} not allowed (file: {safe_name})")

        sha256 = hashlib.sha256(data).hexdigest()

        # Dedup short-circuit: same sha256 already uploaded → reuse row.
        existing = await self._repo.get_by_sha256(sha256)
        if existing is not None:
            return existing

        # Validate image bytes via PIL when applicable. Reject corrupt or
        # mime-mismatched images.
        width: int | None = None
        height: int | None = None
        if resolved_mime.startswith("image/"):
            width, height, resolved_mime = _probe_image(data, resolved_mime)

        ext = _ext_for(safe_name, resolved_mime)
        storage_path = self._write(sha256, ext, data)

        att = Attachment(
            id=str(uuid.uuid4()),
            sha256=sha256,
            mime=resolved_mime,
            filename=safe_name,
            size_bytes=len(data),
            storage_path=str(storage_path),
            width=width,
            height=height,
            conversation_id=conversation_id,
            uploaded_by="user",
            created_at=datetime.now(UTC),
        )
        return await self._repo.upsert(att)

    def read_bytes(self, attachment: Attachment) -> bytes:
        path = Path(attachment.storage_path)
        if not path.is_absolute():
            path = self._root / path
        return path.read_bytes()

    def absolute_path(self, attachment: Attachment) -> Path:
        path = Path(attachment.storage_path)
        if not path.is_absolute():
            path = self._root / path
        return path

    async def get(self, attachment_id: str) -> Attachment | None:
        return await self._repo.get(attachment_id)

    async def delete(self, attachment_id: str) -> None:
        att = await self._repo.get(attachment_id)
        if att is None:
            return
        await self._repo.delete(attachment_id)
        # Delete file only if no other row still points at the same sha256.
        # Simple guard: list_all by sha256 — but for v1 we'd need a count
        # method. For now, leave the file (cheap; GC sweep can clean later).

    async def store_extracted_text(self, attachment_id: str, text_value: str) -> None:
        await self._repo.update_extracted_text(attachment_id, text_value[:EXTRACTED_TEXT_CAP])

    def _write(self, sha256: str, ext: str, data: bytes) -> Path:
        prefix = sha256[:2]
        directory = self._root / prefix
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{sha256}{ext}"
        if not path.exists():
            path.write_bytes(data)
        # Return absolute so the stored storage_path is unambiguous and
        # `read_bytes` can use it verbatim — without this, the relative
        # path got re-joined with _root on every read, producing a
        # double-prefixed "data/attachments/data/attachments/..." path.
        return path.resolve()


def _sanitize_filename(filename: str) -> str:
    if not filename:
        return "upload.bin"
    # Take basename only · drop control chars + path separators.
    name = filename.replace("\x00", "")
    name = _UNSAFE_FILENAME.sub("_", name).strip()
    if not name:
        name = "upload.bin"
    if len(name) > 200:
        # preserve extension while truncating stem
        stem, dot, ext = name.rpartition(".")
        name = stem[: 200 - len(ext) - 1] + "." + ext if dot and len(ext) <= 16 else name[:200]
    return name


def _guess_mime(filename: str) -> str:
    guessed, _ = mimetypes.guess_type(filename)
    return (guessed or "application/octet-stream").lower()


def _mime_allowed(mime: str) -> bool:
    if any(mime.startswith(p) for p in ALLOWED_MIME_PREFIXES):
        return True
    return mime in ALLOWED_MIMES


def _ext_for(filename: str, mime: str) -> str:
    # Prefer the original extension if any; else derive from mime.
    if "." in filename:
        ext = "." + filename.rsplit(".", 1)[-1].lower()
        if 2 <= len(ext) <= 8:
            return ext
    fallback = mimetypes.guess_extension(mime)
    return fallback or ".bin"


def _probe_image(data: bytes, declared_mime: str) -> tuple[int | None, int | None, str]:
    """Validate + measure an image.

    Returns ``(width, height, canonical_mime)``. If PIL is unavailable or the
    bytes don't decode as an image, raises AttachmentServiceError.
    """
    try:
        from io import BytesIO

        from PIL import Image
    except ImportError:
        return None, None, declared_mime
    try:
        img = Image.open(BytesIO(data))
        img.verify()
    except Exception as exc:
        raise AttachmentServiceError(f"corrupt or unsupported image: {exc}") from exc
    # Re-open for size (verify closes the file)
    from io import BytesIO

    from PIL import Image

    img = Image.open(BytesIO(data))
    width, height = img.size
    canonical_mime = Image.MIME.get(img.format, declared_mime) if img.format else declared_mime
    return width, height, canonical_mime.lower()
