"""Vision-capability detection for LLMModel.

When a user creates / updates a model and ``supports_images`` is not
explicitly set, ``infer_supports_images(name)`` decides based on the model
name. The whitelist covers the major commercial vision-capable families.
"""

from __future__ import annotations

import re

# Pattern → vision-capable. Matched case-insensitively against the model
# *name* (not the user-facing display_name).
_VISION_PATTERNS: tuple[re.Pattern[str], ...] = (
    # Anthropic Claude — all 3+ are multimodal
    re.compile(r"^claude-(3|3\.5|3\.7|sonnet|opus|haiku|4|4-)", re.I),
    re.compile(r"^claude-(sonnet|opus|haiku)-[34]", re.I),
    # OpenAI GPT-4 vision-capable
    re.compile(r"^gpt-4o", re.I),
    re.compile(r"^gpt-4\.1", re.I),
    re.compile(r"^gpt-4-turbo", re.I),
    re.compile(r"^gpt-4-vision", re.I),
    re.compile(r"^o1\b|^o3\b|^o4\b", re.I),  # Reasoning series
    # Aliyun Qwen-VL — explicit vision SKUs
    re.compile(r"qwen.*-vl|qwen-?v|qwen3?-vl|qvq", re.I),
    # Aliyun Qwen unified multimodal · qwen3.5-plus / qwen3.6-plus and forward.
    # Per DashScope: starting from 3.5, the *-plus tier folds vision into the
    # base chat model (官方能力表标 "视觉理解"). Older qwen-plus / qwen3-plus /
    # qwen3.0-plus stay text-only — they don't match this regex.
    re.compile(r"^qwen3?\.[5-9]\d*-plus\b|^qwen[4-9](\.|-).*-plus\b", re.I),
    # DeepSeek
    re.compile(r"deepseek.*-vl", re.I),
    # Google Gemini — all multimodal
    re.compile(r"^gemini", re.I),
    # Llama 3.2 vision
    re.compile(r"^llama-3\.2-(11b|90b)-vision", re.I),
    # Pixtral / Mistral vision
    re.compile(r"^pixtral", re.I),
    # GLM vision
    re.compile(r"^glm-4v|glm-4\.5v", re.I),
    # Yi vision
    re.compile(r"^yi-vl|yi-vision", re.I),
    # InternVL
    re.compile(r"^internvl", re.I),
    # MiniCPM-V
    re.compile(r"^minicpm-v|^minicpm.*vl", re.I),
)


def infer_supports_images(model_name: str) -> bool:
    """Return True iff the given model name matches a known vision-capable
    pattern. Case-insensitive."""
    if not model_name:
        return False
    return any(p.search(model_name) for p in _VISION_PATTERNS)
