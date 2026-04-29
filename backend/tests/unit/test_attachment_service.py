"""Unit tests for AttachmentService — upload / dedup / mime / image probe."""

from __future__ import annotations

from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path

import pytest

from allhands.core import Attachment
from allhands.services.attachment_service import (
    MAX_BYTES,
    AttachmentService,
    AttachmentServiceError,
)


class _InMemRepo:
    def __init__(self) -> None:
        self._by_id: dict[str, Attachment] = {}
        self._by_sha: dict[str, str] = {}

    async def get(self, attachment_id: str) -> Attachment | None:
        return self._by_id.get(attachment_id)

    async def get_by_sha256(self, sha256: str) -> Attachment | None:
        i = self._by_sha.get(sha256)
        return self._by_id.get(i) if i else None

    async def list_for_conversation(self, conversation_id: str) -> list[Attachment]:
        return [a for a in self._by_id.values() if a.conversation_id == conversation_id]

    async def upsert(self, att: Attachment) -> Attachment:
        self._by_id[att.id] = att
        self._by_sha[att.sha256] = att.id
        return att

    async def update_extracted_text(self, attachment_id: str, text_value: str) -> None:
        a = self._by_id.get(attachment_id)
        if a is not None:
            self._by_id[attachment_id] = a.model_copy(
                update={"extracted_text": text_value, "extracted_at": datetime.now(UTC)}
            )

    async def delete(self, attachment_id: str) -> None:
        a = self._by_id.pop(attachment_id, None)
        if a is not None:
            self._by_sha.pop(a.sha256, None)


def _make_service(tmp_path: Path) -> AttachmentService:
    return AttachmentService(repo=_InMemRepo(), storage_root=tmp_path / "att")


def _png_bytes() -> bytes:
    """Tiny valid PNG (1x1 red pixel)."""
    from PIL import Image

    img = Image.new("RGB", (1, 1), color=(255, 0, 0))
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.mark.asyncio
async def test_upload_text_file(tmp_path: Path) -> None:
    svc = _make_service(tmp_path)
    att = await svc.upload(data=b"hello world", filename="hi.txt", mime="text/plain")
    assert att.size_bytes == 11
    assert att.mime == "text/plain"
    assert Path(att.storage_path).read_bytes() == b"hello world"


@pytest.mark.asyncio
async def test_upload_dedup_same_sha256(tmp_path: Path) -> None:
    svc = _make_service(tmp_path)
    a1 = await svc.upload(data=b"abc", filename="a.txt", mime="text/plain")
    a2 = await svc.upload(data=b"abc", filename="b.txt", mime="text/plain")
    assert a1.id == a2.id  # dedup hit
    assert a1.sha256 == a2.sha256


@pytest.mark.asyncio
async def test_upload_image_probes_dimensions(tmp_path: Path) -> None:
    svc = _make_service(tmp_path)
    att = await svc.upload(data=_png_bytes(), filename="px.png", mime="image/png")
    assert att.width == 1
    assert att.height == 1
    assert att.mime == "image/png"


@pytest.mark.asyncio
async def test_upload_rejects_corrupt_image(tmp_path: Path) -> None:
    svc = _make_service(tmp_path)
    with pytest.raises(AttachmentServiceError, match="corrupt"):
        await svc.upload(data=b"not-an-image", filename="bad.png", mime="image/png")


@pytest.mark.asyncio
async def test_upload_rejects_empty(tmp_path: Path) -> None:
    svc = _make_service(tmp_path)
    with pytest.raises(AttachmentServiceError, match="empty"):
        await svc.upload(data=b"", filename="x.txt", mime="text/plain")


@pytest.mark.asyncio
async def test_upload_rejects_oversized(tmp_path: Path) -> None:
    svc = _make_service(tmp_path)
    big = b"x" * (MAX_BYTES + 1)
    with pytest.raises(AttachmentServiceError, match="exceeds"):
        await svc.upload(data=big, filename="big.txt", mime="text/plain")


