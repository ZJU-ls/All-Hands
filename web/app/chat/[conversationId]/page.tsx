"use client";

import { useParams } from "next/navigation";
import { MessageList } from "@/components/chat/MessageList";
import { InputBar } from "@/components/chat/InputBar";
import { ConfirmationDialog } from "@/components/chat/ConfirmationDialog";

export default function ConversationPage() {
  const { conversationId } = useParams<{ conversationId: string }>();

  return (
    <div className="flex h-full w-full">
      <div className="w-56 shrink-0 border-r border-border flex flex-col p-3 gap-2">
        <div className="text-xs font-semibold text-text-muted uppercase tracking-wider px-1">
          allhands
        </div>
        <div className="text-xs text-text-muted px-1">Lead Agent</div>
      </div>

      <div className="flex flex-col flex-1 min-w-0">
        <div className="flex-1 overflow-y-auto">
          <MessageList conversationId={conversationId} />
        </div>
        <InputBar conversationId={conversationId} />
      </div>

      <ConfirmationDialog />
    </div>
  );
}
