"use client";

import { useEffect } from "react";

/**
 * 全局可复用的 ESC 关闭 hook · 给所有"模态级"UI(Dialog / Drawer / Modal /
 * Popover)提供一致的键盘退出契约。
 *
 * 设计:
 *   - 只在 `active=true` 时绑监听器(modal 关着时不监听,避免错误吞 ESC)
 *   - 用 `keydown` 而不是 `keypress`(后者已 deprecated,且不触发于 Escape)
 *   - 监听 `window` 而非 dialog 容器 —— 焦点可能在容器外的 input、按钮、链接,
 *     依然要响应。
 *   - 不调 `e.preventDefault()` —— ESC 在原生表单 / 浏览器层有别的语义,
 *     强行抢断会破坏可访问性(JAWS / VoiceOver 用 ESC 退某些读屏模式)。
 *   - 默认 `stopOnEscape=true` 时调用 `e.stopPropagation()`,防止外层叠加 modal
 *     一层把 ESC 同时消化掉(嵌套 dialog 应只关最内层)。
 *
 * 不处理:
 *   - 重复绑定(同一组件实例多次 mount 不会冲突 — 每次 cleanup 都解绑)
 *   - composition / IME 状态(中文输入法 ESC 是取消候选词,不是关 modal —
 *     检测 `e.isComposing` 跳过)。
 */
export function useDismissOnEscape(
  active: boolean,
  onDismiss: () => void,
  options: { stopOnEscape?: boolean } = {},
) {
  const { stopOnEscape = true } = options;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // IME 候选词的 ESC 应该取消候选,不应关 modal
      if (e.isComposing || e.keyCode === 229) return;
      if (stopOnEscape) e.stopPropagation();
      onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onDismiss, stopOnEscape]);
}
