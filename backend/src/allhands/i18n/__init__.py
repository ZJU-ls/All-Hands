"""allhands · backend i18n.

Per-request locale carried through a ContextVar set by
:func:`allhands.api.middleware.LocaleMiddleware`. Anything that wants a
localized string calls :func:`t` — it falls back through the catalog chain
``current_locale → DEFAULT_LOCALE → key``, never raising.

Layer policy: this module only depends on stdlib + the catalog dict. It is
safe to import from ``services/`` or ``api/`` (the middleware lives in
``api/middleware/``). Do NOT import it from ``core/``.
"""

from __future__ import annotations

import contextvars
from typing import Final

LOCALES: Final[tuple[str, ...]] = ("zh-CN", "en")
DEFAULT_LOCALE: Final[str] = "zh-CN"
LOCALE_COOKIE: Final[str] = "allhands_locale"

_current_locale: contextvars.ContextVar[str] = contextvars.ContextVar(
    "allhands_locale", default=DEFAULT_LOCALE
)


def is_locale(value: str | None) -> bool:
    return value is not None and value in LOCALES


def negotiate_locale(accept_language: str | None) -> str:
    """Pick the first acceptable locale from an Accept-Language header.

    Cheap parser — drops q-values, only keeps the primary tag prefix. Good
    enough for our two-locale catalog. Returns ``DEFAULT_LOCALE`` when no
    tag matches or the header is missing.
    """

    if not accept_language:
        return DEFAULT_LOCALE
    for raw in accept_language.split(","):
        tag = raw.strip().split(";", 1)[0].strip().lower()
        if tag.startswith("zh"):
            return "zh-CN"
        if tag.startswith("en"):
            return "en"
    return DEFAULT_LOCALE


def set_current_locale(locale: str) -> contextvars.Token[str]:
    """Set the per-request locale; returns a token for ``reset``."""

    return _current_locale.set(locale if is_locale(locale) else DEFAULT_LOCALE)


def reset_current_locale(token: contextvars.Token[str]) -> None:
    _current_locale.reset(token)


def get_current_locale() -> str:
    return _current_locale.get()


# ─────────────────────────────────────────────────────────────────────────────
# Message catalog · keyed by locale → key.
#
# Keys are dotted strings grouped by domain (``errors.not_found.provider``).
# Add new strings here; do NOT inline localized literals in handlers.
# ─────────────────────────────────────────────────────────────────────────────

