"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { MessageList } from "@/components/chat/MessageList";
import { InputBar } from "@/components/chat/InputBar";
import { ConfirmationDialog } from "@/components/chat/ConfirmationDialog";
import { ProgressPanel } from "@/components/chat/ProgressPanel";
import { UserInputDialog } from "@/components/chat/UserInputDialog";
import {
  ConversationHeader,
  type ConversationHeaderEmployee,
} from "@/components/chat/ConversationHeader";
import { ConversationSwitcher } from "@/components/chat/ConversationSwitcher";
import { AppShell } from "@/components/shell/AppShell";
import { ArtifactPanel } from "@/components/artifacts/ArtifactPanel";
import { useArtifactFocus } from "@/lib/artifact-focus-store";
import { ErrorState } from "@/components/state";
import { Icon } from "@/components/ui/icon";
import {
  ApiError,
  BackendUnreachableError,
  getConversation,
  getEmployee,
  listConversationMessages,
  type ConversationDto,
  type EmployeeDto,
} from "@/lib/api";
import { useChatStore } from "@/lib/store";
import type { Message } from "@/lib/protocol";
import { foldToolMessages } from "@/lib/history-fold";

// Legacy + new (Lead-scoped) storage keys. We clear both on a stale 404 so
// neither one can pin /chat to a missing conversation.
const CONVERSATION_STORAGE_KEY = "allhands_conversation_id";
const LEAD_CONVERSATION_STORAGE_KEY = "allhands_lead_conversation_id";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "unreachable"; attempt: number }
  | { kind: "error"; message: string };

const RETRY_DELAYS_MS = [2000, 4000, 8000, 16000, 16000];

function toHeaderEmployee(e: EmployeeDto): ConversationHeaderEmployee {
  return {
    id: e.id,
    name: e.name,
    description: e.description,
    tool_ids: e.tool_ids,
    is_lead_agent: e.is_lead_agent,
  };
}

/**
 * Offline banner · Brand Blue Dual Theme V2.
 *
 * Soft-warning rounded banner with a pulsing status dot, retry button and a
 * short hint at the backend target so operators can correlate with the server
 * log while Claude is reconnecting.
 */
function BackendOfflineBanner({
  attempt,
  onRetry,
}: {
  attempt: number;
  onRetry: () => void;
}) {
  const t = useTranslations("chat.conversation");
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="backend-offline-banner"
      className="mx-3 mt-3 flex items-center gap-3 rounded-xl border border-warning/30 bg-warning-soft px-3 py-2 text-[12px] shadow-soft-sm"
    >
      <span className="relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning">
        <Icon name="plug" size={13} />
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-warning animate-ping"
        />
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="font-medium text-text">{t("backendOffline")}</span>
        <span className="font-mono text-[11px] text-text-muted">{t("attempt", { n: attempt })}</span>
      </div>
      <span className="hidden font-mono text-[11px] text-text-subtle md:inline">
        backend · :8000
      </span>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-warning/40 bg-surface px-2.5 font-medium text-[11px] text-warning transition-colors duration-base hover:bg-warning/10"
      >
        <Icon name="refresh" size={11} />
        {t("retryNow")}
      </button>
    </div>
  );
}

