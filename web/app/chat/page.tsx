"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createConversation } from "@/lib/api";

export default function ChatPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function bootstrap() {
      try {
        const existingId = localStorage.getItem("allhands_conversation_id");
        if (existingId) {
          router.replace(`/chat/${existingId}`);
          return;
        }

        const res = await fetch("/api/employees/lead");
        if (!res.ok) {
          setError("Backend not ready. Make sure `docker compose up` is running.");
          return;
        }
        const lead = (await res.json()) as { id: string };
        const conv = await createConversation(lead.id);
        localStorage.setItem("allhands_conversation_id", conv.id);
        router.replace(`/chat/${conv.id}`);
      } catch (e) {
        setError(String(e));
      }
    }
    void bootstrap();
  }, [router]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="text-danger text-sm max-w-md text-center">
          <p className="font-semibold mb-2">Connection error</p>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-text-muted text-sm">Starting conversation…</p>
    </div>
  );
}
