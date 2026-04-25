"use client";

import { useMemo, useState } from "react";
import type { RenderProps } from "@/lib/component-registry";
import { CopyButton } from "@/components/render/_shared/CopyButton";
import { SegmentedControl } from "@/components/render/_shared/Toolbar";

type DiffLine = { kind: "context" | "add" | "del"; text: string };
type ViewMode = "unified" | "split";

/**
 * Minimal LCS-based line diff. Good enough for review-sized diffs (< 500 lines).
 */
function computeDiff(before: string, after: string): DiffLine[] {
  const a = before.replace(/\n$/, "").split("\n");
  const b = after.replace(/\n$/, "").split("\n");
  const m = a.length;
  const n = b.length;
  const at = (arr: string[], idx: number): string => arr[idx] ?? "";
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  const dpAt = (i: number, j: number): number => dp[i]?.[j] ?? 0;
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      const row = dp[i];
      if (!row) continue;
      if (at(a, i) === at(b, j)) row[j] = dpAt(i + 1, j + 1) + 1;
      else row[j] = Math.max(dpAt(i + 1, j), dpAt(i, j + 1));
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (at(a, i) === at(b, j)) {
      out.push({ kind: "context", text: at(a, i) });
      i++;
      j++;
    } else if (dpAt(i + 1, j) >= dpAt(i, j + 1)) {
      out.push({ kind: "del", text: at(a, i) });
      i++;
    } else {
      out.push({ kind: "add", text: at(b, j) });
      j++;
    }
  }
  while (i < m) {
    out.push({ kind: "del", text: at(a, i) });
    i++;
  }
  while (j < n) {
    out.push({ kind: "add", text: at(b, j) });
    j++;
  }
  return out;
}

const FOLD_THRESHOLD = 5; // collapse runs of ≥5 unchanged lines

type Block =
  | { kind: "lines"; lines: DiffLine[] }
  | { kind: "fold"; count: number; lines: DiffLine[] };

function computeBlocks(lines: DiffLine[]): Block[] {
  const blocks: Block[] = [];
  let bufContext: DiffLine[] = [];
  let bufChange: DiffLine[] = [];
  for (const ln of lines) {
    if (ln.kind === "context") {
      if (bufChange.length > 0) {
        blocks.push({ kind: "lines", lines: bufChange });
        bufChange = [];
      }
      bufContext.push(ln);
    } else {
      // Flush context: if many, split as fold + tail.
      if (bufContext.length > 0) {
        if (bufContext.length > FOLD_THRESHOLD) {
          // Show first 2 + fold middle + last 2; but keep it simple for now —
          // fold the whole run except the last 2 lines closest to the change.
          const head = bufContext.slice(0, 2);
          const fold = bufContext.slice(2, -2);
          const tail = bufContext.slice(-2);
          if (head.length) blocks.push({ kind: "lines", lines: head });
          if (fold.length) blocks.push({ kind: "fold", count: fold.length, lines: fold });
          if (tail.length) blocks.push({ kind: "lines", lines: tail });
        } else {
          blocks.push({ kind: "lines", lines: bufContext });
        }
        bufContext = [];
      }
      bufChange.push(ln);
    }
  }
  if (bufChange.length > 0) blocks.push({ kind: "lines", lines: bufChange });
  if (bufContext.length > 0) {
    if (bufContext.length > FOLD_THRESHOLD) {
      const head = bufContext.slice(0, 2);
      const fold = bufContext.slice(2);
      if (head.length) blocks.push({ kind: "lines", lines: head });
      if (fold.length) blocks.push({ kind: "fold", count: fold.length, lines: fold });
    } else {
      blocks.push({ kind: "lines", lines: bufContext });
    }
  }
  return blocks;
}

/**
 * Brand-Blue V2 (ADR 0016) · diff viewer.
 *
 * Interactions (2026-04-25):
 *   - view toggle      · split / unified · in-header SegmentedControl
 *                       · default = split (easier to scan two faces)
 *   - fold unchanged   · runs of ≥5 unchanged lines collapse into a click-
 *                         to-expand bar; folded blocks remember their state
 *   - copy 旧版 / 新版 · explicit text labels instead of two identical
 *                         clipboard icons (which read as "copy what?")
 */
