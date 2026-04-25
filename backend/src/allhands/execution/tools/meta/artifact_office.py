"""Office artifact create tools (2026-04-25 spec).

Each tool takes a structured payload appropriate to its format, runs it
through an artifact_generators/* renderer, then writes the resulting
binary blob to the artifact store. Output schema is the same shape as
``artifact_create`` so the agent can chain ``artifact_render(id)``
identically across all create entry points.

The ``description`` strings include a minimal runnable example so the
LLM can copy-and-fill rather than guess at the schema. Past failures
(drawio nuked-black, pptx empty slides) tracked back to bad description
ergonomics — these tools are written defensively.
"""

from __future__ import annotations

from allhands.core import Tool, ToolKind, ToolScope

_OUTPUT_SCHEMA: dict[str, object] = {
    "type": "object",
    "properties": {
        "artifact_id": {"type": "string"},
        "version": {"type": "integer"},
        "warnings": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Non-fatal generator warnings (e.g. unknown block types skipped).",
        },
    },
}

ARTIFACT_CREATE_PDF_TOOL = Tool(
    id="allhands.artifacts.create_pdf",
    kind=ToolKind.META,
    name="artifact_create_pdf",
    description=(
        "Render a markdown / html source into a paginated PDF file. The file is "
        "stored as a binary artifact (kind=pdf) and can be previewed inline or "
        "downloaded. Use this when the user asks for a 「报告」「PDF」「正式文档」 "
        "and wants a printable/shareable artifact. Example payload: "
        '{"name":"q1-report.pdf","source":"markdown","content":"# Q1 报告\\n\\n营收增长 18%。"}'
    ),
    input_schema={
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "User-facing title incl. .pdf suffix · 1-256 chars.",
            },
            "source": {
                "type": "string",
                "enum": ["markdown", "html"],
                "description": "Format of `content`. Markdown is preferred for prose.",
            },
            "content": {
                "type": "string",
                "description": "Source body. ≤ 1MB. Inline images via data: URLs only.",
            },
            "title": {
                "type": "string",
                "description": "Optional · used as PDF metadata + <title>. Defaults to name.",
            },
            "description": {"type": "string"},
            "tags": {"type": "array", "items": {"type": "string"}},
            "change_message": {"type": "string"},
        },
        "required": ["name", "source", "content"],
    },
    output_schema=_OUTPUT_SCHEMA,
    scope=ToolScope.WRITE,
    requires_confirmation=False,
)

ARTIFACT_CREATE_XLSX_TOOL = Tool(
    id="allhands.artifacts.create_xlsx",
    kind=ToolKind.META,
    name="artifact_create_xlsx",
    description=(
        "Build a multi-sheet Excel workbook from structured rows. Each sheet "
        "has an optional `headers` (rendered bold) and a `rows` matrix. Cell "
        "types auto-infer: bool / int / float / str / null. Strings starting "
        "with '=' are escaped to prevent formula injection. Use this for any "
        "tabular output — sales / forecasts / config dumps. Example: "
        '{"name":"sales-q1.xlsx","sheets":[{"name":"Q1","headers":["产品","销量","金额"],'
        '"rows":[["A",100,9999.99],["B",50,4500]]}]}'
    ),
    input_schema={
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "sheets": {
                "type": "array",
                "minItems": 1,
                "maxItems": 100,
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "headers": {"type": "array", "items": {"type": "string"}},
                        "rows": {
                            "type": "array",
                            "items": {"type": "array"},
                            "description": "list of rows · each row is a list of cells.",
                        },
                    },
                    "required": ["rows"],
                },
            },
            "description": {"type": "string"},
            "tags": {"type": "array", "items": {"type": "string"}},
            "change_message": {"type": "string"},
        },
        "required": ["name", "sheets"],
    },
    output_schema=_OUTPUT_SCHEMA,
    scope=ToolScope.WRITE,
    requires_confirmation=False,
)

