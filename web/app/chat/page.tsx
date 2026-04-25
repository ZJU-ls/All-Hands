"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createConversation } from "@/lib/api";
import { AppShell } from "@/components/shell/AppShell";
import { hasCompletedFirstRun } from "@/lib/first-run";
import { FIRST_RUN_SCOPE as WELCOME_SCOPE } from "@/app/welcome/page";

// Same key the conversation page reads when cleaning up a stale pointer (B05).
const CONVERSATION_STORAGE_KEY = "allhands_conversation_id";

export default function ChatPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function bootstrap() {
      try {
        // First-run gate: send brand-new visitors through /welcome so they
        // get a one-time hello before being dropped into a fresh conversation.
        if (!hasCompletedFirstRun(WELCOME_SCOPE)) {
          router.replace("/welcome");
          return;
        }
        const existingId = localStorage.getItem(CONVERSATION_STORAGE_KEY);
        if (existingId) {
          router.replace(`/chat/${existingId}`);
          return;
        }

        const res = await fetch("/api/employees/lead");
        if (!res.ok) {
          setError("后端未就绪,请确认服务已启动。");
          return;
        }
        const lead = (await res.json()) as { id: string };
        const conv = await createConversation(lead.id);
        localStorage.setItem(CONVERSATION_STORAGE_KEY, conv.id);
        router.replace(`/chat/${conv.id}`);
      } catch (e) {
        setError(String(e));
      }
    }
    void bootstrap();
  }, [router]);

  return (
    <AppShell title="对话">
      <div className="flex h-full items-center justify-center p-8">
        {error ? (
          <div className="text-sm max-w-md text-center">
            <p className="font-semibold mb-2 text-danger">连接错误</p>
            <p className="text-text-muted">{error}</p>
          </div>
        ) : (
          <p className="text-text-muted text-sm">正在初始化对话…</p>
        )}
      </div>
    </AppShell>
  );
}