@pytest.mark.asyncio
async def test_upload_rejects_bad_mime(tmp_path: Path) -> None:
    svc = _make_service(tmp_path)
    with pytest.raises(AttachmentServiceError, match="not allowed"):
        await svc.upload(
            data=b"MZ\x90\x00",
            filename="evil.exe",
            mime="application/x-msdownload",
        )


@pytest.mark.asyncio
async def test_upload_sanitizes_filename(tmp_path: Path) -> None:
    svc = _make_service(tmp_path)
    att = await svc.upload(data=b"x", filename="../../../etc/passwd", mime="text/plain")
    assert "/" not in att.filename
    assert "\\" not in att.filename


@pytest.mark.asyncio
async def test_upload_chinese_filename(tmp_path: Path) -> None:
    svc = _make_service(tmp_path)
    att = await svc.upload(data=b"x", filename="测试报告.txt", mime="text/plain")
    assert att.filename == "测试报告.txt"


@pytest.mark.asyncio
async def test_upload_with_conversation_id(tmp_path: Path) -> None:
    svc = _make_service(tmp_path)
    att = await svc.upload(data=b"x", filename="x.txt", mime="text/plain", conversation_id="conv-1")
    assert att.conversation_id == "conv-1"


@pytest.mark.asyncio
async def test_storage_path_is_content_addressed(tmp_path: Path) -> None:
    svc = _make_service(tmp_path)
    att = await svc.upload(data=b"hello", filename="h.txt", mime="text/plain")
    # First two chars of sha256 form the directory bucket
    assert f"/{att.sha256[:2]}/{att.sha256}" in att.storage_path


@pytest.mark.asyncio
async def test_read_bytes_round_trip(tmp_path: Path) -> None:
    svc = _make_service(tmp_path)
    payload = b"round-trip me"
    att = await svc.upload(data=payload, filename="r.bin", mime="text/plain")
    assert svc.read_bytes(att) == payload


@pytest.mark.asyncio
async def test_pdf_mime_allowed(tmp_path: Path) -> None:
    svc = _make_service(tmp_path)
    att = await svc.upload(data=b"%PDF-1.4 fake", filename="x.pdf", mime="application/pdf")
    assert att.mime == "application/pdf"


@pytest.mark.asyncio
async def test_octet_stream_falls_back_to_extension(tmp_path: Path) -> None:
    """Browsers send `application/octet-stream` for files whose extension
    isn't in the OS mimetype DB (commonly .md / .yaml / .csv on Windows).

    Previously this opaque value bypassed `_guess_mime` because the truthy
    check `mime or _guess_mime()` short-circuited, so the upload was
    rejected as "not allowed" — a real-world bug reported 2026-04-29.
    """
    svc = _make_service(tmp_path)
    att = await svc.upload(data=b"# hello", filename="notes.md", mime="application/octet-stream")
    assert att.mime == "text/markdown"


@pytest.mark.asyncio
async def test_md_extension_maps_to_text_markdown(tmp_path: Path) -> None:
    """Python's stdlib mimetypes DB returns None for `.md` on some
    platforms. We seed _EXTRA_MIME so the upload still resolves to a
    text/* mime that's on the allowlist."""
    svc = _make_service(tmp_path)
    att = await svc.upload(data=b"# hello", filename="readme.md", mime=None)
    assert att.mime == "text/markdown"


@pytest.mark.asyncio
async def test_yaml_with_empty_browser_mime(tmp_path: Path) -> None:
    svc = _make_service(tmp_path)
    att = await svc.upload(data=b"key: value\n", filename="cfg.yaml", mime="")
    assert att.mime == "application/x-yaml"


@pytest.mark.asyncio
async def test_store_extracted_text(tmp_path: Path) -> None:
    svc = _make_service(tmp_path)
    att = await svc.upload(data=b"x", filename="x.pdf", mime="application/pdf")
    await svc.store_extracted_text(att.id, "extracted body text here")
    refreshed = await svc.get(att.id)
    assert refreshed is not None
    assert refreshed.extracted_text == "extracted body text here"
