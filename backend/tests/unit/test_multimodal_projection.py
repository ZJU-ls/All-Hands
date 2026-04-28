"""Multimodal projection — image/file attachment handling per model capability."""

from __future__ import annotations

from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path

import pytest

from allhands.core import Attachment, LLMModel
from allhands.services.multimodal_projection import (
    PER_IMAGE_MAX_BYTES,
    project_user_content,
)


def _make_attachment(
    *,
    aid: str = "att-1",
    mime: str = "image/png",
    filename: str = "x.png",
    size_bytes: int = 100,
    width: int | None = 64,
    height: int | None = 64,
    extracted_text: str | None = None,
) -> Attachment:
    return Attachment(
        id=aid,
        sha256="0" * 64,
        mime=mime,
        filename=filename,
        size_bytes=size_bytes,
        storage_path="dummy",
        width=width,
        height=height,
        extracted_text=extracted_text,
        created_at=datetime.now(UTC),
    )


def _make_model(supports_images: bool) -> LLMModel:
    return LLMModel(
        id="m1",
        provider_id="p1",
        name="claude-sonnet-4-6" if supports_images else "qwen-plus",
        supports_images=supports_images,
    )


def _png_bytes_red(size: int = 256) -> bytes:
    from PIL import Image

    img = Image.new("RGB", (16, 16), color=(255, 0, 0))
    buf = BytesIO()
    img.save(buf, format="PNG")
    data = buf.getvalue()
    if len(data) < size:
        data = data + (b"\0" * (size - len(data)))
    return data


@pytest.mark.asyncio
async def test_no_attachments_returns_text(tmp_path: Path) -> None:
    out, result = await project_user_content(
        text_content="hello",
        attachment_ids=[],
        model=_make_model(True),
        resolve_attachment=lambda _: _impossible(),  # not called
    )
    assert out == "hello"
    assert result.rendered_image_count == 0
    assert result.downgraded_image_count == 0


async def _impossible(*_: object) -> None:
    raise AssertionError("resolver should not be called when no attachments")


@pytest.mark.asyncio
async def test_vision_capable_inlines_image(tmp_path: Path) -> None:
    img_path = tmp_path / "x.png"
    img_path.write_bytes(_png_bytes_red())
    att = _make_attachment(size_bytes=img_path.stat().st_size)

    async def _resolve(aid: str) -> tuple[Attachment, Path]:
        return att, img_path

    out, result = await project_user_content(
        text_content="describe this",
        attachment_ids=[att.id],
        model=_make_model(True),
        resolve_attachment=_resolve,
    )
    assert isinstance(out, list)
    types = [p["type"] for p in out]
    assert "text" in types
    assert "image_url" in types
    assert out[1]["image_url"]["url"].startswith("data:image/png;base64,")
    assert result.rendered_image_count == 1
    assert result.downgraded_image_count == 0


@pytest.mark.asyncio
async def test_non_vision_model_falls_back_to_text(tmp_path: Path) -> None:
    img_path = tmp_path / "x.png"
    img_path.write_bytes(_png_bytes_red())
    att = _make_attachment(size_bytes=img_path.stat().st_size)

    async def _resolve(aid: str) -> tuple[Attachment, Path]:
        return att, img_path

    out, result = await project_user_content(
        text_content="describe this",
        attachment_ids=[att.id],
        model=_make_model(False),
        resolve_attachment=_resolve,
    )
    assert isinstance(out, str)
    assert "describe this" in out
    assert "Attached image" in out
    assert "x.png" in out
    assert "64×64" in out  # noqa: RUF001 - matches formatter output (U+00D7 multiplication sign)
    assert result.rendered_image_count == 0
    assert result.downgraded_image_count == 1


@pytest.mark.asyncio
async def test_oversized_image_falls_back(tmp_path: Path) -> None:
    img_path = tmp_path / "big.png"
    img_path.write_bytes(b"x")
    att = _make_attachment(size_bytes=PER_IMAGE_MAX_BYTES + 1)

    async def _resolve(aid: str) -> tuple[Attachment, Path]:
        return att, img_path

    out, result = await project_user_content(
        text_content="see",
        attachment_ids=[att.id],
        model=_make_model(True),
        resolve_attachment=_resolve,
    )
    assert isinstance(out, list)
    txt = "\n".join(p.get("text", "") for p in out if p["type"] == "text")
    assert "too large to inline" in txt
    assert result.rendered_image_count == 0
    assert result.downgraded_image_count == 1


