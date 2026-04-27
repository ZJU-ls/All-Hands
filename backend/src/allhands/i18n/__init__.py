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
        "errors.invalid_request": "请求无效",
        "errors.malformed_response": "服务返回结构异常",
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
        "errors.stream.error_prefix": "[错误]",
        "errors.no_default_model": "尚未指定默认模型 — 请先到「模型网关」点一行模型,设为默认。",
        "errors.default_model_provider_missing": "默认模型所在的供应商已被删除 — 请重新指定默认模型。",
        "errors.not_found.employee_id": "员工 {id} 不存在",
        "errors.not_found.conversation_id": "会话 {id} 不存在",
        "errors.not_found.trace_id": "追踪未找到:{id}",
        "errors.not_found.run_id": "运行未找到:{id}",
        "errors.not_found.document_in_kb": "文档不在该知识库中",
        "errors.not_found.user_input": "用户输入待办不存在",
        "errors.not_found.skill_file": "文件不存在: {path}",
        "errors.skill_no_install_path": "该技能没有磁盘安装路径",
        "errors.unknown_kind": "未知类型 {kind}",
        "errors.unknown_preset": "未知预设 {preset}",
        "errors.transport_invalid": "transport 必须是 stdio | sse | http(收到 {raw})",
        "errors.kb_fetch_failed": "无法抓取:{detail}",
        "errors.answers_not_dict": "answers 必须是 dict",
        "errors.user_input_not_pending": "用户输入待办已不在 pending 状态",
        "providers.label.openai": "OpenAI 兼容",
        "providers.label.anthropic": "Anthropic",
        "providers.label.aliyun": "阿里云 百炼",
        "knowledge.embedding.label.aliyun": "阿里云百炼 · {model}",
        "knowledge.embedding.reason.add_openai": "去 /gateway 添加 OpenAI provider",
        "knowledge.embedding.reason.add_aliyun": "去 /gateway 添加 阿里云 百炼 provider",
        "knowledge.ask.no_hits": "知识库里没有跟这个问题相关的内容。换个说法,或者补一份资料试试。",
        "knowledge.ask.no_chat_provider": "还没有可用的对话模型 · 去 /gateway 添加一个 OpenAI / 阿里云 / Anthropic provider",
        "knowledge.ask.llm_failed": "模型调用失败:{detail}",
        "knowledge.embedding.model_unusable": "模型 {ref} 不可用: {detail}",
        "models.warning.thinking_unsupported": "上游模型不接受 thinking 参数 — 已自动去掉该字段重试一次。",
        "models.error.empty_response_anthropic_compat": "上游返回了空响应流 — 该 anthropic-compat 反代可能不支持 thinking 字段(无论开关状态)。换一个 provider 或换非思考的模型变体试试。",
        "system.paths.data_dir.label": "数据根目录",
        "system.paths.data_dir.description": "所有文件型状态的根 · sqlite 数据库 / 已安装技能 / 制品 blob 都默认放在它下面。",
        "system.paths.database.label": "SQLite 数据库",
        "system.paths.database.description": "主数据库文件 · 对话 / 消息 / 制品元数据 / 技能注册表都在这里。",
        "system.paths.skills_dir.label": "已安装技能",
        "system.paths.skills_dir.description": "用户通过 zip / GitHub 安装的技能存放目录。每个技能一个子文件夹。默认 <data_dir>/skills,可通过 ALLHANDS_SKILLS_DIR 覆盖。",
        "system.paths.builtin_skills_dir.label": "内置技能",
        "system.paths.builtin_skills_dir.description": "跟随后端代码发布的只读技能集 · 不会被「已安装技能」目录污染。",
        "system.paths.artifacts_dir.label": "制品 blob",
        "system.paths.artifacts_dir.description": "Agent 产出的 markdown / 代码 / 图片 / drawio / mermaid 文件存盘位置。默认 <data_dir>/artifacts,可通过 ALLHANDS_ARTIFACTS_DIR 覆盖。",
    },
    "en": {
        "errors.invalid_request": "Invalid request",
        "errors.malformed_response": "Malformed service response",
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
        "errors.stream.error_prefix": "[error]",
        "errors.no_default_model": 'No default model is set — open "Model Gateway" and click "Set as default" on any registered model.',
        "errors.default_model_provider_missing": "The provider hosting the default model has been deleted — pick a new default model.",
        "errors.not_found.employee_id": "Employee {id} not found.",
        "errors.not_found.conversation_id": "Conversation {id} not found.",
        "errors.not_found.trace_id": "Trace not found: {id}",
        "errors.not_found.run_id": "Run not found: {id}",
        "errors.not_found.document_in_kb": "Document is not part of this KB",
        "errors.not_found.user_input": "Pending user input not found",
        "errors.not_found.skill_file": "File not found: {path}",
        "errors.skill_no_install_path": "Skill has no install path on disk",
        "errors.unknown_kind": "Unknown kind {kind}",
        "errors.unknown_preset": "Unknown preset {preset}",
        "errors.transport_invalid": "transport must be one of stdio | sse | http (got {raw})",
        "errors.kb_fetch_failed": "Couldn't fetch: {detail}",
        "errors.answers_not_dict": "answers must be a dict",
        "errors.user_input_not_pending": "Pending user input is no longer in the pending state",
        "providers.label.openai": "OpenAI-compatible",
        "providers.label.anthropic": "Anthropic",
        "providers.label.aliyun": "Aliyun Bailian",
        "knowledge.embedding.label.aliyun": "Aliyun Bailian · {model}",
        "knowledge.embedding.reason.add_openai": "Add an OpenAI provider in /gateway first.",
        "knowledge.embedding.reason.add_aliyun": "Add an Aliyun Bailian provider in /gateway first.",
        "knowledge.ask.no_hits": "Nothing in the knowledge base matches this question. Try rephrasing, or add a relevant document.",
        "knowledge.ask.no_chat_provider": "No chat model is available — add an OpenAI / Aliyun / Anthropic provider in /gateway first.",
        "knowledge.ask.llm_failed": "Model call failed: {detail}",
        "knowledge.embedding.model_unusable": "Model {ref} is not usable: {detail}",
        "models.warning.thinking_unsupported": "Upstream model rejected the `thinking` parameter — retried once with that field stripped.",
        "models.error.empty_response_anthropic_compat": "Upstream returned an empty response stream — this anthropic-compat reverse proxy probably doesn't support the `thinking` field (regardless of toggle). Try a different provider or switch to a non-thinking model variant.",
        "system.paths.data_dir.label": "Data root",
        "system.paths.data_dir.description": "Root for every file-backed piece of state · the SQLite DB, installed skills, and artifact blobs all live underneath it by default.",
        "system.paths.database.label": "SQLite database",
        "system.paths.database.description": "Main database file · conversations / messages / artifact metadata / skill registry all live here.",
        "system.paths.skills_dir.label": "Installed skills",
        "system.paths.skills_dir.description": "Where user-installed skills (via zip / GitHub) live · one subfolder per skill. Defaults to <data_dir>/skills · override with ALLHANDS_SKILLS_DIR.",
        "system.paths.builtin_skills_dir.label": "Built-in skills",
        "system.paths.builtin_skills_dir.description": "Read-only skill set shipped with the backend code · never polluted by the installed-skills folder.",
        "system.paths.artifacts_dir.label": "Artifact blobs",
        "system.paths.artifacts_dir.description": "Where agent-produced markdown / code / images / drawio / mermaid files land. Defaults to <data_dir>/artifacts · override with ALLHANDS_ARTIFACTS_DIR.",
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