_MESSAGES: dict[str, dict[str, str]] = {
    "zh-CN": {
        "errors.unknown": "未知错误",
        "errors.invalid_request": "请求无效",
        "errors.invalid_status_filter": "无效的状态过滤器: {detail}",
        "errors.invalid_source": "无效的来源: {detail}",
        "errors.from_event_id_required": "需要 from_event_id",
        "errors.not_found.provider": "供应商不存在",
        "errors.not_found.model": "模型不存在",
        "errors.not_found.model_or_provider": "模型或供应商不存在",
        "errors.not_found.confirmation": "审批记录不存在",
        "errors.not_found.skill": "技能不存在",
        "errors.not_found.mcp_server": "MCP 服务器不存在",
        "errors.not_found.lead_agent": "未找到 Lead Agent",
        "errors.not_found.task": "任务不存在",
        "errors.not_found.employee": "员工不存在",
        "errors.not_found.conversation": "会话不存在",
        "errors.not_found.version_blob": "该版本没有可下载的内容",
        "errors.conflict.task_state": "任务状态冲突",
        "errors.stream.error_prefix": "[错误]",
        "errors.no_default_provider": "尚未配置默认 LLM 供应商 — 请先到「模型网关」选一家供应商并标记为默认。",
        "errors.no_default_model": "尚未指定默认模型 — 请先到「模型网关」点一行模型,设为默认。",
        "errors.default_model_provider_missing": "默认模型所在的供应商已被删除 — 请重新指定默认模型。",
        "errors.not_found.employee_id": "员工 {id} 不存在",
        "errors.not_found.conversation_id": "会话 {id} 不存在",
        "errors.not_found.trace_id": "追踪未找到:{id}",
        "errors.not_found.run_id": "运行未找到:{id}",
        "errors.not_found.document_in_kb": "文档不在该知识库中",
        "errors.not_found.user_input": "用户输入待办不存在",
        "errors.unknown_kind": "未知类型 {kind}",
        "errors.unknown_preset": "未知预设 {preset}",
        "errors.transport_invalid": "transport 必须是 stdio | sse | http(收到 {raw})",
        "errors.kb_fetch_failed": "无法抓取:{detail}",
        "errors.answers_not_dict": "answers 必须是 dict",
        "errors.user_input_not_pending": "用户输入待办已不在 pending 状态",
        "providers.label.openai": "OpenAI 兼容",
        "providers.label.anthropic": "Anthropic",
        "providers.label.aliyun": "阿里云 百炼",
    },
    "en": {
        "errors.unknown": "Unknown error",
        "errors.invalid_request": "Invalid request",
        "errors.invalid_status_filter": "Invalid status filter: {detail}",
        "errors.invalid_source": "Invalid source: {detail}",
        "errors.from_event_id_required": "from_event_id is required",
        "errors.not_found.provider": "Provider not found.",
        "errors.not_found.model": "Model not found.",
        "errors.not_found.model_or_provider": "Model or provider not found.",
        "errors.not_found.confirmation": "Confirmation not found.",
        "errors.not_found.skill": "Skill not found.",
        "errors.not_found.mcp_server": "MCP server not found.",
        "errors.not_found.lead_agent": "Lead agent not found.",
        "errors.not_found.task": "Task not found.",
        "errors.not_found.employee": "Employee not found.",
        "errors.not_found.conversation": "Conversation not found.",
        "errors.not_found.version_blob": "version has no stored blob",
        "errors.conflict.task_state": "Task state conflict",
        "errors.stream.error_prefix": "[error]",
        "errors.no_default_provider": 'No default LLM provider is configured — pick a provider in "Model Gateway" and mark it as default first.',
        "errors.no_default_model": 'No default model is set — open "Model Gateway" and click "Set as default" on any registered model.',
        "errors.default_model_provider_missing": "The provider hosting the default model has been deleted — pick a new default model.",
        "errors.not_found.employee_id": "Employee {id} not found.",
        "errors.not_found.conversation_id": "Conversation {id} not found.",
        "errors.not_found.trace_id": "Trace not found: {id}",
        "errors.not_found.run_id": "Run not found: {id}",
        "errors.not_found.document_in_kb": "Document is not part of this KB",
        "errors.not_found.user_input": "Pending user input not found",
        "errors.unknown_kind": "Unknown kind {kind}",
        "errors.unknown_preset": "Unknown preset {preset}",
        "errors.transport_invalid": "transport must be one of stdio | sse | http (got {raw})",
        "errors.kb_fetch_failed": "Couldn't fetch: {detail}",
        "errors.answers_not_dict": "answers must be a dict",
        "errors.user_input_not_pending": "Pending user input is no longer in the pending state",
        "providers.label.openai": "OpenAI-compatible",
        "providers.label.anthropic": "Anthropic",
        "providers.label.aliyun": "Aliyun Bailian",
    },
}


def t(key: str, /, **fmt: object) -> str:
    """Translate ``key`` for the current request locale.

    Lookup chain: current locale → ``DEFAULT_LOCALE`` → ``key`` itself.
    ``fmt`` keyword args are passed through ``str.format``; missing
    placeholders fall back to the raw template (caller bug; never raises).
    """

    locale = get_current_locale()
    template = _MESSAGES.get(locale, {}).get(key)
    if template is None:
        template = _MESSAGES.get(DEFAULT_LOCALE, {}).get(key, key)
    if not fmt:
        return template
    try:
        return template.format(**fmt)
    except (KeyError, IndexError):
        return template


__all__ = [
    "DEFAULT_LOCALE",
    "LOCALES",
    "LOCALE_COOKIE",
    "get_current_locale",
    "is_locale",
    "negotiate_locale",
    "reset_current_locale",
    "set_current_locale",
    "t",
]
