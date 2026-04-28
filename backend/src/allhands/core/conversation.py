"""Conversation, Message, ToolCall, RenderPayload domain models."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, Field, model_validator

MessageRole = Literal["user", "assistant", "tool", "system"]


class ToolCallStatus(StrEnum):
    PENDING = "pending"
    AWAITING_CONFIRMATION = "awaiting_confirmation"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    REJECTED = "rejected"


class ToolCall(BaseModel):
    id: str
    tool_id: str
    args: dict[str, object]
    status: ToolCallStatus
    result: object | None = None
    error: str | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None


class InteractionSpec(BaseModel):
    kind: Literal["button", "form_submit", "link"]
    label: str
    action: str  # "invoke_tool" | "send_message" | "navigate"
    payload: dict[str, object] = Field(default_factory=dict)


class RenderPayload(BaseModel):
    component: str
    props: dict[str, object] = Field(default_factory=dict)
    interactions: list[InteractionSpec] = Field(default_factory=list)


# --- Content blocks (ADR 0018) ----------------------------------------------
# AgentLoop emits internal events carrying typed content_blocks rather
# than a flat ``content: str``. Persistence keeps ``content`` for back-compat
# (concatenated text); ``content_blocks`` is the authoritative source for
# new code paths (execution/agent_loop, execution/tool_pipeline, internal
# event protocol).


class TextBlock(BaseModel):
    type: Literal["text"] = "text"
    text: str


class ToolUseBlock(BaseModel):
    type: Literal["tool_use"] = "tool_use"
    id: str
    name: str
    input: dict[str, object]


class ReasoningBlock(BaseModel):
    """Extended-thinking output (Anthropic) or reasoning channel (Qwen3 /
    DeepSeek-R1). NOT user-facing text — surfaces in the dedicated
    reasoning UI surface."""

    type: Literal["reasoning"] = "reasoning"
    text: str


class ImageBlock(BaseModel):
    """User-uploaded image referenced by attachment_id.

    The bytes live in the ``attachments`` table / on disk; the message just
    holds the pointer + cached metadata so the chat list can render the
    thumbnail without touching the filesystem.

    Capability-aware projection: AgentLoop reads ``LLMModel.supports_images``
    on the resolved model; if True the loop fetches bytes and embeds them as
    a base64 image_url part on HumanMessage; if False it injects a textual
    description (filename + dimensions + alt + extracted_text).
    """

    type: Literal["image"] = "image"
    attachment_id: str
    mime: str
    width: int | None = None
    height: int | None = None
    alt: str | None = None  # user-supplied or auto-generated; used in fallback


class FileBlock(BaseModel):
    """User-uploaded non-image file (pdf / docx / txt / etc.).

    Always projected as text on the wire — vision models don't ingest pdf
    bytes directly. AttachmentService extracts text on demand and caches it
    on the attachment row; AgentLoop reads ``extracted_text`` and includes
    an excerpt in the HumanMessage.
    """

    type: Literal["file"] = "file"
    attachment_id: str
    mime: str
    filename: str
    size_bytes: int


ContentBlock = Annotated[
    TextBlock | ToolUseBlock | ReasoningBlock | ImageBlock | FileBlock,
    Field(discriminator="type"),
]


class Message(BaseModel):
    id: str
    conversation_id: str
    role: MessageRole
    content: str
    # ADR 0018 · authoritative content for new agent loop. Defaults to []
    # so legacy callers that only set ``content`` continue to work.
    content_blocks: list[ContentBlock] = Field(default_factory=list)
    tool_calls: list[ToolCall] = Field(default_factory=list)
    tool_call_id: str | None = None
    render_payloads: list[RenderPayload] = Field(default_factory=list)
    trace_ref: str | None = None
    parent_run_id: str | None = None
    # Populated on finalize when the assistant message came from a
    # thinking-capable model (Anthropic Extended Thinking, Qwen3
    # enable_thinking, DeepSeek-R1). Lets the trace viewer reconstruct the
    # reasoning channel for past runs; live chat still streams via
    # ReasoningEvent / AG-UI REASONING_MESSAGE_CHUNK.
    reasoning: str | None = None
    # 2026-04-25 · interrupt-preserving turn (Claude Code parity).
    #
    # True when the producer (the LLM stream) didn't reach a clean
    # ``done`` event — either the user clicked 中止, the SSE transport
    # broke, or the backend raised mid-stream. Whatever was already
    # streamed is still on this row (we never discard partial); this
    # flag tells the UI to render an 「已中止」 tail and the next
    # build_llm_context to synthesize a "Interrupted by user"
    # tool_result for any tool_use blocks the model emitted before the
    # break (so the next LLM call's wire shape stays valid).
    #
    # Three states a Message can be in:
    #   interrupted=False, content non-empty   → normal completed turn
    #   interrupted=True,  content non-empty   → partial preserved
    #   interrupted=True,  content empty       → started + cancelled before any token
    interrupted: bool = False
    # Attachment ids uploaded by the user with this turn. Resolved at runtime
    # into ImageBlock/FileBlock entries in content_blocks. Empty for assistant
    # / tool messages.
    attachment_ids: list[str] = Field(default_factory=list)
    # 2026-04-28 · context-compact dual-view. True when this message has been
    # folded into a summary by a manual `/compact` action. The row stays in
    # the database so the UI keeps it (behind a "N 条已压缩" fold); only the
    # LLM context build path filters it out (except system summary markers).
    is_compacted: bool = False
    created_at: datetime

    @model_validator(mode="after")
    def _derive_content_from_blocks(self) -> Message:
        # If caller pinned content to a non-empty string, leave it alone —
        # they may be migrating from legacy or doing custom projection.
        # If content is empty AND content_blocks has TextBlocks, derive
        # ``content`` as concatenated text. ToolUseBlock / ReasoningBlock
        # do NOT contribute to ``content``: the legacy ``content`` field
        # is user-visible chat text only.
        if not self.content and self.content_blocks:
            self.content = "".join(b.text for b in self.content_blocks if isinstance(b, TextBlock))
        return self


class Conversation(BaseModel):
    id: str
    title: str | None = None
    employee_id: str
    created_at: datetime
    # Per-conversation override for the effective model ref. Priority at
    # dispatch time is: conversation.model_ref_override > employee.model_ref
    # > platform default. `None` (the default) means "inherit the employee's
    # model" — the common case for most chats.
    model_ref_override: str | None = None
    metadata: dict[str, object] = Field(default_factory=dict)
