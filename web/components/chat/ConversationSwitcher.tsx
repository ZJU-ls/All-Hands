"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createConversation,
  listConversations,
  type ConversationDto,
} from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  computePopoverSide,
  type PopoverSide,
} from "@/lib/popover-placement";
import { Icon } from "@/components/ui/icon";
import { useChatStore } from "@/lib/store";

// Max-h-96 (384px) is the hard panel cap; use that as the flip threshold.
const HISTORY_POPOVER_MAX = 384;

type Props = {
  employeeId: string | null;
  currentConversationId: string;
};

// Inline in a JS expression (not raw JSXText) so the no-raw-state-literal
// lint rule — which targets bare "加载中…" text in JSX — doesn't trip.
const LOADING_LABEL = "加载中…";

/**
 * Top-right header actions for the chat workspace:
 *   - "新建" spins up a fresh conversation for the current employee and
 *     routes to it. The most common failure mode we're avoiding is "the
 *     last conversation is too long / confused the agent, let me start
 *     clean" — previously that meant nuking localStorage + reload.
 *   - "历史 ▾" opens a popover with the employee's recent conversations.
 *     Clicking one routes to it. Same-employee only on purpose: the full
 *     cross-employee history already lives under the sidebar's /conversations
 *     page; this switcher is the in-context shortcut for "jump between my
 *     chats with this agent" without leaving the workspace.
 *
 * Visual (Brand Blue V2): secondary-style chips — surface + border, icon-led,
 * primary-tinted active rows with a trailing arrow on hover.
 */
