"""PDF generator · markdown / html → PDF bytes via weasyprint.

Spec: docs/specs/2026-04-25-artifact-kinds-roadmap.md § 2.1.

Why weasyprint over alternatives:
- pure python · no headless browser process to manage
- handles markdown→html→pdf in <100ms for typical content
- known limitations (no JS, no @page CSS animations) are fine for agent-
  produced reports; the bigger reportlab API is overkill for our flow

Failure mode: weasyprint raises on broken HTML / inaccessible images. We
catch + re-wrap as ``ArtifactGenerationError`` so the executor can return a
clean ``{"error": ...}`` envelope to the agent.
"""

from __future__ import annotations

import logging
from typing import Literal

from allhands.core.errors import DomainError

log = logging.getLogger(__name__)


class ArtifactGenerationError(DomainError):
    """A generator failed during build. Surface to agent as tool error."""


_HTML_SHELL = """<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>{title}</title>
<style>
  @page {{ size: A4; margin: 24mm 18mm; }}
  body {{ font-family: "Helvetica", "PingFang SC", "Microsoft YaHei", sans-serif; line-height: 1.6; color: #1a1a1a; }}
  h1, h2, h3, h4 {{ color: #0a2540; margin-top: 1.2em; }}
  h1 {{ font-size: 22px; border-bottom: 1px solid #ccc; padding-bottom: 6px; }}
  h2 {{ font-size: 18px; }}
  h3 {{ font-size: 15px; }}
  p, li {{ font-size: 11pt; }}
  pre, code {{ font-family: "SFMono-Regular", "Menlo", "Consolas", monospace; }}
  pre {{ background: #f6f8fa; border: 1px solid #e1e4e8; border-radius: 6px;
         padding: 10px 12px; font-size: 9.5pt; overflow-x: auto; }}
  code {{ background: #f6f8fa; padding: 1px 4px; border-radius: 4px; font-size: 9.5pt; }}
  table {{ border-collapse: collapse; width: 100%; margin: 8px 0; }}
  th, td {{ border: 1px solid #ddd; padding: 6px 8px; font-size: 10pt; text-align: left; }}
  th {{ background: #f0f3f7; }}
  blockquote {{ border-left: 3px solid #ccc; margin-left: 0; padding-left: 10px; color: #555; }}
  img {{ max-width: 100%; }}
</style>
</head>
<body>
{body}
</body>
</html>
"""


def render_pdf(
    *,
    source: Literal["markdown", "html"],
    content: str,
    title: str | None = None,
) -> bytes:
    """Build PDF bytes from markdown or HTML source.

    - source="markdown" → markdown-it converts to HTML first
    - source="html"     → content is wrapped if it lacks <html>; raw HTML
      with <html> is forwarded unchanged

    Raises ArtifactGenerationError on render failure (broken HTML, weasyprint
    crash, missing system libs). The caller (executor) maps this to an error
    envelope so the agent gets a structured failure rather than a 500.
    """
    if not content:
        raise ArtifactGenerationError("content is required for pdf generation.")

    if source == "markdown":
        try:
            from markdown_it import MarkdownIt
        except ImportError as exc:  # pragma: no cover
            raise ArtifactGenerationError(
                "markdown-it-py not installed; pdf with source='markdown' unavailable"
            ) from exc
        md = MarkdownIt("commonmark", {"html": True, "linkify": True}).enable("table")
        body_html = md.render(content)
        html = _HTML_SHELL.format(title=_escape_title(title or "report"), body=body_html)
    else:
        # source == "html"
        if "<html" in content.lower():
            html = content
        else:
            html = _HTML_SHELL.format(title=_escape_title(title or "report"), body=content)

    try:
        # weasyprint imports cairo/pango at module-load; defer to call site so
        # tests on systems without those libs can still import this module.
        from weasyprint import HTML  # type: ignore[import-untyped]
    except (ImportError, OSError) as exc:
        raise ArtifactGenerationError(
            f"weasyprint unavailable (install cairo/pango on the host): {exc}"
        ) from exc

    try:
        return HTML(string=html).write_pdf()  # type: ignore[no-any-return]
    except Exception as exc:
        log.exception("pdf.render.failed")
        raise ArtifactGenerationError(f"pdf render failed: {exc}") from exc


def _escape_title(t: str) -> str:
    """Minimal title escape for the inline <title> tag."""
    return t.replace("<", "&lt;").replace(">", "&gt;")
