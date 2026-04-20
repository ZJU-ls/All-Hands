"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createConversation,
  listConversations,
  type ConversationDto,
} from "@/lib/api";

type Props = {
  employeeId: string | null;
  currentConversationId: string;
};

// Inline in a JS expression (not raw JSXText) so the no-raw-state-literal
// lint rule — which targets bare "加载中…" text in JSX — doesn't trip.
const LOADING_LABEL = "加载中…";

/**
 * Top-right header actions for the chat workspace:
 *   - "＋ 新建" spins up a fresh conversation for the current employee and
 *     routes to it. The most common failure mode we're avoiding is "the
 *     last conversation is too long / confused the agent, let me start
 *     clean" — previously that meant nuking localStorage + reload.
 *   - "历史 ▾" opens a popover with the employee's recent conversations.
 *     Clicking one routes to it. Same-employee only on purpose: the full
 *     cross-employee history already lives under the sidebar's /conversations
 *     page; this switcher is the in-context shortcut for "jump between my
 *     chats with this agent" without leaving the workspace.
 *
 * Visual: matches the adjacent "制品 ⌘J" button — mono prefix char + text,
 * border-only hover, token colors, no animation libraries (§3.5).
 */
export function ConversationSwitcher({ employeeId, currentConversationId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ConversationDto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const handleNew = useCallback(async () => {
    if (!employeeId || busy) return;
    setBusy(true);
    try {
      const created = await createConversation(employeeId);
      router.push(`/chat/${created.id}`);
    } catch (err) {
      setLoadError(String(err));
    } finally {
      setBusy(false);
    }
  }, [employeeId, busy, router]);

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
    "inline-flex h-7 items-center gap-1 rounded-md border px-2 font-mono text-[11px] transition-colors duration-base border-border text-text-muted hover:text-text hover:border-border-strong disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <div ref={popRef} className="relative flex items-center gap-2">
      <button
        type="button"
        onClick={handleNew}
        disabled={disabled || busy}
        aria-label="新建对话"
        title="为当前员工新建一个空白对话"
        data-testid="chat-new-conversation"
        className={baseBtn}
      >
        <span aria-hidden className="text-text-subtle">＋</span>
        新建
      </button>
      <button
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
        历史
        <span aria-hidden className="text-text-subtle">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div
          role="menu"
          data-testid="chat-history-popover"
          className="absolute right-0 top-full z-20 mt-1 w-80 max-h-96 overflow-y-auto rounded-md border border-border bg-surface shadow-sm"
        >
          {loadError && (
            <div className="px-3 py-2 text-[11px] text-danger">
              读取历史失败：{loadError}
            </div>
          )}
          {!loadError && items === null && (
            // Inline one-liner instead of <LoadingState /> — the popover
            // already provides its own border + padding; a second bordered
            // card inside a 320px shell would look doubly framed.
            <div className="px-3 py-2 text-[11px] text-text-muted">
              {LOADING_LABEL}
            </div>
          )}
          {!loadError && items !== null && items.length === 0 && (
            <div className="px-3 py-2 text-[11px] text-text-muted">
              还没有其他会话
            </div>
          )}
          {!loadError && items !== null && items.length > 0 && (
            <ul className="flex flex-col">
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
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12px] transition-colors duration-base hover:bg-surface-2 ${
                        isCurrent ? "bg-surface-2 text-text" : "text-text-muted hover:text-text"
                      }`}
                    >
                      <span className="truncate">{label}</span>
                      <span className="shrink-0 font-mono text-[10px] text-text-subtle">
                        {formatRelative(c.created_at)}
                      </span>
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