export function Diff({ props }: RenderProps) {
  const before = (props.before as string | undefined) ?? "";
  const after = (props.after as string | undefined) ?? "";
  // Default to split — two-column view makes the before/after relationship
  // obvious without scanning gutter pills. Unified is opt-in via prop.
  const initialMode: ViewMode = props.mode === "unified" ? "unified" : "split";
  const filename = props.filename as string | undefined;
  const language = props.language as string | undefined;

  const [mode, setMode] = useState<ViewMode>(initialMode);

  const lines = useMemo(() => computeDiff(before, after), [before, after]);
  const blocks = useMemo(() => computeBlocks(lines), [lines]);

  const stats = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const line of lines) {
      if (line.kind === "add") additions++;
      if (line.kind === "del") deletions++;
    }
    return { additions, deletions };
  }, [lines]);

  function rowBg(kind: DiffLine["kind"]): string {
    if (kind === "add") return "bg-success/5";
    if (kind === "del") return "bg-danger/5";
    return "";
  }
  function gutterPill(kind: DiffLine["kind"]): { sign: string; cls: string } {
    if (kind === "add") return { sign: "+", cls: "text-success bg-success/10" };
    if (kind === "del") return { sign: "-", cls: "text-danger bg-danger/10" };
    return { sign: " ", cls: "text-text-subtle" };
  }
  function textColor(kind: DiffLine["kind"]): string {
    if (kind === "add") return "text-success";
    if (kind === "del") return "text-danger";
    return "text-text";
  }

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden shadow-soft-sm animate-fade-up">
      <Header
        filename={filename}
        language={language}
        additions={stats.additions}
        deletions={stats.deletions}
        mode={mode}
        onMode={setMode}
        before={before}
        after={after}
      />
      {mode === "split" ? (
        <SplitView
          blocks={blocks}
          rowBg={rowBg}
          gutterPill={gutterPill}
          textColor={textColor}
        />
      ) : (
        <UnifiedView
          blocks={blocks}
          rowBg={rowBg}
          gutterPill={gutterPill}
          textColor={textColor}
        />
      )}
    </div>
  );
}

