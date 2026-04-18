"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
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
  getConversation,
  getEmployee,
  type ConversationDto,
  type EmployeeDto,
} from "@/lib/api";

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
  const [conv, setConv] = useState<ConversationDto | null>(null);
  const [employee, setEmployee] = useState<EmployeeDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

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
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

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
          <div className="flex-1 overflow-y-auto">
            <MessageList conversationId={conversationId} />
          </div>
          <InputBar conversationId={conversationId} />
        </div>
        {panelOpen && <ArtifactPanel onClose={() => setPanelOpen(false)} />}
      </div>
      <ConfirmationDialog />
    </AppShell>
  );
}
