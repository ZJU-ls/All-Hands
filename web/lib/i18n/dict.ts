/**
 * i18n dictionary — zh / en only for v0.
 *
 * Keep keys dot-namespaced so we can grow without renames:
 *   nav.chat           — sidebar item
 *   header.jumpTo      — command palette hint
 *   chat.empty.title   — chat hero
 *
 * Missing keys in `en` fall back to the `zh` value (see useT). Add new
 * strings here first, then reference them via `t("nav.chat")` in JSX.
 * Inline Chinese literals in chrome components are a lint smell going
 * forward — they'd prevent English users from reading the UI.
 */

export type Locale = "zh" | "en";

export const LOCALES: Locale[] = ["zh", "en"];

export type Dict = Record<string, string>;

export const DICT: Record<Locale, Dict> = {
  zh: {
    // Sidebar sections
    "nav.section.workspace": "工作区",
    "nav.section.team": "团队与能力",
    "nav.section.gateway": "模型网关",
    "nav.section.runtime": "运行时",
    "nav.section.system": "系统",
    // Sidebar items
    "nav.cockpit": "驾驶舱",
    "nav.chat": "对话",
    "nav.tasks": "任务",
    "nav.history": "历史会话",
    "nav.employees": "员工",
    "nav.employeeDesign": "员工设计",
    "nav.skills": "技能",
    "nav.mcp": "MCP 服务器",
    "nav.providers": "供应商与模型",
    "nav.triggers": "触发器",
    "nav.approvals": "审批",
    "nav.traces": "追踪",
    "nav.observatory": "观测中心",
    "nav.review": "Review",
    "nav.settings": "设置",
    "nav.about": "关于",
    "nav.artifacts": "制品",
    // Shell chrome
    "shell.version": "v0 · MVP",
    "shell.brand": "allhands",
    "header.jumpTo": "跳转到…",
    "header.theme.toDark": "切换到深色",
    "header.theme.toLight": "切换到浅色",
    "header.theme.ariaToDark": "Switch to dark theme",
    "header.theme.ariaToLight": "Switch to light theme",
    "header.locale.label": "语言",
    "header.locale.toEn": "切到 English",
    "header.locale.toZh": "Switch to 中文",
    "header.cmdPalette.ariaOpen": "打开命令面板",
    "header.cmdPalette.titleOpen": "⌘K 打开命令面板",
    // Chat empty / loading
    "chat.loading.initializing": "正在初始化对话…",
    "chat.error.title": "连接错误",
    "chat.error.backendOffline": "后端未就绪,请确认服务已启动。",
    // Composer
    "composer.placeholder": "输入消息…",
    "composer.send": "发送",
    "composer.stop": "停止",
    "composer.hintSend": "发送",
    "composer.hintNewline": "换行",
    "composer.thinking": "深度思考",
    "composer.compactContext": "压缩上下文",
    "composer.compactBusy": "压缩中…",
    "composer.compactDone": "已压缩",
  },
  en: {
    "nav.section.workspace": "Workspace",
    "nav.section.team": "Team & Capabilities",
    "nav.section.gateway": "Model Gateway",
    "nav.section.runtime": "Runtime",
    "nav.section.system": "System",
    "nav.cockpit": "Cockpit",
    "nav.chat": "Chat",
    "nav.tasks": "Tasks",
    "nav.history": "History",
    "nav.employees": "Employees",
    "nav.employeeDesign": "Designer",
    "nav.skills": "Skills",
    "nav.mcp": "MCP Servers",
    "nav.providers": "Providers & Models",
    "nav.triggers": "Triggers",
    "nav.approvals": "Approvals",
    "nav.traces": "Traces",
    "nav.observatory": "Observatory",
    "nav.review": "Review",
    "nav.settings": "Settings",
    "nav.about": "About",
    "nav.artifacts": "Artifacts",
    "shell.version": "v0 · MVP",
    "shell.brand": "allhands",
    "header.jumpTo": "Jump to…",
    "header.theme.toDark": "Switch to dark",
    "header.theme.toLight": "Switch to light",
    "header.theme.ariaToDark": "Switch to dark theme",
    "header.theme.ariaToLight": "Switch to light theme",
    "header.locale.label": "Language",
    "header.locale.toEn": "Switch to English",
    "header.locale.toZh": "Switch to 中文",
    "header.cmdPalette.ariaOpen": "Open command palette",
    "header.cmdPalette.titleOpen": "⌘K — open command palette",
    "chat.loading.initializing": "Starting conversation…",
    "chat.error.title": "Connection error",
    "chat.error.backendOffline":
      "Backend isn't ready — check that the service is running.",
    "composer.placeholder": "Type a message…",
    "composer.send": "Send",
    "composer.stop": "Stop",
    "composer.hintSend": "send",
    "composer.hintNewline": "newline",
    "composer.thinking": "Think",
    "composer.compactContext": "Compact context",
    "composer.compactBusy": "Compacting…",
    "composer.compactDone": "Compacted",
  },
};
