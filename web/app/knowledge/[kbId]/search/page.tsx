"use client";

/**
 * /knowledge/[kbId]/search · Search tab.
 *
 * Full-screen hybrid search surface. Each result card has an inline "why
 * this rank?" explainer (BM25 ⊕ vector contribution + matched tokens).
 *
 * URL params:
 *   ?q=<query>  (auto-fires on mount; updates as user types via debounce)
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";
import { LoadingState } from "@/components/state";
import { useKBContext } from "@/components/knowledge/KBContext";
import { type ScoredChunkDto, searchKB } from "@/lib/kb-api";

export default function SearchTabPage() {
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <SearchTabInner />
    </Suspense>
  );
}

function SearchTabInner() {
  const { kb } = useKBContext();
  const t = useTranslations("knowledge.search");
  const router = useRouter();
  const params = useSearchParams();
  const initialQ = params.get("q") ?? "";
  const [draft, setDraft] = useState(initialQ);
  const [committed, setCommitted] = useState(initialQ);
  const [results, setResults] = useState<ScoredChunkDto[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runSearch(q: string) {
    if (!q.trim()) {
      setResults(null);
      setCommitted("");
      return;
    }
    setSearching(true);
    setCommitted(q.trim());
    setResults(null);
    try {
      setResults(await searchKB(kb.id, q.trim()));
    } catch (e) {
      setError(String(e));
    } finally {
      setSearching(false);
    }
  }

  useEffect(() => {
    if (initialQ.trim()) void runSearch(initialQ.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQ]);

  function submitSearch() {
    const q = draft.trim();
    if (!q) return;
    // Push so the URL updates and the search becomes shareable.
    router.replace(`/knowledge/${kb.id}/search?q=${encodeURIComponent(q)}`);
    void runSearch(q);
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Query bar */}
      <div className="border-b border-border bg-surface px-6 py-4">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <Icon name="search" size={14} className="text-text-subtle" />
          <input
            type="text"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitSearch();
              }
            }}
            placeholder={t("placeholder", { kb: kb.name })}
            className="h-10 flex-1 rounded-xl border border-border bg-surface-2 px-3 text-[14px] text-text placeholder:text-text-subtle focus:border-border-strong focus:outline-none"
          />
          <button
            type="button"
            onClick={submitSearch}
            disabled={!draft.trim() || searching}
            className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-[12px] font-medium text-primary-fg shadow-soft-sm hover:bg-primary-hover disabled:opacity-40"
          >
            {searching ? t("running") : t("submit")}
          </button>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-3xl space-y-3">
          {searching && (
            <LoadingState
              title={t("loadingTitle")}
              description={t("loadingDesc")}
            />
          )}
          {!searching && committed && results && results.length === 0 && (
            <div className="rounded-xl border border-border bg-surface p-6 text-center text-[12px] text-text-muted">
              {t("noResults")}
            </div>
          )}
          {!searching && !committed && (
            <div className="rounded-xl border border-dashed border-border p-8 text-center text-[12px] text-text-muted">
              {t("emptyHint", { kb: kb.name })}
            </div>
          )}
          {!searching && results && results.length > 0 && (
            <>
              <div className="font-mono text-[10px] uppercase tracking-wider text-text-subtle">
                {t("hits", { count: results.length })} · &ldquo;{committed}&rdquo;
              </div>
              {results.map((r, i) => (
                <ResultCard
                  key={r.chunk_id}
                  rank={i + 1}
                  query={committed}
                  result={r}
                  onClick={() =>
                    router.push(`/knowledge/${kb.id}/docs/${r.document_id}`)
                  }
                />
              ))}
            </>
          )}
          {error && (
            <div className="rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-[12px] text-danger">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultCard({
  rank,
  query,
  result,
  onClick,
}: {
  rank: number;
  query: string;
  result: ScoredChunkDto;
  onClick: () => void;
}) {
  const t = useTranslations("knowledge.search");
  const [open, setOpen] = useState(false);

  const { tokens, matched } = useMemo(
    () => analyseQueryMatch(query, result.text),
    [query, result.text],
  );
  const hasBoth = result.bm25_rank != null && result.vector_rank != null;

  return (
    <div className="rounded-xl border border-border bg-surface p-4 transition duration-fast hover:border-border-strong hover:shadow-soft-sm">
      <button
        type="button"
        onClick={onClick}
        className="block w-full text-left"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-md bg-primary-muted px-2 py-0.5 font-mono text-[10px] text-primary">
              #{rank}
            </span>
            <span className="font-mono text-[11px] text-text-muted">
              {result.citation}
            </span>
            {result.bm25_rank != null && (
              <span className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-text-subtle">
                BM25 #{result.bm25_rank}
              </span>
            )}
            {result.vector_rank != null && (
              <span className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-text-subtle">
                vec #{result.vector_rank}
              </span>
            )}
          </div>
          <div className="flex flex-col items-end font-mono text-[10px] text-text-subtle">
            <span>{t("scoreLabel")}</span>
            <span className="text-[12px] text-text">{result.score.toFixed(4)}</span>
          </div>
        </div>
        {result.section_path && (
          <div className="mt-2 font-mono text-[10px] text-text-subtle">
            {result.section_path}
          </div>
        )}
        <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-[13px] leading-relaxed text-text">
          {highlightTokens(result.text, matched)}
        </p>
      </button>

      <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-text-subtle hover:text-text"
          aria-expanded={open}
        >
          <Icon name={open ? "chevron-up" : "chevron-down"} size={11} />
          {t("explainLabel")}
        </button>
        {tokens.length > 0 && (
          <span className="font-mono text-[10px] text-text-subtle">
            {t("matchedTokens", {
              matched: matched.length,
              total: tokens.length,
            })}
          </span>
        )}
      </div>

      {open && (
        <div className="mt-3 space-y-3 rounded-lg border border-border bg-surface-2 px-3 py-3 text-[12px]">
          <ContributionBar
            bm25Rank={result.bm25_rank}
            vectorRank={result.vector_rank}
          />
          {tokens.length > 0 && (
            <div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-text-subtle">
                {t("matchedHeader")}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {tokens.map((tok) => {
                  const hit = matched.includes(tok);
                  return (
                    <span
                      key={tok}
                      className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] ${
                        hit
                          ? "border border-success/30 bg-success-soft text-success"
                          : "border border-border bg-surface-2 text-text-subtle"
                      }`}
                    >
                      {tok}
                      {hit ? " ✓" : ""}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
          <div className="font-mono text-[10px] leading-relaxed text-text-subtle">
            {hasBoth
              ? t("explainBoth", {
                  bm25: result.bm25_rank ?? 0,
                  vec: result.vector_rank ?? 0,
                })
              : result.bm25_rank != null
                ? t("explainBm25Only", { bm25: result.bm25_rank })
                : t("explainVecOnly", { vec: result.vector_rank ?? 0 })}
          </div>
        </div>
      )}
    </div>
  );
}

function ContributionBar({
  bm25Rank,
  vectorRank,
}: {
  bm25Rank: number | null;
  vectorRank: number | null;
}) {
  const t = useTranslations("knowledge.search");
  const bm = bm25Rank != null ? 1 / bm25Rank : 0;
  const vc = vectorRank != null ? 1 / vectorRank : 0;
  const total = bm + vc || 1;
  const bmPct = Math.round((bm / total) * 100);
  const vcPct = 100 - bmPct;
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-wider text-text-subtle">
        {t("contributionHeader")}
      </div>
      <div className="mt-1.5 flex h-2 w-full overflow-hidden rounded-full bg-surface-2">
        {bm > 0 && (
          <div
            className="h-full bg-primary"
            style={{ width: `${bmPct}%` }}
            title={t("bm25Pct", { pct: bmPct })}
          />
        )}
        {vc > 0 && (
          <div
            className="h-full bg-accent"
            style={{ width: `${vcPct}%` }}
            title={t("vectorPct", { pct: vcPct })}
          />
        )}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-text-subtle">
        <span>BM25 {bmPct}%</span>
        <span>
          {t("vectorPctLabel")} {vcPct}%
        </span>
      </div>
    </div>
  );
}

function analyseQueryMatch(
  query: string,
  text: string,
): { tokens: string[]; matched: string[] } {
  const raw = query
    .toLowerCase()
    .split(/[\s,.;:!?'"()\[\]{}<>=*&|/\\]+/)
    .filter((w) => w.length > 1 || /[\u4e00-\u9fff]/.test(w));
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const w of raw) {
    if (!seen.has(w)) {
      seen.add(w);
      tokens.push(w);
    }
  }
  const lower = text.toLowerCase();
  const matched = tokens.filter((tok) => lower.includes(tok));
  return { tokens, matched };
}

function highlightTokens(text: string, matched: string[]): React.ReactNode {
  if (matched.length === 0) return text;
  const re = new RegExp(
    `(${matched.map((tok) => tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "gi",
  );
  const parts = text.split(re);
  return parts.map((part, i) =>
    matched.some((m) => m.toLowerCase() === part.toLowerCase()) ? (
      <mark key={i} className="rounded-sm bg-warning-soft px-0.5 text-text">
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}
