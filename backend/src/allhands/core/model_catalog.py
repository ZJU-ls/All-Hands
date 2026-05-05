"""Curated catalog of common LLM model metadata · L4 core · pure data.

Goal: when a user types a model name in the Gateway dialog, we auto-fill
display name, capabilities, context window, and token caps from this
catalog so they don't have to look up specs. They can still override.

Coverage philosophy: the ~60 most-used models across the providers we
ship presets for (OpenAI, Anthropic, Aliyun/Bailian, DeepSeek, Google,
xAI). Numbers cross-checked against:
- LiteLLM's model_prices_and_context_window.json
- Each provider's official docs (snapshot 2026-04)

Lookup is forgiving:
1. exact match on name
2. exact match on alias
3. longest-prefix match (so "gpt-4o-mini-2024-07-18" hits "gpt-4o-mini")
4. substring fallback (so "qwen-max-latest" hits "qwen-max")

Returns None when nothing matches — caller falls back to manual entry.

Adding a model = one line in CATALOG; no other code changes needed.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from allhands.core.model import Capability


@dataclass(frozen=True)
class CatalogEntry:
    """One row · the answer to "what's this model?"."""

    name: str
    """Canonical API name as the provider expects it."""
    display_name: str
    """Human-friendly label · used as the dialog default."""
    capabilities: list[Capability]
    """Output modalities the model produces."""
    context_window: int = 0
    """Total prompt+completion budget · 0 = unknown / not applicable."""
    max_input_tokens: int | None = None
    """Hard input cap when smaller than context_window."""
    max_output_tokens: int | None = None
    """Generation max_tokens cap · None = use provider default."""
    aliases: list[str] = field(default_factory=list)
    """Alternative names users might type (date-suffixed snapshots etc.)."""
    provider_kinds: list[str] = field(default_factory=list)
    """Which provider.kind values this entry is valid for. Empty = any."""


# Hand-curated · tuned for the providers we ship in PROVIDER_PRESETS.
# Order matters: longest/most-specific patterns first so prefix-match wins
# correctly (e.g. "gpt-4o-mini" must come before "gpt-4o").
CATALOG: list[CatalogEntry] = [
    # ── OpenAI · chat ──────────────────────────────────────────────
    CatalogEntry(
        name="gpt-4o-mini",
        display_name="GPT-4o Mini",
        capabilities=[Capability.CHAT],
        context_window=128_000,
        max_output_tokens=16_384,
        provider_kinds=["openai"],
    ),
    CatalogEntry(
        name="gpt-4o",
        display_name="GPT-4o",
        capabilities=[Capability.CHAT],
        context_window=128_000,
        max_output_tokens=16_384,
        provider_kinds=["openai"],
    ),
    CatalogEntry(
        name="gpt-4.1-mini",
        display_name="GPT-4.1 Mini",
        capabilities=[Capability.CHAT],
        context_window=1_047_576,
        max_output_tokens=32_768,
        provider_kinds=["openai"],
    ),
    CatalogEntry(
        name="gpt-4.1",
        display_name="GPT-4.1",
        capabilities=[Capability.CHAT],
        context_window=1_047_576,
        max_output_tokens=32_768,
        provider_kinds=["openai"],
    ),
    CatalogEntry(
        name="gpt-4-turbo",
        display_name="GPT-4 Turbo",
        capabilities=[Capability.CHAT],
        context_window=128_000,
        max_output_tokens=4_096,
        provider_kinds=["openai"],
    ),
    CatalogEntry(
        name="gpt-3.5-turbo",
        display_name="GPT-3.5 Turbo",
        capabilities=[Capability.CHAT],
        context_window=16_385,
        max_output_tokens=4_096,
        provider_kinds=["openai"],
    ),
    CatalogEntry(
        name="o3-mini",
        display_name="o3-mini",
        capabilities=[Capability.CHAT],
        context_window=200_000,
        max_output_tokens=100_000,
        provider_kinds=["openai"],
    ),
    CatalogEntry(
        name="o1-mini",
        display_name="o1-mini",
        capabilities=[Capability.CHAT],
        context_window=128_000,
        max_output_tokens=65_536,
        provider_kinds=["openai"],
    ),
    CatalogEntry(
        name="o1",
        display_name="o1",
        capabilities=[Capability.CHAT],
        context_window=200_000,
        max_output_tokens=100_000,
        provider_kinds=["openai"],
    ),
    # ── OpenAI · image ─────────────────────────────────────────────
    CatalogEntry(
        name="gpt-image-1",
        display_name="GPT Image 1",
        capabilities=[Capability.IMAGE_GEN],
        provider_kinds=["openai"],
    ),
    CatalogEntry(
        name="dall-e-3",
        display_name="DALL·E 3",
        capabilities=[Capability.IMAGE_GEN],
        provider_kinds=["openai"],
    ),
    CatalogEntry(
        name="dall-e-2",
        display_name="DALL·E 2",
        capabilities=[Capability.IMAGE_GEN],
        provider_kinds=["openai"],
    ),
    # ── OpenAI · embedding / speech ────────────────────────────────
    CatalogEntry(
        name="text-embedding-3-large",
        display_name="Text Embedding 3 (Large)",
        capabilities=[Capability.EMBEDDING],
        max_input_tokens=8_191,
        provider_kinds=["openai"],
    ),
    CatalogEntry(
        name="text-embedding-3-small",
        display_name="Text Embedding 3 (Small)",
        capabilities=[Capability.EMBEDDING],
        max_input_tokens=8_191,
        provider_kinds=["openai"],
    ),
    CatalogEntry(
        name="tts-1-hd",
        display_name="TTS 1 HD",
        capabilities=[Capability.SPEECH],
        provider_kinds=["openai"],
    ),
    CatalogEntry(
        name="tts-1",
        display_name="TTS 1",
        capabilities=[Capability.SPEECH],
        provider_kinds=["openai"],
    ),
    CatalogEntry(
        name="whisper-1",
        display_name="Whisper",
        capabilities=[Capability.SPEECH],
        provider_kinds=["openai"],
    ),
    # ── Anthropic ──────────────────────────────────────────────────
    CatalogEntry(
        name="claude-opus-4-7",
        display_name="Claude Opus 4.7",
        capabilities=[Capability.CHAT],
        context_window=200_000,
        max_output_tokens=64_000,
        provider_kinds=["anthropic"],
    ),
    CatalogEntry(
        name="claude-sonnet-4-6",
        display_name="Claude Sonnet 4.6",
        capabilities=[Capability.CHAT],
        context_window=200_000,
        max_output_tokens=64_000,
        provider_kinds=["anthropic"],
    ),
    CatalogEntry(
        name="claude-haiku-4-5",
        display_name="Claude Haiku 4.5",
        capabilities=[Capability.CHAT],
        context_window=200_000,
        max_output_tokens=8_192,
        provider_kinds=["anthropic"],
    ),
    CatalogEntry(
        name="claude-3-5-sonnet",
        display_name="Claude 3.5 Sonnet",
        capabilities=[Capability.CHAT],
        context_window=200_000,
        max_output_tokens=8_192,
        aliases=["claude-3-5-sonnet-latest", "claude-3-5-sonnet-20241022"],
        provider_kinds=["anthropic"],
    ),
    CatalogEntry(
        name="claude-3-5-haiku",
        display_name="Claude 3.5 Haiku",
        capabilities=[Capability.CHAT],
        context_window=200_000,
        max_output_tokens=8_192,
        provider_kinds=["anthropic"],
    ),
    CatalogEntry(
        name="claude-3-opus",
        display_name="Claude 3 Opus",
        capabilities=[Capability.CHAT],
        context_window=200_000,
        max_output_tokens=4_096,
        provider_kinds=["anthropic"],
    ),
    # ── Aliyun · Qwen chat (DashScope OpenAI-compat) ───────────────
    CatalogEntry(
        name="qwen3-max",
        display_name="通义千问 3 Max",
        capabilities=[Capability.CHAT],
        context_window=262_144,
        max_output_tokens=8_192,
        provider_kinds=["aliyun"],
    ),
    CatalogEntry(
        name="qwen3-plus",
        display_name="通义千问 3 Plus",
        capabilities=[Capability.CHAT],
        context_window=131_072,
        max_output_tokens=8_192,
        provider_kinds=["aliyun"],
    ),
    CatalogEntry(
        name="qwen3-turbo",
        display_name="通义千问 3 Turbo",
        capabilities=[Capability.CHAT],
        context_window=131_072,
        max_output_tokens=8_192,
        provider_kinds=["aliyun"],
    ),
    CatalogEntry(
        name="qwen-max",
        display_name="通义千问 Max",
        capabilities=[Capability.CHAT],
        context_window=32_768,
        max_output_tokens=8_192,
        aliases=["qwen-max-latest"],
        provider_kinds=["aliyun"],
    ),
    CatalogEntry(
        name="qwen-plus",
        display_name="通义千问 Plus",
        capabilities=[Capability.CHAT],
        context_window=131_072,
        max_output_tokens=8_192,
        aliases=["qwen-plus-latest"],
        provider_kinds=["aliyun"],
    ),
    CatalogEntry(
        name="qwen-turbo",
        display_name="通义千问 Turbo",
        capabilities=[Capability.CHAT],
        context_window=1_000_000,
        max_output_tokens=8_192,
        aliases=["qwen-turbo-latest"],
        provider_kinds=["aliyun"],
    ),
    CatalogEntry(
        name="qwen2.5-72b-instruct",
        display_name="Qwen2.5 72B Instruct",
        capabilities=[Capability.CHAT],
        context_window=131_072,
        max_output_tokens=8_192,
        provider_kinds=["aliyun"],
    ),
    CatalogEntry(
        name="qwen2.5-32b-instruct",
        display_name="Qwen2.5 32B Instruct",
        capabilities=[Capability.CHAT],
        context_window=131_072,
        max_output_tokens=8_192,
        provider_kinds=["aliyun"],
    ),
    # ── Aliyun · Wanx image (async polling adapter) ────────────────
    CatalogEntry(
        name="wan2.5-t2i-preview",
        display_name="通义万相 2.5 文生图",
        capabilities=[Capability.IMAGE_GEN],
        provider_kinds=["aliyun"],
    ),
    CatalogEntry(
        name="wanx2.1-t2i-turbo",
        display_name="通义万相 2.1 文生图(Turbo)",
        capabilities=[Capability.IMAGE_GEN],
        provider_kinds=["aliyun"],
    ),
    CatalogEntry(
        name="wanx2.1-t2i-plus",
        display_name="通义万相 2.1 文生图(Plus)",
        capabilities=[Capability.IMAGE_GEN],
        provider_kinds=["aliyun"],
    ),
    CatalogEntry(
        name="wanx-v1",
        display_name="通义万相 v1",
        capabilities=[Capability.IMAGE_GEN],
        provider_kinds=["aliyun"],
    ),
    # ── Aliyun · embedding ─────────────────────────────────────────
    CatalogEntry(
        name="text-embedding-v3",
        display_name="通义文本向量 v3",
        capabilities=[Capability.EMBEDDING],
        max_input_tokens=8_192,
        provider_kinds=["aliyun"],
    ),
    CatalogEntry(
        name="text-embedding-v2",
        display_name="通义文本向量 v2",
        capabilities=[Capability.EMBEDDING],
        max_input_tokens=2_048,
        provider_kinds=["aliyun"],
    ),
    # ── DeepSeek (OpenAI-compat) ───────────────────────────────────
    CatalogEntry(
        name="deepseek-chat",
        display_name="DeepSeek Chat",
        capabilities=[Capability.CHAT],
        context_window=64_000,
        max_output_tokens=8_192,
        provider_kinds=["openai"],  # served via OpenAI-compat endpoint
    ),
    CatalogEntry(
        name="deepseek-reasoner",
        display_name="DeepSeek Reasoner",
        capabilities=[Capability.CHAT],
        context_window=64_000,
        max_output_tokens=8_192,
        provider_kinds=["openai"],
    ),
    CatalogEntry(
        name="deepseek-coder",
        display_name="DeepSeek Coder",
        capabilities=[Capability.CHAT],
        context_window=128_000,
        max_output_tokens=8_192,
        provider_kinds=["openai"],
    ),
    # ── Google Gemini (OpenAI-compat) ──────────────────────────────
    CatalogEntry(
        name="gemini-2.5-pro",
        display_name="Gemini 2.5 Pro",
        capabilities=[Capability.CHAT],
        context_window=2_097_152,
        max_output_tokens=65_536,
        provider_kinds=["openai"],
    ),
    CatalogEntry(
        name="gemini-2.0-flash",
        display_name="Gemini 2.0 Flash",
        capabilities=[Capability.CHAT],
        context_window=1_048_576,
        max_output_tokens=8_192,
        provider_kinds=["openai"],
    ),
    CatalogEntry(
        name="gemini-1.5-pro",
        display_name="Gemini 1.5 Pro",
        capabilities=[Capability.CHAT],
        context_window=2_097_152,
        max_output_tokens=8_192,
        provider_kinds=["openai"],
    ),
    CatalogEntry(
        name="gemini-1.5-flash",
        display_name="Gemini 1.5 Flash",
        capabilities=[Capability.CHAT],
        context_window=1_048_576,
        max_output_tokens=8_192,
        provider_kinds=["openai"],
    ),
    CatalogEntry(
        name="imagen-4",
        display_name="Imagen 4",
        capabilities=[Capability.IMAGE_GEN],
        provider_kinds=["openai"],
    ),
    # ── xAI (OpenAI-compat) ────────────────────────────────────────
    CatalogEntry(
        name="grok-2",
        display_name="Grok 2",
        capabilities=[Capability.CHAT],
        context_window=131_072,
        max_output_tokens=8_192,
        provider_kinds=["openai"],
    ),
]


def _entry_matches_kind(entry: CatalogEntry, provider_kind: str | None) -> bool:
    if not entry.provider_kinds or provider_kind is None:
        return True
    return provider_kind in entry.provider_kinds


def lookup_catalog(name: str, *, provider_kind: str | None = None) -> CatalogEntry | None:
    """Resolve a model name to its catalog entry.

    Match priority:
    1. exact name
    2. alias exact match
    3. longest prefix (handles "gpt-4o-mini-2024-07-18" → gpt-4o-mini)
    4. substring fallback (handles "qwen-max-latest" if not in aliases)

    ``provider_kind`` filters out wrong-provider matches when supplied
    (e.g. typing "qwen-max" against an OpenAI provider yields None).
    """
    if not name:
        return None
    needle = name.strip().lower()
    if not needle:
        return None

    # 1. exact name
    for entry in CATALOG:
        if entry.name.lower() == needle and _entry_matches_kind(entry, provider_kind):
            return entry

    # 2. alias exact
    for entry in CATALOG:
        if not _entry_matches_kind(entry, provider_kind):
            continue
        if any(a.lower() == needle for a in entry.aliases):
            return entry

    # 3. longest prefix
    best: CatalogEntry | None = None
    best_len = 0
    for entry in CATALOG:
        if not _entry_matches_kind(entry, provider_kind):
            continue
        if needle.startswith(entry.name.lower()) and len(entry.name) > best_len:
            best, best_len = entry, len(entry.name)
    if best is not None:
        return best

    # 4. substring fallback (user typed extra chars in the middle)
    for entry in CATALOG:
        if not _entry_matches_kind(entry, provider_kind):
            continue
        if entry.name.lower() in needle or needle in entry.name.lower():
            return entry

    return None


__all__ = ["CATALOG", "CatalogEntry", "lookup_catalog"]
