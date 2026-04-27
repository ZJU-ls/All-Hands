"use client";

/**
 * /knowledge/[kbId]/ask · Ask tab.
 *
 * Full-screen multi-turn RAG conversation. Streaming via askKBStream;
 * sources appear in a right side panel that pins the latest turn's hits.
 *
 * URL params:
 *   ?q=<initial question>  (auto-fires on mount, e.g. from Overview starter chips)
 */

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";
import { useKBContext } from "@/components/knowledge/KBContext";
import {
  type AskHistoryTurn,
  type AskSource,
  type AskStreamFrame,
  askKBStream,
  getStarterQuestions,
} from "@/lib/kb-api";

type AskTurn = {
  id: string;
  question: string;
  sources: AskSource[];
  answer: string;
  streaming: boolean;
  error: string | null;
  usedModel: string | null;
  latencyMs: number | null;
};

export default function AskTabPage() {
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <AskTabInner />
    </Suspense>
  );
}

function AskTabInner() {
  const { kb } = useKBContext();
  const t = useTranslations("knowledge.ask");
  const router = useRouter();
  const search = useSearchParams();
  const initialQ = search.get("q") ?? "";
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<AskTurn[]>([]);
  const [starters, setStarters] = useState<string[] | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const fired = useRef(false);

  useEffect(() => {
    getStarterQuestions(kb.id, 4)
      .then(setStarters)
      .catch(() => setStarters([]));
  }, [kb.id]);

  // Auto-fire initial question from URL (?q=...) once on mount.
  useEffect(() => {
    if (!initialQ.trim() || fired.current) return;
    fired.current = true;
    void runTurn(initialQ.trim(), false);
    // Strip ?q= so reload doesn't re-fire.
    const next = new URL(window.location.href);
    next.searchParams.delete("q");
    router.replace(next.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQ]);

  // Scroll to bottom on new content.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [turns]);

  async function runTurn(question: string, followUp: boolean) {
    const q = question.trim();
    if (!q) return;
    const turnId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const blank: AskTurn = {
      id: turnId,
      question: q,
      sources: [],
      answer: "",
      streaming: true,
      error: null,
      usedModel: null,
      latencyMs: null,
    };
    setTurns((prev) => (followUp ? [...prev, blank] : [blank]));

    const history: AskHistoryTurn[] = followUp
      ? turns
          .filter((tt) => !tt.error && tt.answer)
          .flatMap<AskHistoryTurn>((tt) => [
            { role: "user", content: tt.question },
            { role: "assistant", content: tt.answer },
          ])
      : [];

    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;

    try {
      for await (const frame of askKBStream(kb.id, q, {
        topK: 5,
        history,
        signal: ctl.signal,
      })) {
        applyFrame(turnId, frame);
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      applyFrame(turnId, { event: "error", message: String(e) });
    }
  }

  function applyFrame(turnId: string, frame: AskStreamFrame) {
    setTurns((prev) =>
      prev.map((tt) => {
        if (tt.id !== turnId) return tt;
        switch (frame.event) {
          case "sources":
            return { ...tt, sources: frame.sources };
          case "delta":
            return { ...tt, answer: tt.answer + frame.text };
          case "done":
            return {
              ...tt,
              streaming: false,
              usedModel: frame.used_model,
              latencyMs: frame.latency_ms,
            };
          case "error":
            return { ...tt, streaming: false, error: frame.message };
          default:
            return tt;
        }
      }),
    );
  }

  function clearAll() {
    abortRef.current?.abort();
    setTurns([]);
  }

  function submitDraft() {
    const q = draft.trim();
    if (!q || turns.some((tt) => tt.streaming)) return;
    setDraft("");
    void runTurn(q, turns.length > 0);
  }

  const tail = turns[turns.length - 1];
  const anyStreaming = turns.some((tt) => tt.streaming);
  const allSources = turns.flatMap((tt) => tt.sources);
  // Dedupe sources by chunk_id, keep latest
  const sourceMap = new Map<number, AskSource>();
  for (const s of allSources) sourceMap.set(s.chunk_id, s);
  const dedupedSources = Array.from(sourceMap.values());

  return (
    <div className="grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[1fr_320px]">
      {/* Left: conversation */}
      <div className="flex min-h-0 flex-col">
        {turns.length === 0 ? (
          <EmptyAsk
            kbName={kb.name}
            starters={starters}
            onPick={(q) => {
              setDraft(q);
              void runTurn(q, false);
            }}
          />
        ) : (
          <div ref={scrollerRef} className="flex-1 overflow-y-auto px-6 py-4">
            <div className="mx-auto max-w-3xl space-y-6">
              {turns.map((turn, idx) => (
                <TurnView
                  key={turn.id}
                  turn={turn}
                  idx={idx}
                  onChunkClick={(docId) =>
                    router.push(`/knowledge/${kb.id}/docs/${docId}`)
                  }
                />
              ))}
            </div>
          </div>
        )}

        {/* Composer */}
        <div className="border-t border-border bg-surface px-6 py-3">
          <div className="mx-auto max-w-3xl">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submitDraft();
                  }
                }}
                placeholder={
                  turns.length === 0
                    ? t("placeholderFirst", { kb: kb.name })
                    : t("placeholderFollowUp")
                }
                disabled={anyStreaming}
                className="h-10 flex-1 rounded-xl border border-border bg-surface-2 px-3 text-[13px] text-text placeholder:text-text-subtle focus:border-border-strong focus:outline-none disabled:opacity-50"
              />
              <button
                type="button"
                onClick={submitDraft}
                disabled={anyStreaming || !draft.trim()}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-primary px-4 text-[12px] font-medium text-primary-fg shadow-soft-sm hover:bg-primary-hover disabled:opacity-40"
              >
                <Icon name="sparkles" size={12} />
                {anyStreaming ? t("running") : t("send")}
              </button>
              {turns.length > 0 && (
                <button
                  type="button"
                  onClick={clearAll}
                  disabled={anyStreaming}
                  className="inline-flex h-10 items-center gap-1 rounded-xl border border-border bg-surface px-3 text-[11px] text-text-muted hover:border-border-strong hover:text-text disabled:opacity-40"
                >
                  <Icon name="refresh" size={11} />
                  {t("newConversation")}
                </button>
              )}
            </div>
            <div className="mt-1.5 flex items-center justify-between font-mono text-[10px] text-text-subtle">
              <span>{t("hint")}</span>
              {tail?.usedModel && tail.latencyMs !== null && (
                <span>
                  {tail.usedModel} · {tail.latencyMs?.toFixed(0)} ms
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Right: sources panel */}
      <aside className="hidden border-l border-border bg-surface-2 p-4 lg:block lg:overflow-y-auto">
        <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-text-subtle">
          {t("sourcesLabel")} · {t("sourcesCount", { count: dedupedSources.length })}
        </div>
        {dedupedSources.length === 0 ? (
          <p className="mt-3 text-[12px] text-text-muted">
            {t("sourcesEmpty")}
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {dedupedSources.map((s) => (
              <li key={s.chunk_id}>
                <Link
                  href={`/knowledge/${kb.id}/docs/${s.doc_id}`}
                  className="block rounded-lg border border-border bg-surface p-3 text-[11px] hover:border-primary/40"
                >
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center rounded-md bg-primary-muted px-2 py-0.5 font-mono text-[10px] text-primary">
                      [{s.n}]
                    </span>
                    <span className="font-mono text-[9px] text-text-subtle">
                      {s.score.toFixed(4)}
                    </span>
                  </div>
                  <div className="mt-1.5 font-mono text-[10px] text-text-muted">
                    {s.citation}
                  </div>
                  {s.section_path && (
                    <div className="mt-1 font-mono text-[10px] text-text-subtle">
                      {s.section_path}
                    </div>
                  )}
                  <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-[11px] leading-relaxed text-text">
                    {s.text}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}

function EmptyAsk({
  kbName,
  starters,
  onPick,
}: {
  kbName: string;
  starters: string[] | null;
  onPick: (q: string) => void;
}) {
  const t = useTranslations("knowledge.ask");
  const ts = useTranslations("knowledge.starters");
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
      <div className="mx-auto w-full max-w-2xl text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-primary-muted">
          <Icon name="sparkles" size={26} className="text-primary" />
        </div>
        <h2 className="text-[18px] font-semibold text-text">
          {t("emptyTitle", { kb: kbName })}
        </h2>
        <p className="mt-2 text-[13px] text-text-muted">{t("emptyDesc")}</p>
        {starters && starters.length > 0 && (
          <div className="mt-6 text-left">
            <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-text-subtle">
              {ts("label")}
            </div>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {starters.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => onPick(q)}
                  className="flex items-start gap-2 rounded-xl border border-border bg-surface p-3 text-left text-[12px] text-text hover:border-primary/40 hover:bg-primary-muted/20"
                >
                  <Icon
                    name="message-square"
                    size={12}
                    className="mt-0.5 text-primary"
                  />
                  <span className="leading-snug">{q}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TurnView({
  turn,
  idx,
  onChunkClick,
}: {
  turn: AskTurn;
  idx: number;
  onChunkClick: (docId: string) => void;
}) {
  const t = useTranslations("knowledge.ask");
  const parts = renderAnswerWithCites(turn.answer, turn.sources, onChunkClick, turn.id);
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2.5">
        <div className="mt-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary-muted text-primary">
          <Icon name="user" size={11} />
        </div>
        <div className="flex-1">
          <div className="font-mono text-[10px] uppercase tracking-wider text-text-subtle">
            {t("youAskedLabel", { n: idx + 1 })}
          </div>
          <p className="mt-1 text-[14px] leading-snug text-text">{turn.question}</p>
        </div>
      </div>

      <div className="flex items-start gap-2.5">
        <div className="mt-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-surface-2 text-primary">
          <Icon name="sparkles" size={11} />
        </div>
        <div className="flex-1 group relative rounded-xl border border-border bg-surface-2 p-4">
          {turn.error ? (
            <div className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-[12px] text-danger">
              {turn.error}
            </div>
          ) : turn.streaming && !turn.answer ? (
            <div className="flex items-center gap-2 text-[12px] text-text-muted">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              <span>{t("thinkingTitle")}</span>
            </div>
          ) : (
            <p className="whitespace-pre-wrap text-[14px] leading-[1.7] text-text">
              {parts}
              {turn.streaming && (
                <span className="ml-0.5 inline-block h-[14px] w-[2px] animate-pulse bg-primary align-middle" />
              )}
            </p>
          )}
          {!turn.streaming && turn.answer && (
            <CopyButton turn={turn} />
          )}
        </div>
      </div>
    </div>
  );
}

function CopyButton({ turn }: { turn: AskTurn }) {
  const t = useTranslations("knowledge.ask");
  const [copied, setCopied] = useState(false);
  async function copy() {
    const lines: string[] = [];
    lines.push(`> **Q:** ${turn.question}`);
    lines.push("");
    lines.push(turn.answer.trim());
    if (turn.sources.length > 0) {
      lines.push("");
      lines.push("**Sources**");
      for (const s of turn.sources) {
        const sec = s.section_path ? ` · § ${s.section_path}` : "";
        lines.push(`- [${s.n}] ${s.citation}${sec}`);
      }
    }
    if (turn.usedModel) {
      lines.push("");
      lines.push(`*Generated with ${turn.usedModel}*`);
    }
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      alert(t("copyFailed"));
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-0.5 font-mono text-[10px] text-text-subtle opacity-0 transition group-hover:opacity-100 hover:text-text"
      title={t("copyAsCitationTitle")}
    >
      <Icon name={copied ? "check" : "copy"} size={10} />
      {copied ? t("copied") : t("copyAsCitation")}
    </button>
  );
}

function renderAnswerWithCites(
  answer: string,
  sources: AskSource[],
  onClickSource: (docId: string) => void,
  turnId?: string,
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /\[(\d+)\]/g;
  const known = new Map(sources.map((s) => [s.n, s] as const));
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(answer)) !== null) {
    if (m.index > last) {
      out.push(<span key={`t${key++}`}>{answer.slice(last, m.index)}</span>);
    }
    const n = Number(m[1]);
    const src = known.get(n);
    if (src) {
      out.push(
        <button
          key={`c${key++}`}
          type="button"
          onClick={() => {
            const id = turnId ? `src-${turnId}-${n}` : `src-${n}`;
            const el = document.getElementById(id);
            el?.scrollIntoView({ behavior: "smooth", block: "center" });
            onClickSource(src.doc_id);
          }}
          className="mx-0.5 inline-flex items-center rounded-md bg-primary-muted px-1.5 align-baseline font-mono text-[11px] text-primary hover:bg-primary/20 transition duration-fast"
          title={src.citation}
        >
          [{n}]
        </button>,
      );
    } else {
      out.push(<span key={`t${key++}`}>{m[0]}</span>);
    }
    last = m.index + m[0].length;
  }
  if (last < answer.length) {
    out.push(<span key={`t${key++}`}>{answer.slice(last)}</span>);
  }
  return out;
}
