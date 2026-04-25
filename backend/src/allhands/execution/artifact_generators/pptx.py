"""PPTX generator · slide list → .pptx bytes via python-pptx.

Spec: docs/specs/2026-04-25-artifact-kinds-roadmap.md § 2.5.

Supported layouts:
- title       ``{"layout": "title", "title": str, "subtitle": str?}``
- bullets     ``{"layout": "bullets", "title": str, "bullets": list[str]}``
- section     ``{"layout": "section", "title": str}``
- image-right ``{"layout": "image-right", "title": str, "body": str?,
                 "image_url": str}``  — body left, image right

Render-side preview is intentionally low-fidelity (slide-text list);
the .pptx itself is full-fidelity Office-compatible output.
"""

from __future__ import annotations

import io
from typing import Any

from allhands.execution.artifact_generators.pdf import ArtifactGenerationError


def render_pptx(*, slides: list[Any]) -> tuple[bytes, list[str]]:
    """Returns ``(bytes, warnings)``. Empty slide list raises; broken
    slides are skipped with a warning."""
    if not isinstance(slides, list) or not slides:
        raise ArtifactGenerationError("pptx requires at least one slide.")

    try:
        from pptx import Presentation
        from pptx.util import Inches, Pt
    except ImportError as exc:  # pragma: no cover
        raise ArtifactGenerationError(f"python-pptx unavailable: {exc}") from exc

    warnings: list[str] = []
    prs = Presentation()

    # python-pptx's default template ships with these layout indices
    # (verified across versions 0.6 - 1.x):
    #   0 Title Slide   1 Title and Content   2 Section Header
    #   5 Title Only    6 Blank
    layouts = prs.slide_layouts
    title_layout = layouts[0]
    bullets_layout = layouts[1]
    section_layout = layouts[2] if len(layouts) > 2 else layouts[0]
    title_only_layout = layouts[5] if len(layouts) > 5 else layouts[1]

    for idx, spec in enumerate(slides):
        if not isinstance(spec, dict):
            warnings.append(f"slides[{idx}] is not an object — skipped")
            continue
        layout_name = str(spec.get("layout", "bullets"))
        title_text = str(spec.get("title", ""))
        try:
            if layout_name == "title":
                slide = prs.slides.add_slide(title_layout)
                slide.shapes.title.text = title_text
                if (
                    spec.get("subtitle")
                    and len(slide.placeholders) > 1
                ):
                    slide.placeholders[1].text = str(spec["subtitle"])
            elif layout_name == "bullets":
                slide = prs.slides.add_slide(bullets_layout)
                slide.shapes.title.text = title_text
                bullets = spec.get("bullets") or []
                if bullets and len(slide.placeholders) > 1:
                    body = slide.placeholders[1].text_frame
                    body.clear()
                    for i, bullet in enumerate(bullets):
                        p = body.paragraphs[0] if i == 0 else body.add_paragraph()
                        p.text = str(bullet)
                        p.font.size = Pt(18)
            elif layout_name == "section":
                slide = prs.slides.add_slide(section_layout)
                slide.shapes.title.text = title_text
            elif layout_name == "image-right":
                slide = prs.slides.add_slide(title_only_layout)
                slide.shapes.title.text = title_text
                body_text = str(spec.get("body", ""))
                if body_text:
                    tb = slide.shapes.add_textbox(
                        Inches(0.5), Inches(2.0), Inches(4.5), Inches(4.0)
                    )
                    tb.text_frame.text = body_text
                # Image fetch is out of scope (sandbox / network risk);
                # skipped with a warning so the deck still ships.
                if spec.get("image_url"):
                    warnings.append(
                        f"slides[{idx}] image_url ignored — fetch deferred to v1"
                    )
            else:
                warnings.append(f"slides[{idx}] unknown layout {layout_name!r} — bullets fallback")
                slide = prs.slides.add_slide(bullets_layout)
                slide.shapes.title.text = title_text
        except Exception as exc:
            warnings.append(f"slides[{idx}] render failed: {exc}")

    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue(), warnings


def extract_slide_text(blob: bytes) -> list[dict[str, Any]]:
    """Read a .pptx blob and return ``[{title, body[]}, ...]``.

    Used by the render endpoint when the frontend pptx viewer wants a
    text outline (preview-meta strategy in the spec). Pure read — no
    side effects. Returns ``[]`` if the blob is unparseable so the UI
    can show 「N 张幻灯片 · 无法解析文本」 fallback cleanly.
    """
    try:
        from pptx import Presentation
    except ImportError:  # pragma: no cover
        return []
    try:
        prs = Presentation(io.BytesIO(blob))
    except Exception:
        return []

    out: list[dict[str, Any]] = []
    for slide in prs.slides:
        title: str = ""
        body: list[str] = []
        for shape in slide.shapes:
            if not shape.has_text_frame:
                continue
            for para in shape.text_frame.paragraphs:
                text = "".join(run.text for run in para.runs).strip()
                if not text:
                    continue
                # placeholder index 0 is the title in default layouts
                if not title and getattr(shape, "is_placeholder", False) and getattr(
                    shape.placeholder_format, "idx", -1
                ) == 0:
                    title = text
                else:
                    body.append(text)
        out.append({"title": title, "body": body})
    return out
