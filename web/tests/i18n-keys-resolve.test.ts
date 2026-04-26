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
        // String + array (e.g. messages used via t.raw) both terminate as
        // a real catalog entry — only walk into nested objects.
        if (typeof v === "string" || Array.isArray(v)) {
          keys.add(next.join("."));
        } else {
          visit(v, next);
        }
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

type Call = { ns: string; key: string; line: number; kind: "literal" | "prefix" };

function extractFromFile(file: string): Call[] {
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  const out: Call[] = [];
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
  // For each t-name, locate calls (string-literal and template-prefix).
  const seen = new Set<string>();
  for (const d of decls) {
    // Allow `name(` and method-style `name.rich(` / `name.raw(` / `name.has(`.
    const callPrefix = `\\b${d.name}(?:\\.(?:rich|raw|has))?`;
    // (1) Static string literal:    name("a.b.c"
    const litRe = new RegExp(`${callPrefix}\\(\\s*"([a-zA-Z0-9_.]+)"`, "g");
    // (2) Template-literal prefix:   name(`a.b.${var}…`)
    //   Capture the leading static prefix up to the first ${ — we'll
    //   verify the catalog has at least one key matching `${ns}.${prefix}.*`.
    const tplRe = new RegExp(
      `${callPrefix}\\(\\s*\`([a-zA-Z0-9_.]+)\\.\\$\\{`,
      "g",
    );
    for (let i = 0; i < lines.length; i++) {
      const callLine = i + 1;
      const candidates = decls.filter((c) => c.name === d.name && c.line <= callLine);
      if (candidates.length === 0 || candidates[candidates.length - 1]! !== d) continue;
      litRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = litRe.exec(lines[i]!))) {
        const id = `${file}:${callLine}:lit:${d.ns}.${m[1]!}`;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({ ns: d.ns, key: m[1]!, line: callLine, kind: "literal" });
      }
      tplRe.lastIndex = 0;
      while ((m = tplRe.exec(lines[i]!))) {
        const id = `${file}:${callLine}:tpl:${d.ns}.${m[1]!}`;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({ ns: d.ns, key: m[1]!, line: callLine, kind: "prefix" });
      }
    }
  }
  return out;
}

describe("i18n · every t() call resolves to a real catalog key", () => {
  it("scans app/ + components/ + lib/ for unresolved t-keys", () => {
    const catalog = loadCatalogKeys();
    const offences: { file: string; line: number; full: string }[] = [];
    // Pre-compute prefix set: for each catalog key "a.b.c", record every
    // sub-prefix ("a", "a.b") so prefix-style lookups can verify cheaply.
    const prefixes = new Set<string>();
    for (const k of catalog) {
      const parts = k.split(".");
      for (let i = 1; i < parts.length; i++) {
        prefixes.add(parts.slice(0, i).join("."));
      }
    }
    for (const dir of ["app", "components", "lib"]) {
      const root = join(ROOT, dir);
      for (const file of walk(root)) {
        for (const { ns, key, line, kind } of extractFromFile(file)) {
          const full = `${ns}.${key}`;
          const ok = kind === "literal" ? catalog.has(full) : prefixes.has(full);
          if (!ok) {
            offences.push({
              file: file.slice(ROOT.length + 1),
              line,
              full: kind === "prefix" ? `${full}.* (template prefix)` : full,
            });
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
