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

  const headerEmployee = employee ? toHeaderEmployee(employee) : null;

  return (
    <AppShell
      title="对话"
      actions={
        <ConversationHeader
          employee={headerEmployee}
          conversationTitle={conv?.title ?? null}
        />
      }
    >
      <div className="flex h-full flex-col min-w-0">
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
      <ConfirmationDialog />
    </AppShell>
  );
}
