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

type AgentActivity = {
  id: string;
  tool: string;
  label: string;
  startedAt: number;
  durationMs: number | null;
  resultCount: number | null;
  state: "running" | "done";
};

type AskTurn = {
  id: string;
  question: string;
  sources: AskSource[];
  answer: string;
  streaming: boolean;
  error: string | null;
  usedModel: string | null;
  latencyMs: number | null;
  // Per-turn agent activity log — every tool_call → tool_result pair shows
  // up here so the user sees a search step + a thinking step in real time
  // instead of staring at a blinking dot for 20 s.
  activity: AgentActivity[];
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

  // ChatGPT-style smart auto-scroll: only stick-to-bottom if the user is
  // already near the bottom. If they scrolled up to read an earlier turn,
  // don't yank them down on each delta — show the "↓ 新内容" button instead.
  const [pinned, setPinned] = useState(true);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      setPinned(dist < 80);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !pinned) return;
    el.scrollTop = el.scrollHeight;
  }, [turns, pinned]);

  function scrollToBottom() {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setPinned(true);
  }

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
      activity: [],
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
          case "tool_call": {
            const entry: AgentActivity = {
              id: `${frame.tool}-${Date.now()}-${Math.random()
                .toString(36)
                .slice(2, 6)}`,
              tool: frame.tool,
              label: frame.label,
              startedAt: Date.now(),
              durationMs: null,
              resultCount: null,
              state: "running",
            };
            return { ...tt, activity: [...tt.activity, entry] };
          }
          case "tool_result": {
            // Mark the most recent matching running tool entry as done.
            const next = [...tt.activity];
            for (let i = next.length - 1; i >= 0; i--) {
              const a = next[i];
              if (a && a.tool === frame.tool && a.state === "running") {
                next[i] = {
                  ...a,
                  state: "done",
                  durationMs: frame.duration_ms,
                  resultCount: frame.result_count ?? null,
                };
                break;
              }
            }
            return { ...tt, activity: next };
          }
          case "sources":
            return { ...tt, sources: frame.sources };
          case "delta":
            return { ...tt, answer: tt.answer + frame.text };
          case "done": {
            // Close any still-running activity (the LLM tool_call has no
            // matching tool_result frame — done is its terminator).
            const closed = tt.activity.map((a) =>
              a.state === "running"
                ? { ...a, state: "done" as const, durationMs: Date.now() - a.startedAt }
                : a,
            );
            return {
              ...tt,
              activity: closed,
              streaming: false,
              usedModel: frame.used_model,
              latencyMs: frame.latency_ms,
            };
          }
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

  // ChatGPT/Perplexity-style "Stop generating" — abort the in-flight stream
  // and mark the running turn as done with whatever partial answer we have.
  // The user keeps the partial text + sources; can hit Regenerate to retry.
  function stopGenerating() {
    abortRef.current?.abort();
    setTurns((prev) =>
      prev.map((tt) =>
        tt.streaming
          ? {
              ...tt,
              streaming: false,
              activity: tt.activity.map((a) =>
                a.state === "running"
                  ? {
                      ...a,
                      state: "done" as const,
                      durationMs: Date.now() - a.startedAt,
                    }
                  : a,
              ),
            }
          : tt,
      ),
    );
  }

  // Drop the most recent turn and re-run with the same question + same prior
  // history. Useful when the model went off-track or the answer is clearly
  // wrong on a slow KB (still gets the same retrieval, but a fresh LLM roll).
  async function regenerate(turn: AskTurn) {
    const targetIdx = turns.findIndex((tt) => tt.id === turn.id);
    if (targetIdx < 0 || anyStreaming) return;
    const isFirst = targetIdx === 0;
    setTurns((prev) => prev.slice(0, targetIdx));
    await runTurn(turn.question, !isFirst);
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
          <div className="relative flex-1 overflow-hidden">
            <div ref={scrollerRef} className="h-full overflow-y-auto px-6 py-4">
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
            {!pinned && (
              <button
                type="button"
                onClick={scrollToBottom}
                className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 inline-flex h-8 items-center gap-1 rounded-full border border-border bg-surface px-3 text-[11px] text-text-muted shadow-soft-md hover:border-primary/40 hover:text-primary"
                title={t("scrollToBottomTitle")}
              >
                <Icon name="arrow-down" size={11} />
                {anyStreaming ? t("scrollToBottomStreaming") : t("scrollToBottom")}
              </button>
            )}
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
              {anyStreaming ? (
                <button
                  type="button"
                  onClick={stopGenerating}
                  className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-danger/40 bg-danger-soft px-4 text-[12px] font-medium text-danger hover:bg-danger/10"
                  title={t("stopTitle")}
                >
                  <Icon name="pause" size={12} />
                  {t("stop")}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={submitDraft}
                  disabled={!draft.trim()}
                  className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-primary px-4 text-[12px] font-medium text-primary-fg shadow-soft-sm hover:bg-primary-hover disabled:opacity-40"
                >
                  <Icon name="sparkles" size={12} />
                  {t("send")}
                </button>
              )}
              {turns.length > 0 && !anyStreaming && tail && tail.answer && (
                <button
                  type="button"
                  onClick={() => regenerate(tail)}
                  className="inline-flex h-10 items-center gap-1 rounded-xl border border-border bg-surface px-3 text-[11px] text-text-muted hover:border-primary/40 hover:text-primary"
                  title={t("regenerateTitle")}
                >
                  <Icon name="refresh" size={11} />
                  {t("regenerate")}
                </button>
              )}
              {turns.length > 0 && (
                <button
                  type="button"
                  onClick={clearAll}
                  disabled={anyStreaming}
                  className="inline-flex h-10 items-center gap-1 rounded-xl border border-border bg-surface px-3 text-[11px] text-text-muted hover:border-border-strong hover:text-text disabled:opacity-40"
                  title={t("newConversationTitle")}
                >
                  <Icon name="x" size={11} />
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
          {turn.activity.length > 0 && (
            <ActivityLog activity={turn.activity} streaming={turn.streaming} />
          )}
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

// Agent activity log — small bordered strip above the answer showing each
// tool the (deterministic) "agent" called and the wall-clock it took. Lets
// users see step labels live (search → thinking) instead of staring at a
// silent dot for 20 s. While streaming, the running entry gets a live
// elapsed-time counter (1-Hz tick).
function ActivityLog({
  activity,
  streaming,
}: {
  activity: AgentActivity[];
  streaming: boolean;
}) {
  const t = useTranslations("knowledge.ask");
  // 1 Hz ticker keeps the running entry's elapsed time fresh; bail when
  // nothing is running so we don't spin forever.
  const hasRunning = streaming && activity.some((a) => a.state === "running");
  const [, force] = useState(0);
  useEffect(() => {
    if (!hasRunning) return;
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [hasRunning]);

  return (
    <ul className="mb-3 space-y-1 rounded-lg border border-border bg-surface px-3 py-2">
      {activity.map((a) => {
        const elapsed =
          a.state === "running"
            ? Date.now() - a.startedAt
            : (a.durationMs ?? 0);
        const ms = elapsed.toFixed(0);
        return (
          <li
            key={a.id}
            className="flex items-center gap-2 font-mono text-[10.5px] text-text-muted"
          >
            {a.state === "running" ? (
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            ) : (
              <Icon name="check" size={11} className="text-success" />
            )}
            <span className="flex-1 truncate">{a.label}</span>
            {a.resultCount !== null && (
              <span className="text-text-subtle">
                {t("activityHits", { count: a.resultCount })}
              </span>
            )}
            <span className="text-text-subtle">{ms} ms</span>
          </li>
        );
      })}
    </ul>
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

// Answer renderer · light markdown (fenced code blocks + inline bold/italic/
// `code`) + clickable [N] citation chips. Avoiding a full markdown parser
// keeps the chip-anchor logic clean — chips need to scroll to source-N which
// would be tricky if marked turned [N] into something else mid-stream.
function renderAnswerWithCites(
  answer: string,
  sources: AskSource[],
  onClickSource: (docId: string) => void,
  turnId?: string,
): React.ReactNode[] {
  const known = new Map(sources.map((s) => [s.n, s] as const));
  const out: React.ReactNode[] = [];
  let key = 0;

  // Split first by fenced ```code``` so we don't try to chip-ify inside code.
  const fenced = answer.split(/(```[\s\S]*?```)/g);
  for (const seg of fenced) {
    if (seg.startsWith("```") && seg.endsWith("```") && seg.length > 6) {
      // ```lang\n…\n```  → extract optional lang + body
      const inner = seg.slice(3, -3);
      const nl = inner.indexOf("\n");
      const lang = nl > 0 ? inner.slice(0, nl).trim() : "";
      const body = nl > 0 ? inner.slice(nl + 1) : inner;
      out.push(
        <CodeBlock key={`c${key++}`} lang={lang} body={body.replace(/\n$/, "")} />,
      );
      continue;
    }
    // Inline render: handle [N] citations + tiny inline markdown.
    pushInline(seg, out, () => `inline-${key++}`, known, onClickSource, turnId);
  }
  return out;
}

// Push inline content (text + citations + minimal `code` / **bold**) into the
// output array. Streaming-safe: while answer is mid-token, malformed `**` or
// backticks render literally — tolerated as transient artefacts.
function pushInline(
  text: string,
  out: React.ReactNode[],
  nextKey: () => string,
  known: Map<number, AskSource>,
  onClickSource: (docId: string) => void,
  turnId?: string,
): void {
  // 1. citation [N] split
  const citeRe = /\[(\d+)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = citeRe.exec(text)) !== null) {
    if (m.index > last) {
      out.push(
        <InlineMd key={nextKey()} text={text.slice(last, m.index)} />,
      );
    }
    const n = Number(m[1]);
    const src = known.get(n);
    if (src) {
      out.push(
        <CiteChip
          key={nextKey()}
          n={n}
          src={src}
          turnId={turnId}
          onClickSource={onClickSource}
        />,
      );
    } else {
      out.push(<span key={nextKey()}>{m[0]}</span>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    out.push(<InlineMd key={nextKey()} text={text.slice(last)} />);
  }
}

// `code` + **bold** + *italic* renderer. Pure text is preserved
// whitespace-pre-wrap-style by parent. Streaming-tolerant: an unterminated
// pair just renders literally.
function InlineMd({ text }: { text: string }) {
  if (!text) return null;
  const parts: React.ReactNode[] = [];
  let key = 0;
  // Greedy: code first(`x`), then bold(**x**), then italic(*x* or _x_).
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*|_[^_\n]+_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("`")) {
      parts.push(
        <code
          key={`md${key++}`}
          className="rounded bg-bg/40 px-1 font-mono text-[12px] text-text"
        >
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("**")) {
      parts.push(
        <strong key={`md${key++}`} className="font-semibold text-text">
          {tok.slice(2, -2)}
        </strong>,
      );
    } else {
      parts.push(
        <em key={`md${key++}`} className="italic text-text">
          {tok.slice(1, -1)}
        </em>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function CiteChip({
  n,
  src,
  turnId,
  onClickSource,
}: {
  n: number;
  src: AskSource;
  turnId?: string;
  onClickSource: (docId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => {
          const id = turnId ? `src-${turnId}-${n}` : `src-${n}`;
          const el = document.getElementById(id);
          el?.scrollIntoView({ behavior: "smooth", block: "center" });
          onClickSource(src.doc_id);
        }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="mx-0.5 inline-flex items-center rounded-md bg-primary-muted px-1.5 align-baseline font-mono text-[11px] text-primary hover:bg-primary/20 transition duration-fast"
        title={src.citation}
      >
        [{n}]
      </button>
      {open && (
        <span className="absolute left-1/2 z-30 mt-1 hidden w-80 -translate-x-1/2 rounded-lg border border-border bg-surface p-3 text-left shadow-soft-lg sm:block">
          <span className="block font-mono text-[10px] text-text-subtle">
            [{n}] · score {src.score.toFixed(3)}
          </span>
          <span className="mt-1 block font-mono text-[10px] text-text-muted">
            {src.citation}
          </span>
          {src.section_path && (
            <span className="mt-1 block font-mono text-[10px] text-text-subtle">
              {src.section_path}
            </span>
          )}
          <span className="mt-2 block whitespace-pre-wrap text-[11px] leading-relaxed text-text line-clamp-6">
            {src.text}
          </span>
        </span>
      )}
    </span>
  );
}

function CodeBlock({ lang, body }: { lang: string; body: string }) {
  const t = useTranslations("knowledge.ask");
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }
  return (
    <span className="my-2 block rounded-lg border border-border bg-bg/40">
      <span className="flex items-center justify-between border-b border-border px-3 py-1 font-mono text-[10px] text-text-subtle">
        <span>{lang || "text"}</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 hover:text-text"
        >
          <Icon name={copied ? "check" : "copy"} size={10} />
          {copied ? t("copied") : t("copyCode")}
        </button>
      </span>
      <pre className="overflow-x-auto p-3 font-mono text-[12px] leading-relaxed text-text">
        <code>{body}</code>
      </pre>
    </span>
  );
}