@pytest.mark.asyncio
async def test_per_turn_budget_enforced(tmp_path: Path) -> None:
    img_path = tmp_path / "x.png"
    img_path.write_bytes(_png_bytes_red())
    # Each image just under PER_IMAGE_MAX_BYTES, but accumulating over the
    # PER_TURN cap.
    # First image fits under per-image cap but eats most of the per-turn cap
    first_size = PER_IMAGE_MAX_BYTES - 100  # 4 MiB - 100 = ~4.19 MiB
    second_size = PER_IMAGE_MAX_BYTES - 100  # another ~4.19 MiB → exceeds 5 MiB cap
    big = _make_attachment(aid="a1", size_bytes=first_size)
    small = _make_attachment(aid="a2", size_bytes=second_size)

    async def _resolve(aid: str) -> tuple[Attachment, Path]:
        return (big if aid == "a1" else small), img_path

    out, result = await project_user_content(
        text_content="see",
        attachment_ids=["a1", "a2"],
        model=_make_model(True),
        resolve_attachment=_resolve,
    )
    assert isinstance(out, list)
    text_blocks = [p for p in out if p["type"] == "text"]
    assert any("budget exceeded" in p["text"] for p in text_blocks)
    assert result.rendered_image_count == 1
    assert result.downgraded_image_count == 1


@pytest.mark.asyncio
async def test_pdf_file_text_extracted(tmp_path: Path) -> None:
    pdf_path = tmp_path / "doc.pdf"
    pdf_path.write_bytes(b"%PDF-1.4")  # not a real PDF but extracted_text already set
    att = _make_attachment(
        aid="f1",
        mime="application/pdf",
        filename="doc.pdf",
        size_bytes=8,
        width=None,
        height=None,
        extracted_text="page 1\nimportant numbers: 42",
    )

    async def _resolve(aid: str) -> tuple[Attachment, Path]:
        return att, pdf_path

    out, result = await project_user_content(
        text_content="summarize",
        attachment_ids=["f1"],
        model=_make_model(True),
        resolve_attachment=_resolve,
    )
    # No image → string content (file-only branch). LangChain accepts string.
    assert isinstance(out, str)
    assert "Attached file: doc.pdf" in out
    assert "important numbers: 42" in out
    assert result.file_count == 1


@pytest.mark.asyncio
async def test_file_text_branch_for_non_vision_model(tmp_path: Path) -> None:
    pdf_path = tmp_path / "doc.pdf"
    pdf_path.write_bytes(b"%PDF-1.4")
    att = _make_attachment(
        aid="f1",
        mime="application/pdf",
        filename="doc.pdf",
        size_bytes=8,
        width=None,
        height=None,
        extracted_text="content",
    )

    async def _resolve(aid: str) -> tuple[Attachment, Path]:
        return att, pdf_path

    out, result = await project_user_content(
        text_content="summarize",
        attachment_ids=["f1"],
        model=_make_model(False),
        resolve_attachment=_resolve,
    )
    assert isinstance(out, str)
    assert "summarize" in out
    assert "doc.pdf" in out
    assert "content" in out
    assert result.file_count == 1


@pytest.mark.asyncio
async def test_unknown_attachment_skipped(tmp_path: Path) -> None:
    async def _resolve(aid: str) -> None:
        return None

    out, result = await project_user_content(
        text_content="hello",
        attachment_ids=["does-not-exist"],
        model=_make_model(True),
        resolve_attachment=_resolve,
    )
    assert out == "hello"
    assert result.rendered_image_count == 0


@pytest.mark.asyncio
async def test_no_model_treated_as_non_vision(tmp_path: Path) -> None:
    img_path = tmp_path / "x.png"
    img_path.write_bytes(_png_bytes_red())
    att = _make_attachment(size_bytes=img_path.stat().st_size)

    async def _resolve(aid: str) -> tuple[Attachment, Path]:
        return att, img_path

    out, result = await project_user_content(
        text_content="hi",
        attachment_ids=[att.id],
        model=None,
        resolve_attachment=_resolve,
    )
    assert isinstance(out, str)
    assert result.downgraded_image_count == 1


@pytest.mark.asyncio
async def test_text_only_input_with_images_only(tmp_path: Path) -> None:
    """User can send images with no text (just dragging in an image)."""
    img_path = tmp_path / "x.png"
    img_path.write_bytes(_png_bytes_red())
    att = _make_attachment(size_bytes=img_path.stat().st_size)

    async def _resolve(aid: str) -> tuple[Attachment, Path]:
        return att, img_path

    out, result = await project_user_content(
        text_content="",
        attachment_ids=[att.id],
        model=_make_model(True),
        resolve_attachment=_resolve,
    )
    assert isinstance(out, list)
    assert any(p["type"] == "image_url" for p in out)
    # No text part since input was empty
    assert all(p.get("type") != "text" or p.get("text") for p in out)
    assert result.rendered_image_count == 1
