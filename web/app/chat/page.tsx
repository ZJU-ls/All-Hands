"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createConversation, getConversation } from "@/lib/api";
import { AppShell } from "@/components/shell/AppShell";
import { hasCompletedFirstRun } from "@/lib/first-run";
import { FIRST_RUN_SCOPE as WELCOME_SCOPE } from "@/app/welcome/page";

// Lead-only pointer · separate from any per-employee conversation storage.
// The legacy generic key (`allhands_conversation_id`) sometimes ended up
// pointing at a non-Lead employee, which is exactly what this Lead-scoped
// route should never surface. We migrate the legacy value once on first
// hit, then drop it.
const LEAD_CONVERSATION_STORAGE_KEY = "allhands_lead_conversation_id";
const LEGACY_CONVERSATION_STORAGE_KEY = "allhands_conversation_id";

export default function ChatPage() {
  const router = useRouter();
  const t = useTranslations("chat.page");
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

        const res = await fetch("/api/employees/lead");
        if (!res.ok) {
          setError(t("backendNotReady"));
          return;
        }
        const lead = (await res.json()) as { id: string };

        // One-time migration of the legacy generic key. If it still points
        // at the Lead, promote it to the Lead-scoped key; otherwise drop it.
        const legacyId = localStorage.getItem(LEGACY_CONVERSATION_STORAGE_KEY);
        if (legacyId) {
          try {
            const c = await getConversation(legacyId);
            if (c.employee_id === lead.id) {
              localStorage.setItem(LEAD_CONVERSATION_STORAGE_KEY, legacyId);
            }
          } catch {
            // 404 / network — fall through; legacy id will be cleaned below
          }
          localStorage.removeItem(LEGACY_CONVERSATION_STORAGE_KEY);
        }

        const existingId = localStorage.getItem(LEAD_CONVERSATION_STORAGE_KEY);
        if (existingId) {
          // Verify the stored conversation still belongs to the Lead. If a
          // user changed who the Lead is, or the row was deleted, fall
          // through to a fresh Lead conversation instead of opening a stale
          // / wrong-employee chat.
          try {
            const c = await getConversation(existingId);
            if (c.employee_id === lead.id) {
              router.replace(`/chat/${existingId}`);
              return;
            }
          } catch {
            // invalid pointer · drop it and create fresh below
          }
          localStorage.removeItem(LEAD_CONVERSATION_STORAGE_KEY);
        }
        const conv = await createConversation(lead.id);
        localStorage.setItem(LEAD_CONVERSATION_STORAGE_KEY, conv.id);
        router.replace(`/chat/${conv.id}`);
      } catch (e) {
        setError(String(e));
      }
    }
    void bootstrap();
  }, [router, t]);

  return (
    <AppShell title={t("shellTitle")}>
      <div className="flex h-full items-center justify-center p-8">
        {error ? (
          <div className="text-sm max-w-md text-center">
            <p className="font-semibold mb-2 text-danger">{t("connectionError")}</p>
            <p className="text-text-muted">{error}</p>
          </div>
        ) : (
          <p className="text-text-muted text-sm">{t("initializing")}</p>
        )}
      </div>
    </AppShell>
  );
}
