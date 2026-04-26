"use client";

/**
 * HoverPeek · 通用 hover-popover 单件 (2026-04-26)
 *
 * Why this exists: Notion / GitHub / Linear 都把"鼠标悬停时露详情卡"做
 * 成了一等公民 — chip / row / link 上不堆全文,只放标题 + 一线 hint,
 * 真正的描述 / 元数据 / 子内容靠 hover 露出。在我们 Skill / MCP 选择
 * 器里这是显著的 UX 杠杆:用户在挂载 Skill 时不必跳到 Skills 页查文档。
 *
 * 实现要点
 *   - 200ms enter delay · 100ms leave delay → 鼠标快速划过不闪烁
 *   - 触摸设备(no hover MQ)直接禁用,改用 onClick → 不影响移动 UX
 *   - 自动避让:浮层超出视口右/下边缘时翻转锚定
 *   - 同时支持 keyboard focus 触发(focus 200ms 后弹)
 *   - 浮层内 onMouseEnter 取消 leave timer → 鼠标移到浮层不消失,
 *     用户可点里面的链接 / 选中文字
 *
 * Public API
 *   - children:触发器(必须能接收 hover/focus event,自动 wrap span)
 *   - content:popover 内容(ReactNode)
 *   - placement:"auto" | "top" | "bottom" · 默认 "auto"
 *   - testId
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";

const ENTER_DELAY = 200;
const LEAVE_DELAY = 120;

type Placement = "auto" | "top" | "bottom";

export function HoverPeek({
  children,
  content,
  placement = "auto",
  testId,
  className,
}: {
  children: ReactNode;
  content: ReactNode;
  placement?: Placement;
  testId?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<"top" | "bottom">("bottom");
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();

  const compute = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const popH = 180;
    const popW = 320;
    let resolved: "top" | "bottom" =
      placement === "top" || placement === "bottom" ? placement : "bottom";
    if (placement === "auto") {
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      resolved = spaceBelow >= popH || spaceBelow >= spaceAbove ? "bottom" : "top";
    }
    let left = rect.left;
    if (left + popW > window.innerWidth - 12) {
      left = Math.max(12, window.innerWidth - popW - 12);
    }
    const top = resolved === "bottom" ? rect.bottom + 6 : rect.top - 6;
    setSide(resolved);
    setCoords({ left, top });
  }, [placement]);

  const scheduleOpen = useCallback(() => {
    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
    if (enterTimer.current) clearTimeout(enterTimer.current);
    enterTimer.current = setTimeout(() => {
      compute();
      setOpen(true);
    }, ENTER_DELAY);
  }, [compute]);

  const scheduleClose = useCallback(() => {
    if (enterTimer.current) {
      clearTimeout(enterTimer.current);
      enterTimer.current = null;
    }
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => setOpen(false), LEAVE_DELAY);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => compute();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, compute]);

  useEffect(() => {
    return () => {
      if (enterTimer.current) clearTimeout(enterTimer.current);
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
    };
  }, []);

  // Touch / no-hover device: skip the popover entirely. The trigger keeps
  // its click semantics (e.g. toggle a chip) without conflicting with peek.
  const supportsHover =
    typeof window !== "undefined"
      ? window.matchMedia?.("(hover: hover)").matches ?? true
      : true;

  return (
    <>
      <span
        ref={triggerRef}
        data-testid={testId}
        aria-describedby={open ? `peek-${id}` : undefined}
        onMouseEnter={supportsHover ? scheduleOpen : undefined}
        onMouseLeave={supportsHover ? scheduleClose : undefined}
        onFocus={supportsHover ? scheduleOpen : undefined}
        onBlur={supportsHover ? scheduleClose : undefined}
        className="contents"
      >
        {children}
      </span>
      {open && coords && (
        <div
          ref={popRef}
          id={`peek-${id}`}
          role="tooltip"
          onMouseEnter={() => {
            if (leaveTimer.current) {
              clearTimeout(leaveTimer.current);
              leaveTimer.current = null;
            }
          }}
          onMouseLeave={scheduleClose}
          style={{
            position: "fixed",
            left: coords.left,
            top: side === "bottom" ? coords.top : undefined,
            bottom:
              side === "top" ? window.innerHeight - coords.top : undefined,
            zIndex: 60,
          }}
          className={cn(
            "w-80 max-w-[calc(100vw-24px)] rounded-lg border border-border bg-surface shadow-soft-lg p-3 text-[12px] leading-relaxed text-text",
            "animate-fade-in",
            className,
          )}
        >
          {content}
        </div>
      )}
    </>
  );
}