export default function ConversationPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const router = useRouter();
  const t = useTranslations("chat.conversation");
  const [conv, setConv] = useState<ConversationDto | null>(null);
  const [employee, setEmployee] = useState<EmployeeDto | null>(null);
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [panelOpen, setPanelOpen] = useState(false);
  const replaceMessages = useChatStore((s) => s.replaceMessages);
  const resetChatStore = useChatStore((s) => s.reset);

  // 2026-04-26 · click-to-focus: a chat-side Artifact.Card click writes to
  // the focus store · this auto-opens the panel · ArtifactPanel itself
  // listens to the same store and jumps into the detail view.
  const focusedArtifactId = useArtifactFocus((s) => s.artifactId);
  const focusBumpTick = useArtifactFocus((s) => s.bumpTick);
  useEffect(() => {
    if (focusedArtifactId) setPanelOpen(true);
  }, [focusedArtifactId, focusBumpTick]);
  const retryAttemptRef = useRef(0);
  const manualRetryRef = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    // Wipe any in-flight streaming state from the previous conversation so a
    // half-rendered assistant bubble (e.g. mid-tool-call from the chat we
    // just navigated away from) doesn't bleed into the new conversation
    // before its history finishes loading.
    resetChatStore();

    async function attempt(): Promise<void> {
      try {
        const c = await getConversation(conversationId);
        if (cancelled) return;
        // Parallel: employee metadata + persisted history. Either failing in
        // isolation was previously a silent catch; with BackendUnreachableError
        // we treat the pair as one transaction so a flaky backend shows the
        // unified "offline" state instead of half-loading.
        const [e, history] = await Promise.all([
          getEmployee(c.employee_id),
          listConversationMessages(conversationId),
        ]);
        if (cancelled) return;
        // Historical rehydrate: the live SSE stream no longer owns these
        // fields exclusively — GET /messages now returns render_payloads /
        // tool_calls / reasoning persisted on finalize so reopening a chat
        // restores charts, cards, inline tool chips, and thinking-channel
        // replay to exactly the state the user saw mid-turn. Dropping them
        // here was the second half of the "historical render vanished" bug.
        const wireMessages: Message[] = history.map((m) => ({
          id: m.id,
          conversation_id: m.conversation_id,
          role: m.role,
          content: m.content,
          tool_calls: m.tool_calls ?? [],
          render_payloads: m.render_payloads ?? [],
          reasoning: m.reasoning ?? undefined,
          // 2026-04-25 · interrupt flag round-trips through DB so reload
          // shows the 「已中止」 tail on past partial turns, not just on
          // the live one we just cancelled.
          interrupted: m.interrupted ?? false,
          is_compacted: m.is_compacted ?? false,
          attachment_ids: m.attachment_ids ?? [],
          tool_call_id: m.tool_call_id ?? null,
          created_at: m.created_at,
        }));
        // Fold role=tool rows into the preceding assistant's matching
        // tool_call (result + status). Without this, a multi-step turn
        // shows up as N segmented bubbles + tool cards forever stuck on
        // "running". See lib/history-fold.ts for the rule.
        const asMessages = foldToolMessages(
          wireMessages as (Message & { role: "user" | "assistant" | "tool" | "system" })[],
        );
        setConv(c);
        setEmployee(e);
        replaceMessages(asMessages);
        retryAttemptRef.current = 0;
        setLoadState({ kind: "ready" });
      } catch (e) {
        if (cancelled) return;
        // B05 · stale-id 404 → evict pointer + bounce to landing (unchanged).
        if (e instanceof ApiError && e.status === 404 && !(e instanceof BackendUnreachableError)) {
          try {
            localStorage.removeItem(CONVERSATION_STORAGE_KEY);
            localStorage.removeItem(LEAD_CONVERSATION_STORAGE_KEY);
          } catch {
            // SSR / private-mode guard — safe to ignore
          }
          router.replace("/chat");
          return;
        }
        // Backend offline / restarting → show actionable card + auto-retry.
        if (e instanceof BackendUnreachableError) {
          const attemptN = retryAttemptRef.current;
          const delay = RETRY_DELAYS_MS[Math.min(attemptN, RETRY_DELAYS_MS.length - 1)];
          retryAttemptRef.current = attemptN + 1;
          setLoadState({ kind: "unreachable", attempt: attemptN + 1 });
          retryTimer = setTimeout(() => {
            if (!cancelled) void attempt();
          }, delay);
          return;
        }
        // Real application error → surface, no auto-retry.
        setLoadState({ kind: "error", message: String(e) });
      }
    }

    manualRetryRef.current = () => {
      if (cancelled) return;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      retryAttemptRef.current = 0;
      setLoadState({ kind: "loading" });
      void attempt();
    };
    void attempt();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [conversationId, router, replaceMessages, resetChatStore]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setPanelOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const headerEmployee = employee ? toHeaderEmployee(employee) : null;
  // Non-Lead employees get their own shell title — the "One for All · single
  // Lead Agent" tagline only fits the Lead surface. Loading falls back to the
  // tagline since we don't yet know which employee owns this conversation.
  const isNonLeadEmployee = Boolean(employee && !employee.is_lead_agent);
  const shellTitle =
    isNonLeadEmployee && employee
      ? t("shellTitleEmployee", { name: employee.name })
      : t("shellTitle");
  // The sidebar 「对话」 entry conceptually owns the Lead-chat surface only.
  // For an employee chat we anchor the highlight back to 「员工」 so the
  // user sees they're inside the employee track, not the Lead track.
  const sidebarActiveOverride = isNonLeadEmployee ? "/employees" : undefined;

  return (
    <AppShell title={shellTitle} sidebarActiveOverride={sidebarActiveOverride}>
      <div className="flex h-full min-h-0 min-w-0">
        <div className="flex h-full min-h-0 flex-1 flex-col min-w-0">
          {loadState.kind === "unreachable" && (
            <BackendOfflineBanner
              attempt={loadState.attempt}
              onRetry={() => manualRetryRef.current()}
            />
          )}
          {loadState.kind === "error" && (
            <div className="px-3 pt-3">
              <ErrorState
                title={t("loadFailedTitle")}
                description={t("loadFailedDescription")}
                detail={loadState.message}
                action={{ label: t("retry"), onClick: () => manualRetryRef.current() }}
              />
            </div>
          )}
          <div
            data-testid="conversation-toolbar"
            className="relative z-20 flex h-11 items-center gap-2 border-b border-border bg-surface/60 px-3 min-w-0 backdrop-blur-sm"
          >
            <div className="min-w-0 flex-1">
              <ConversationHeader
                employee={headerEmployee}
                conversationTitle={conv?.title ?? null}
                effectiveModelRef={conv?.model_ref_override ?? employee?.model_ref ?? null}
                isOverridden={Boolean(conv?.model_ref_override)}
              />
            </div>
            <ConversationSwitcher
              employeeId={employee?.id ?? null}
              currentConversationId={conversationId}
            />
            <button
              onClick={() => setPanelOpen((v) => !v)}
              aria-pressed={panelOpen}
              aria-label={t("toggleArtifacts")}
              title={t("artifactsTooltip")}
              className={
                panelOpen
                  ? "inline-flex h-7 items-center gap-1.5 rounded-md border border-primary/40 bg-primary-muted px-2 text-[11px] font-medium text-primary transition-colors duration-base"
                  : "inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface px-2 text-[11px] font-medium text-text-muted transition-colors duration-base hover:border-border-strong hover:text-text hover:bg-surface-2"
              }
            >
              <Icon name="panel-right" size={12} />
              <span>{t("artifacts")}</span>
              <span
                aria-hidden="true"
                className={
                  panelOpen
                    ? "inline-flex h-4 items-center gap-0.5 rounded bg-primary/15 px-1 font-mono text-[9px] text-primary"
                    : "inline-flex h-4 items-center gap-0.5 rounded bg-surface-2 px-1 font-mono text-[9px] text-text-subtle"
                }
              >
                <Icon name="command" size={9} />J
              </span>
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <MessageList conversationId={conversationId} />
          </div>
          {/* ADR 0019 · plan + sub-agent progress (sticks above input,
              auto-hides when nothing to show). */}
          <ProgressPanel conversationId={conversationId} />
          <InputBar
            conversationId={conversationId}
            employeeModelRef={employee?.model_ref}
            conversation={conv}
            employee={employee}
            onConversationChange={setConv}
            initialActiveRunId={conv?.active_run_id ?? null}
          />
        </div>
        {panelOpen && (
          <ArtifactPanel
            onClose={() => setPanelOpen(false)}
            conversationId={conversationId}
          />
        )}
      </div>
      <ConfirmationDialog />
      <UserInputDialog />
    </AppShell>
  );
}
