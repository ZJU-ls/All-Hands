"use client";

import { useMemo } from "react";
import type { RenderProps } from "@/lib/component-registry";

type DiffLine = { kind: "context" | "add" | "del"; text: string };

/**
 * Minimal LCS-based line diff. Good enough for review-sized diffs (< 500 lines).
 * For larger diffs, the agent should produce an artifact and link to it.
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

export function Diff({ props }: RenderProps) {
  const before = (props.before as string | undefined) ?? "";
  const after = (props.after as string | undefined) ?? "";
  const mode = (props.mode as string | undefined) ?? "unified";
  const filename = props.filename as string | undefined;
  const language = props.language as string | undefined;

  const lines = useMemo(() => computeDiff(before, after), [before, after]);

  const stats = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const line of lines) {
      if (line.kind === "add") additions++;
      if (line.kind === "del") deletions++;
    }
    return { additions, deletions };
  }, [lines]);

  function signFor(kind: DiffLine["kind"]): string {
    if (kind === "add") return "+";
    if (kind === "del") return "-";
    return " ";
  }
  function bgFor(kind: DiffLine["kind"]): string {
    if (kind === "add") return "bg-success/10";
    if (kind === "del") return "bg-danger/10";
    return "";
  }
  function textFor(kind: DiffLine["kind"]): string {
    if (kind === "add") return "text-success";
    if (kind === "del") return "text-danger";
    return "text-text";
  }

  if (mode === "split") {
    // Build aligned before/after columns: render two columns from the diff
    // where add lines only appear right and del lines only appear left.
    const left: (DiffLine | null)[] = [];
    const right: (DiffLine | null)[] = [];
    for (const line of lines) {
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
      <div className="rounded-lg border border-border bg-bg overflow-hidden">
        <Header
          filename={filename}
          language={language}
          additions={stats.additions}
          deletions={stats.deletions}
        />
        <div className="grid grid-cols-2 text-xs font-mono leading-relaxed">
          <div className="border-r border-border">
            {left.map((line, i) => (
              <div
                key={i}
                className={`px-3 py-0.5 whitespace-pre ${line ? bgFor(line.kind) : ""} ${line ? textFor(line.kind) : ""}`}
              >
                {line ? `${signFor(line.kind)} ${line.text || " "}` : "\u00A0"}
              </div>
            ))}
          </div>
          <div>
            {right.map((line, i) => (
              <div
                key={i}
                className={`px-3 py-0.5 whitespace-pre ${line ? bgFor(line.kind) : ""} ${line ? textFor(line.kind) : ""}`}
              >
                {line ? `${signFor(line.kind)} ${line.text || " "}` : "\u00A0"}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-bg overflow-hidden">
      <Header
        filename={filename}
        language={language}
        additions={stats.additions}
        deletions={stats.deletions}
      />
      <pre className="overflow-x-auto text-xs font-mono leading-relaxed py-1">
        {lines.map((line, i) => (
          <div
            key={i}
            className={`px-3 whitespace-pre ${bgFor(line.kind)} ${textFor(line.kind)}`}
          >
            {signFor(line.kind)} {line.text || " "}
          </div>
        ))}
      </pre>
    </div>
  );
}

function Header({
  filename,
  language,
  additions,
  deletions,
}: {
  filename?: string;
  language?: string;
  additions: number;
  deletions: number;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
      <div className="flex items-center gap-2 min-w-0">
        {filename && (
          <span className="text-xs font-mono text-text truncate">{filename}</span>
        )}
        {language && (
          <span className="text-xs font-mono text-text-muted">{language}</span>
        )}
      </div>
      <div className="flex items-center gap-2 text-xs font-mono">
        <span className="text-success">+{additions}</span>
        <span className="text-danger">-{deletions}</span>
      </div>
    </div>
  );
}
