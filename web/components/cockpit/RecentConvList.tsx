"use client";

import Link from "next/link";
import type { ConvCardDto } from "@/lib/cockpit-api";

function dateShort(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function RecentConvList({ conversations }: { conversations: ConvCardDto[] }) {
  return (
    <section className="flex flex-col min-h-0">
      <header className="flex items-center justify-between h-8 px-3 border-b border-border">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-text-subtle">
          最近对话
        </span>
        <Link
          href="/conversations"
          className="font-mono text-[10px] text-text-subtle hover:text-text transition-colors duration-base"
        >
          全部 →
        </Link>
      </header>
      {conversations.length === 0 ? (
        <p className="py-6 text-center text-[12px] text-text-muted">
          还没有对话。去 /chat 起一段。
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {conversations.map((c) => (
            <li key={c.id}>
              <Link
                href={`/chat/${c.id}`}
                className="flex items-center gap-3 px-3 py-2 text-[12px] hover:bg-surface-2 transition-colors duration-base"
              >
                <span className="font-mono text-[10px] text-text-subtle shrink-0">
                  {c.employee_name}
                </span>
                <span className="flex-1 truncate text-text">
                  {c.title || "(无标题)"}
                </span>
                <time className="font-mono text-[10px] text-text-subtle shrink-0">
                  {dateShort(c.updated_at)}
                </time>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
