/**
 * Regression net · every `t("foo.bar")` call site in source must resolve
 * to a real catalog key under the namespace declared by its enclosing
 * `useTranslations("ns")` / `getTranslations("ns")` call.
 *
 * Caught by this test in practice:
 *   - `t("neverSynced")` from `useTranslations("mcp.list")` when the
 *     real key is `mcp.list.kpi.neverSynced`.
 *
 * Heuristic — does NOT understand React component composition. We only
 * check `t("literal-key", …)` calls that appear in the SAME function as
 * a `useTranslations("namespace")` line. False positives are silenced
 * by the static-key restriction (only string literals, no template
 * literals or computed keys).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === "__tests__") continue;
      yield* walk(full);
    } else if (stat.isFile() && /\.tsx?$/.test(entry) && !/\.test\./.test(entry)) {
      yield full;
    }
  }
}

function loadCatalogKeys(): Set<string> {
  const keys = new Set<string>();
  const visit = (obj: unknown, path: string[]) => {
    if (obj && typeof obj === "object") {
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        const next = [...path, k];
        if (typeof v === "string") keys.add(next.join("."));
        else visit(v, next);
      }
    }
  };
  const merge = (...files: string[]) => {
    for (const f of files) {
      try {
        const j = JSON.parse(readFileSync(f, "utf8")) as unknown;
        visit(j, []);
      } catch {
        /* missing namespace file — ignore */
      }
    }
  };
  // Root + namespace files merged the same way request.ts does.
  for (const locale of ["zh-CN", "en"]) {
    const base = join(ROOT, "i18n", "messages");
    merge(join(base, `${locale}.json`));
    const dir = join(base, locale);
    try {
      for (const f of readdirSync(dir)) {
        if (f.endsWith(".json")) merge(join(dir, f));
      }
    } catch {
      /* no per-namespace dir */
    }
  }
  return keys;
}

function extractFromFile(file: string): { ns: string; key: string; line: number }[] {
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  const out: { ns: string; key: string; line: number }[] = [];
  // Track the most recent `useTranslations("ns")` / `getTranslations("ns")`
  // declaration's namespace, scoped per function block. We don't parse
  // braces — we just associate each t(...) call with the nearest preceding
  // useTranslations literal. This is a heuristic but matches the codebase's
  // pattern (one t per function scope).
  // To reduce false positives, we map each t() call to the closest
  // preceding useTranslations within ~80 lines.
  type Decl = { name: string; ns: string; line: number };
  const decls: Decl[] = [];
  const declRe = /\b(?:const|let|var)\s+(\w+)\s*=\s*(?:useTranslations|getTranslations)\(\s*"([^"]+)"\s*\)/g;
  for (let i = 0; i < lines.length; i++) {
    declRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = declRe.exec(lines[i]!))) {
      decls.push({ name: m[1]!, ns: m[2]!, line: i + 1 });
    }
  }
  if (decls.length === 0) return out;
  // For each t-name, locate calls.
  const seen = new Set<string>();
  for (const d of decls) {
    const re = new RegExp(`\\b${d.name}\\(\\s*"([a-zA-Z0-9_.]+)"`, "g");
    for (let i = 0; i < lines.length; i++) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(lines[i]!))) {
        // Only trust this binding if it's the closest preceding decl with
        // this name (handles shadowing across functions).
        const callLine = i + 1;
        const candidates = decls.filter((c) => c.name === d.name && c.line <= callLine);
        if (candidates.length === 0) continue;
        const closest = candidates[candidates.length - 1]!;
        if (closest !== d) continue;
        const id = `${file}:${callLine}:${d.ns}.${m[1]!}`;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({ ns: d.ns, key: m[1]!, line: callLine });
      }
    }
  }
  return out;
}

describe("i18n · every t() call resolves to a real catalog key", () => {
  it("scans app/ + components/ + lib/ for unresolved t-keys", () => {
    const catalog = loadCatalogKeys();
    const offences: { file: string; line: number; full: string }[] = [];
    for (const dir of ["app", "components", "lib"]) {
      const root = join(ROOT, dir);
      for (const file of walk(root)) {
        for (const { ns, key, line } of extractFromFile(file)) {
          const full = `${ns}.${key}`;
          if (!catalog.has(full)) {
            offences.push({ file: file.slice(ROOT.length + 1), line, full });
          }
        }
      }
    }
    if (offences.length > 0) {
      const lines = offences.map((o) => `  ${o.file}:${o.line}  ${o.full}`).join("\n");
      throw new Error(
        `Found ${offences.length} t() call(s) referencing missing catalog key — add the key or fix the namespace:\n${lines}`,
      );
    }
    expect(offences).toEqual([]);
  });
});