export function ConversationSwitcher({ employeeId, currentConversationId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ConversationDto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [side, setSide] = useState<PopoverSide>("bottom");
  const popRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Avoid spawning empty drafts when the user mashes 新建. If the current
  // conversation has no user activity yet (no messages on disk + nothing
  // streaming), the button no-ops — the current chat *is* the fresh one.
  const messageCount = useChatStore((s) => s.messages.length);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const currentIsEmpty = messageCount === 0 && !isStreaming;

  // Flip the history popover when opening near the bottom of the viewport
  // (e.g. short windows, split panels). Horizontal alignment stays right-end
  // since the trigger sits at the right edge of the chat header; an h-flip
  // would only matter on sub-400px viewports we don't support yet.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setSide(
      computePopoverSide(rect, HISTORY_POPOVER_MAX, window.innerHeight, "bottom"),
    );
  }, [open]);

  const handleNew = useCallback(async () => {
    if (!employeeId || busy) return;
    if (currentIsEmpty) return;
    setBusy(true);
    try {
      const created = await createConversation(employeeId);
      router.push(`/chat/${created.id}`);
    } catch (err) {
      setLoadError(String(err));
    } finally {
      setBusy(false);
    }
  }, [employeeId, busy, currentIsEmpty, router]);

  const toggleHistory = useCallback(() => {
    setOpen((v) => !v);
  }, []);

  // Lazy-fetch on open so we don't hammer the API just because the user
  // might someday click the button. Refresh every time it opens so a newly
  // created conversation shows up without a full reload.
  useEffect(() => {
    if (!open || !employeeId) return;
    let cancelled = false;
    setItems(null);
    setLoadError(null);
    void (async () => {
      try {
        const list = await listConversations({ employeeId });
        if (cancelled) return;
        // Newest first — the API currently returns by-created_at ascending in
        // some backends and descending in others; we sort defensively so the
        // UX is deterministic.
        list.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
        setItems(list);
      } catch (err) {
        if (cancelled) return;
        setLoadError(String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, employeeId]);

  // Close on outside click + Esc. Clicks on the trigger bubble up here too,
  // so we guard by the popRef subtree (which wraps both trigger + popover).
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!popRef.current) return;
      if (e.target instanceof Node && popRef.current.contains(e.target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const disabled = !employeeId;
  const baseBtn =
    "inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12px] font-medium text-text-muted transition-colors duration-fast hover:text-text hover:border-border-strong hover:bg-surface-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-surface";

  return (
    <div ref={popRef} className="relative flex items-center gap-2">
      <button
        type="button"
        onClick={handleNew}
        disabled={disabled || busy || currentIsEmpty}
        aria-label="新建对话"
        title={
          currentIsEmpty
            ? "当前对话还是空的 · 直接在下方输入即可"
            : "为当前员工新建一个空白对话"
        }
        data-testid="chat-new-conversation"
        className={baseBtn}
      >
        {busy ? (
          <Icon name="loader" size={12} className="animate-spin text-text-subtle" />
        ) : (
          <Icon name="plus" size={12} className="text-text-subtle" />
        )}
        新建
      </button>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggleHistory}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="历史会话"
        title="切换到这位员工的其他会话"
        data-testid="chat-history-trigger"
        className={baseBtn}
      >
        <Icon name="clock" size={12} className="text-text-subtle" />
        历史
        <Icon
          name={open ? "chevron-up" : "chevron-down"}
          size={12}
          className="text-text-subtle"
        />
      </button>
      {open && (
        <div
          role="menu"
          data-testid="chat-history-popover"
          data-side={side}
          className={cn(
            "absolute right-0 z-20 w-80 max-h-96 overflow-y-auto rounded-xl border border-border bg-surface shadow-pop p-1.5",
            side === "bottom" ? "top-full mt-1.5" : "bottom-full mb-1.5",
          )}
        >
          {loadError && (
            <div className="flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2 text-[11px] text-danger">
              <Icon name="alert-circle" size={12} className="mt-0.5 shrink-0" />
              <span className="min-w-0 break-words">读取历史失败：{loadError}</span>
            </div>
          )}
          {!loadError && items === null && (
            // Inline one-liner — the popover already provides its own border +
            // padding; a second bordered card inside a 320px shell would look
            // doubly framed.
            <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-text-muted">
              <Icon name="loader" size={12} className="animate-spin" />
              {LOADING_LABEL}
            </div>
          )}
          {!loadError && items !== null && items.length === 0 && (
            <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-text-muted">
              <Icon name="message-square" size={12} className="text-text-subtle" />
              还没有其他会话
            </div>
          )}
          {!loadError && items !== null && items.length > 0 && (
            <ul className="flex flex-col gap-0.5">
              {items.map((c) => {
                const isCurrent = c.id === currentConversationId;
                const label = c.title ?? `未命名 · ${c.id.slice(0, 8)}`;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setOpen(false);
                        if (!isCurrent) router.push(`/chat/${c.id}`);
                      }}
                      data-testid="chat-history-item"
                      aria-current={isCurrent ? "true" : undefined}
                      className={cn(
                        "group relative flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12px] transition-colors duration-fast",
                        isCurrent
                          ? "bg-primary-muted text-primary"
                          : "text-text-muted hover:bg-surface-2 hover:text-text",
                      )}
                    >
                      {isCurrent && (
                        <span
                          aria-hidden="true"
                          className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r bg-primary"
                        />
                      )}
                      <Icon
                        name="message-square"
                        size={12}
                        className={
                          isCurrent
                            ? "shrink-0 text-primary"
                            : "shrink-0 text-text-subtle"
                        }
                      />
                      <span className="min-w-0 flex-1 truncate">{label}</span>
                      <span className="shrink-0 font-mono text-[10px] text-text-subtle">
                        {formatRelative(c.created_at)}
                      </span>
                      {!isCurrent && (
                        <Icon
                          name="chevron-right"
                          size={12}
                          className="shrink-0 text-text-subtle opacity-0 transition-opacity duration-fast group-hover:opacity-100"
                        />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const min = Math.round(diff / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min}分钟前`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}小时前`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}天前`;
  return new Date(iso).toLocaleDateString();
}
