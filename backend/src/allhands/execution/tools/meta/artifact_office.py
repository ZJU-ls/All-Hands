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
        "Build a .pptx deck from low-level shape primitives. Each slide "
        "carries an explicit `shapes` list — primitives are `text` / "
        "`rect` / `line` / `image` / `chart` — with absolute (x, y, w, h) "
        "coordinates in inches. The tool has no opinion on layout, "
        "color, or typography; the caller supplies all visual choices. "
        "Layout templates and design tokens live in design skills (e.g. "
        "read_skill_file('allhands-design', 'templates/<name>.json') "
        "returns a ready-to-paste slide spec). Default canvas is 16:9 "
        '(13.333"x7.5"). Per-slide background and speaker notes are '
        "supported via `slides[i].background` and `slides[i].notes`."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "page": {
                "type": "object",
                "properties": {
                    "width_in": {"type": "number", "minimum": 1, "maximum": 56},
                    "height_in": {"type": "number", "minimum": 1, "maximum": 56},
                    "background": {
                        "type": "object",
                        "properties": {
                            "color_hex": {
                                "type": "string",
                                "pattern": "^#[0-9a-fA-F]{6}$",
                            }
                        },
                    },
                },
            },
            "slides": {
                "type": "array",
                "minItems": 1,
                "items": {
                    "type": "object",
                    "properties": {
                        "background": {
                            "type": "object",
                            "properties": {
                                "color_hex": {
                                    "type": "string",
                                    "pattern": "^#[0-9a-fA-F]{6}$",
                                }
                            },
                        },
                        "shapes": {
                            "type": "array",
                            "minItems": 1,
                            "items": {
                                "type": "object",
                                "properties": {
                                    "type": {
                                        "type": "string",
                                        "enum": [
                                            "text",
                                            "rect",
                                            "line",
                                            "image",
                                            "chart",
                                        ],
                                    }
                                },
                                "required": ["type"],
                            },
                        },
                        "notes": {"type": "string"},
                    },
                    "required": ["shapes"],
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


RENDER_DRAWIO_TOOL = Tool(
    id="allhands.artifacts.render_drawio",
    kind=ToolKind.META,
    name="render_drawio",
    description=(
        "Single-call drawio diagram. Pass mxfile XML; the tool persists it as a "
        "drawio artifact AND returns a render envelope so the chat shows the "
        "diagram inline. **Do not** call artifact_create / artifact_render "
        "separately — this tool does both. **Do not** paste the XML back into "
        "your reply — the rendered card already shows the diagram. Use this for "
        "any 「画 drawio」「画流程图 / 时序图 / 架构图 / ER 图 / 思维导图」request. "
        'Example: {"name":"login-flow.drawio","xml":"<mxfile><diagram>...</diagram></mxfile>"}. '
        "If `xml` doesn't begin with `<mxfile`, it is auto-wrapped with the "
        "minimum mxfile/diagram/mxGraphModel/root scaffolding so renderer-ready "
        "fragments still work."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": (
                    "User-facing title. `.drawio` suffix added automatically if missing."
                ),
            },
            "xml": {
                "type": "string",
                "description": (
                    "mxfile XML body. Should include the full `<mxfile>` envelope; "
                    "bare `<mxGraphModel>` fragments are auto-wrapped."
                ),
            },
            "description": {"type": "string"},
            "tags": {"type": "array", "items": {"type": "string"}},
            "change_message": {"type": "string"},
        },
        "required": ["name", "xml"],
    },
    output_schema={
        "type": "object",
        "properties": {
            "component": {"type": "string"},
            "props": {"type": "object"},
        },
    },
    scope=ToolScope.WRITE,
    requires_confirmation=False,
)


ALL_ARTIFACT_OFFICE_TOOLS = [
    ARTIFACT_CREATE_PDF_TOOL,
    ARTIFACT_CREATE_XLSX_TOOL,
    ARTIFACT_CREATE_CSV_TOOL,
    ARTIFACT_CREATE_DOCX_TOOL,
    ARTIFACT_CREATE_PPTX_TOOL,
    RENDER_DRAWIO_TOOL,
]