function UnifiedView({
  blocks,
  rowBg,
  gutterPill,
  textColor,
}: {
  blocks: Block[];
  rowBg: (k: DiffLine["kind"]) => string;
  gutterPill: (k: DiffLine["kind"]) => { sign: string; cls: string };
  textColor: (k: DiffLine["kind"]) => string;
}) {
  let lineCounter = 0;
  return (
    <div className="overflow-x-auto py-1 text-caption font-mono leading-relaxed">
      {blocks.map((block, bi) => {
        if (block.kind === "fold") {
          const startLine = lineCounter + 1;
          lineCounter += block.lines.length;
          return (
            <FoldBar key={bi} count={block.count} startLine={startLine} >
              {block.lines.map((line, i) => (
                <DiffRow
                  key={i}
                  line={line}
                  lineNum={startLine + i}
                  rowBg={rowBg}
                  gutterPill={gutterPill}
                  textColor={textColor}
                />
              ))}
            </FoldBar>
          );
        }
        return (
          <div key={bi}>
            {block.lines.map((line, i) => {
              lineCounter += 1;
              return (
                <DiffRow
                  key={i}
                  line={line}
                  lineNum={lineCounter}
                  rowBg={rowBg}
                  gutterPill={gutterPill}
                  textColor={textColor}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function SplitView({
  blocks,
  rowBg,
  gutterPill,
  textColor,
}: {
  blocks: Block[];
  rowBg: (k: DiffLine["kind"]) => string;
  gutterPill: (k: DiffLine["kind"]) => { sign: string; cls: string };
  textColor: (k: DiffLine["kind"]) => string;
}) {
  // Build paired left/right rows from the unified line stream.
  const flatLines: DiffLine[] = blocks.flatMap((b) => b.lines);
  const left: (DiffLine | null)[] = [];
  const right: (DiffLine | null)[] = [];
  for (const line of flatLines) {
    if (line.kind === "context") {
      left.push(line);
      right.push(line);
    } else if (line.kind === "del") {
      left.push(line);
      right.push(null);
    } else {
      left.push(null);
      right.push(line);
    }
  }
  return (
    <div className="grid grid-cols-2 text-caption font-mono leading-relaxed">
      <div className="border-r border-border">
        {left.map((line, i) => (
          <DiffRow
            key={i}
            line={line}
            lineNum={i + 1}
            rowBg={rowBg}
            gutterPill={gutterPill}
            textColor={textColor}
          />
        ))}
      </div>
      <div>
        {right.map((line, i) => (
          <DiffRow
            key={i}
            line={line}
            lineNum={i + 1}
            rowBg={rowBg}
            gutterPill={gutterPill}
            textColor={textColor}
          />
        ))}
      </div>
    </div>
  );
}

function FoldBar({
  count,
  startLine,
  children,
}: {
  count: number;
  startLine: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (open) return <div>{children}</div>;
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="block w-full px-3 py-1.5 text-left text-caption font-mono text-text-subtle bg-surface-2/40 hover:bg-surface-2 hover:text-text-muted transition-colors duration-fast border-y border-border"
      title="点击展开未变更的行"
    >
      ⋯ 折叠 {count} 行未变更 · L{startLine}
    </button>
  );
}

function DiffRow({
  line,
  lineNum,
  rowBg,
  gutterPill,
  textColor,
}: {
  line: DiffLine | null;
  lineNum: number;
  rowBg: (k: DiffLine["kind"]) => string;
  gutterPill: (k: DiffLine["kind"]) => { sign: string; cls: string };
  textColor: (k: DiffLine["kind"]) => string;
}) {
  if (!line) {
    return <div className="px-3 py-0.5 whitespace-pre">&nbsp;</div>;
  }
  const pill = gutterPill(line.kind);
  return (
    <div
      className={`flex items-start gap-2 px-2 py-0.5 whitespace-pre ${rowBg(line.kind)}`}
    >
      <span className="select-none w-8 pr-1 text-right tabular-nums text-text-subtle">
        {lineNum}
      </span>
      <span
        className={`inline-flex h-[1.25em] w-4 shrink-0 items-center justify-center rounded-sm font-mono font-bold ${pill.cls}`}
        aria-hidden
      >
        {pill.sign}
      </span>
      <span className={`min-w-0 ${textColor(line.kind)}`}>{line.text || " "}</span>
    </div>
  );
}

function Header({
  filename,
  language,
  additions,
  deletions,
  mode,
  onMode,
  before,
  after,
}: {
  filename?: string;
  language?: string;
  additions: number;
  deletions: number;
  mode: ViewMode;
  onMode: (m: ViewMode) => void;
  before: string;
  after: string;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-border bg-surface-2/60 px-3 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {filename && (
          <span className="truncate text-caption font-mono text-text">{filename}</span>
        )}
        {language && (
          <span className="text-caption font-mono uppercase tracking-wider text-text-muted">
            {language}
          </span>
        )}
        <span className="ml-1 inline-flex items-center gap-2 text-caption font-mono tabular-nums">
          <span className="text-success">+{additions}</span>
          <span className="text-danger">-{deletions}</span>
        </span>
      </div>
      <SegmentedControl<ViewMode>
        value={mode}
        onChange={onMode}
        options={[
          { key: "unified", label: "Unified" },
          { key: "split", label: "Split" },
        ]}
      />
      {/* Tooltip is descriptive Chinese; visible chip text uses the
          conventional Before / After labels developers already recognize
          from GitHub diffs — cleaner than awkward 旧版/新版 or 原/改. */}
      <CopyButton value={before} label="复制 Before" short="Before" variant="button" />
      <CopyButton value={after} label="复制 After" short="After" variant="button" />
    </div>
  );
}