ARTIFACT_CREATE_CSV_TOOL = Tool(
    id="allhands.artifacts.create_csv",
    kind=ToolKind.META,
    name="artifact_create_csv",
    description=(
        "Single-sheet CSV. Use when the user wants a flat exportable table "
        "(or downstream tooling consumes CSV). Output is utf-8 with BOM so "
        "Excel on Windows opens CJK headers correctly. Example: "
        '{"name":"users.csv","headers":["id","email"],'
        '"rows":[[1,"a@x"],[2,"b@x"]]}'
    ),
    input_schema={
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "headers": {"type": "array", "items": {"type": "string"}},
            "rows": {"type": "array", "items": {"type": "array"}},
            "description": {"type": "string"},
            "tags": {"type": "array", "items": {"type": "string"}},
            "change_message": {"type": "string"},
        },
        "required": ["name", "rows"],
    },
    output_schema=_OUTPUT_SCHEMA,
    scope=ToolScope.WRITE,
    requires_confirmation=False,
)

ARTIFACT_CREATE_DOCX_TOOL = Tool(
    id="allhands.artifacts.create_docx",
    kind=ToolKind.META,
    name="artifact_create_docx",
    description=(
        "Word document built from a list of structured blocks. Supported "
        "block types: heading (level 1-6), paragraph, list (ordered or "
        "unordered), code (monospace paragraph), table (headers + rows). "
        "Unknown block types are skipped with a warning so a malformed "
        "block doesn't kill the whole doc. Example: "
        '{"name":"proposal.docx","blocks":['
        '{"type":"heading","level":1,"text":"Q1 提案"},'
        '{"type":"paragraph","text":"我们建议..."}]}'
    ),
    input_schema={
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "blocks": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "type": {
                            "type": "string",
                            "enum": ["heading", "paragraph", "list", "code", "table"],
                        },
                        "level": {"type": "integer", "minimum": 1, "maximum": 9},
                        "text": {"type": "string"},
                        "ordered": {"type": "boolean"},
                        "items": {"type": "array", "items": {"type": "string"}},
                        "language": {"type": "string"},
                        "headers": {"type": "array", "items": {"type": "string"}},
                        "rows": {"type": "array", "items": {"type": "array"}},
                    },
                    "required": ["type"],
                },
            },
            "description": {"type": "string"},
            "tags": {"type": "array", "items": {"type": "string"}},
            "change_message": {"type": "string"},
        },
        "required": ["name", "blocks"],
    },
    output_schema=_OUTPUT_SCHEMA,
    scope=ToolScope.WRITE,
    requires_confirmation=False,
)

ARTIFACT_CREATE_PPTX_TOOL = Tool(
    id="allhands.artifacts.create_pptx",
    kind=ToolKind.META,
    name="artifact_create_pptx",
    description=(
        "PowerPoint deck from a list of slides. Layouts: title / bullets / "
        "section / image-right. The .pptx is fully Office-compatible · the "
        "in-app preview is text-only (slide titles + bullets); users open "
        "PowerPoint or Keynote for full fidelity. Example: "
        '{"name":"deck.pptx","slides":['
        '{"layout":"title","title":"季度回顾","subtitle":"Q1 2026"},'
        '{"layout":"bullets","title":"亮点","bullets":["营收 +18%","客户 +35"]}]}'
    ),
    input_schema={
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "slides": {
                "type": "array",
                "minItems": 1,
                "items": {
                    "type": "object",
                    "properties": {
                        "layout": {
                            "type": "string",
                            "enum": ["title", "bullets", "section", "image-right"],
                            "default": "bullets",
                        },
                        "title": {"type": "string"},
                        "subtitle": {"type": "string"},
                        "bullets": {"type": "array", "items": {"type": "string"}},
                        "body": {"type": "string"},
                        "image_url": {"type": "string"},
                    },
                    "required": ["title"],
                },
            },
            "description": {"type": "string"},
            "tags": {"type": "array", "items": {"type": "string"}},
            "change_message": {"type": "string"},
        },
        "required": ["name", "slides"],
    },
    output_schema=_OUTPUT_SCHEMA,
    scope=ToolScope.WRITE,
    requires_confirmation=False,
)


ALL_ARTIFACT_OFFICE_TOOLS = [
    ARTIFACT_CREATE_PDF_TOOL,
    ARTIFACT_CREATE_XLSX_TOOL,
    ARTIFACT_CREATE_CSV_TOOL,
    ARTIFACT_CREATE_DOCX_TOOL,
    ARTIFACT_CREATE_PPTX_TOOL,
]
