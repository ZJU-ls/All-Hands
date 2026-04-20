"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { MessageList } from "@/components/chat/MessageList";
import { InputBar } from "@/components/chat/InputBar";
import { ConfirmationDialog } from "@/components/chat/ConfirmationDialog";
import {
  ConversationHeader,
  type ConversationHeaderEmployee,
} from "@/components/chat/ConversationHeader";
import { AppShell } from "@/components/shell/AppShell";
import { ArtifactPanel } from "@/components/artifacts/ArtifactPanel";
import {
  ApiError,
  getConversation,
  getEmployee,
  listConversationMessages,
  type ConversationDto,
  type EmployeeDto,
} from "@/lib/api";
import { useChatStore } from "@/lib/store";
import type { Message } from "@/lib/protocol";

const CONVERSATION_STORAGE_KEY = "allhands_conversation_id";

function toHeaderEmployee(e: EmployeeDto): ConversationHeaderEmployee {
  return {
    id: e.id,
    name: e.name,
    description: e.description,
    tool_ids: e.tool_ids,
    is_lead_agent: e.is_lead_agent,
  };
}

export default function ConversationPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const router = useRouter();
  const [conv, setConv] = useState<ConversationDto | null>(null);
  const [employee, setEmployee] = useState<EmployeeDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const replaceMessages = useChatStore((s) => s.replaceMessages);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const c = await getConversation(conversationId);
        if (cancelled) return;
        setConv(c);
        const e = await getEmployee(c.employee_id);
        if (cancelled) return;
        setEmployee(e);
        // Rehydrate persisted history so MessageList + UsageChip reflect the
        // conversation immediately on reload. New SSE-streamed messages get
        // appended via addMessage; this is just the initial snapshot.
        try {
          const history = await listConversationMessages(conversationId);
          if (cancelled) return;
          const asMessages: Message[] = history.map((m) => ({
            id: m.id,
            conversation_id: m.conversation_id,
            role: m.role,
            content: m.content,
            tool_calls: [],
            render_payloads: [],
            created_at: m.created_at,
          }));
          replaceMessages(asMessages);
        } catch {
          // history load failure is non-fatal — chat still works for new turns
        }
      } catch (e) {
        if (cancelled) return;
        // B05 · a 404 means the conversation id in the URL (typically
        // restored from localStorage after a db reset or manual deletion)
        // no longer exists. Silently evict the stale pointer and bounce
        // back to /chat — the landing page will mint a fresh conversation.
        // Surfacing the raw "404" error card would suggest the backend is
        // broken, which it isn't.
        if (e instanceof ApiError && e.status === 404) {
          try {
            localStorage.removeItem(CONVERSATION_STORAGE_KEY);
          } catch {
            // SSR / private-mode guard — safe to ignore
          }
          router.replace("/chat");
          return;
        }
        setError(String(e));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [conversationId, router, replaceMessages]);

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

  return (
    <AppShell
      title="对话"
      actions={
        <div className="flex items-center gap-2">
          <ConversationHeader
            employee={headerEmployee}
            conversationTitle={conv?.title ?? null}
            effectiveModelRef={conv?.model_ref_override ?? employee?.model_ref ?? null}
            isOverridden={Boolean(conv?.model_ref_override)}
          />
          <button
            onClick={() => setPanelOpen((v) => !v)}
            aria-pressed={panelOpen}
            aria-label="切换制品区"
            title="制品区 · Cmd/Ctrl+J"
            className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 font-mono text-[11px] transition-colors duration-base ${
              panelOpen
                ? "border-border-strong bg-surface-2 text-text"
                : "border-border text-text-muted hover:text-text hover:border-border-strong"
            }`}
          >
            制品 <span className="text-text-subtle">⌘J</span>
          </button>
        </div>
      }
    >
      <div className="flex h-full min-w-0">
        <div className="flex h-full flex-1 flex-col min-w-0">
          {error && (
            <div className="border-b border-border bg-surface-2 px-4 py-2 text-[12px] text-danger">
              {error}
            </div>
          )}
          <div className="flex-1 min-h-0">
            <MessageList conversationId={conversationId} />
          </div>
          <InputBar
            conversationId={conversationId}
            employeeModelRef={employee?.model_ref}
            conversation={conv}
            employee={employee}
            onConversationChange={setConv}
          />
        </div>
        {panelOpen && <ArtifactPanel onClose={() => setPanelOpen(false)} />}
      </div>
      <ConfirmationDialog />
    </AppShell>
  );
}
