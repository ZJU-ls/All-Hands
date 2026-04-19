"""Provider kind preset registry — single source of truth for UI + seed.

Each kind represents an LLM wire format. `openai` + `aliyun` both speak
OpenAI-compatible HTTP/SSE and share the ChatOpenAI adapter; `anthropic`
speaks the native Messages API and uses ChatAnthropic.

The UI's add-provider dialog and `/api/providers/presets` endpoint render
off this same dict, so changes flow from here out. Keep it pure-data —
this module is imported by `core/`, so no framework deps.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

ProviderKind = Literal["openai", "anthropic", "aliyun"]


@dataclass(frozen=True)
class ProviderKindPreset:
    kind: ProviderKind
    label: str
    base_url: str
    default_model: str
    key_hint: str
    doc_hint: str


PROVIDER_PRESETS: dict[ProviderKind, ProviderKindPreset] = {
    "openai": ProviderKindPreset(
        kind="openai",
        label="OpenAI 兼容",
        base_url="https://api.openai.com/v1",
        default_model="gpt-4o-mini",
        key_hint="sk-...",
        doc_hint="OpenAI / OpenRouter / DeepSeek / Ollama / vLLM — Authorization: Bearer",
    ),
    "anthropic": ProviderKindPreset(
        kind="anthropic",
        label="Anthropic",
        base_url="https://api.anthropic.com",
        default_model="claude-3-5-sonnet-latest",
        key_hint="sk-ant-...",
        doc_hint="Anthropic Messages API — x-api-key + anthropic-version",
    ),
    "aliyun": ProviderKindPreset(
        kind="aliyun",
        label="阿里云 百炼",
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        default_model="qwen-plus",
        key_hint="sk-...",
        doc_hint="DashScope compatible-mode — OpenAI 兼容 wire,Qwen 系列",
    ),
}


def preset_for(kind: ProviderKind) -> ProviderKindPreset:
    return PROVIDER_PRESETS[kind]


PROVIDER_KINDS: tuple[ProviderKind, ...] = tuple(PROVIDER_PRESETS.keys())
