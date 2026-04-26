#!/usr/bin/env node
/**
 * Find catalog keys that are never referenced from app/ + components/ + lib/.
 *
 * Pairs source-side `useTranslations("ns")` with each `t("subkey")` /
 * `` t(`prefix.${var}`) `` call and computes the set of (ns.subkey)
 * combinations actually used. Anything in the catalog that doesn't
 * appear here (literal nor template prefix) is flagged as dead.
 *
 * Heuristic — does NOT understand props-passed namespaces or computed
 * keys, so a small false-positive rate is expected. Use as a hint, not
 * an autodelete signal.
 *
 * Run:
 *     node web/scripts/audit-i18n-dead-keys.mjs           # summary
 *     node web/scripts/audit-i18n-dead-keys.mjs --list    # also print first 100
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(HERE, "..");
const MSG = join(WEB, "i18n", "messages");

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    const s = statSync(f);
    if (s.isDirectory()) {
      if (e === "node_modules" || e === "__tests__") continue;
      out.push(...walk(f));
    } else if (/\.(tsx?|mts)$/.test(e) && !/\.test\./.test(e)) {
      out.push(f);
    }
  }
  return out;
}

function loadCatalog() {
  const keys = new Set();
  function visit(o, p) {
    if (o && typeof o === "object" && !Array.isArray(o)) {
      for (const [k, v] of Object.entries(o)) {
        const next = [...p, k];
        if (typeof v === "string" || Array.isArray(v)) keys.add(next.join("."));
        else visit(v, next);
      }
    }
  }
  for (const f of [join(MSG, "zh-CN.json"), join(MSG, "en.json")]) {
    visit(JSON.parse(readFileSync(f, "utf8")), []);
  }
  for (const sub of ["zh-CN", "en"]) {
    const d = join(MSG, sub);
    try {
      for (const f of readdirSync(d)) {
        if (f.endsWith(".json")) visit(JSON.parse(readFileSync(join(d, f), "utf8")), []);
      }
    } catch {
      /* no per-namespace dir */
    }
  }
  return keys;
}

const cat = loadCatalog();
const used = new Set();
const usedPrefixes = new Set();
// Namespaces where the binding is called with a *variable* (e.g. `badgeT(b)`)
// — we can't know which sub-key is referenced, so treat the whole namespace
// as live-by-association.
const usedRuntimeNs = new Set();
const declRe = /\b(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*"([^"]+)"\s*\)/g;

for (const dir of ["app", "components", "lib"]) {
  for (const f of walk(join(WEB, dir))) {
    const src = readFileSync(f, "utf8");
    declRe.lastIndex = 0;
    const decls = [];
    let m;
    while ((m = declRe.exec(src))) decls.push({ name: m[1], ns: m[2] });
    for (const d of decls) {
      const litRe = new RegExp(`\\b${d.name}(?:\\.(?:rich|raw|has))?\\(\\s*"([a-zA-Z0-9_.]+)"`, "g");
      const tplRe = new RegExp(`\\b${d.name}(?:\\.(?:rich|raw|has))?\\(\\s*\`([a-zA-Z0-9_.]+)\\.\\$\\{`, "g");
      // Variable-argument call: anything that isn't a quoted string literal.
      // - `name(varName)` / `name(table[expr])` / `name(\`${var}.suffix\`)`
      //   all count as "runtime — namespace fully alive".
      // First char after `(` must be NEITHER " NOR ' (those have the static
      // regexes above). Backticks count IF their first inner char is `$`
      // (i.e. starts with `${`, no static prefix to verify against catalog).
      const varRe = new RegExp(`\\b${d.name}(?:\\.(?:rich|raw|has))?\\(\\s*(?:[^"'\`)\\s]|\`\\$)`, "g");
      let mm;
      while ((mm = litRe.exec(src))) used.add(`${d.ns}.${mm[1]}`);
      while ((mm = tplRe.exec(src))) usedPrefixes.add(`${d.ns}.${mm[1]}`);
      while ((mm = varRe.exec(src))) usedRuntimeNs.add(d.ns);
    }
  }
}

const dead = [];
for (const k of cat) {
  if (used.has(k)) continue;
  let live = false;
  const parts = k.split(".");
  for (let i = 1; i < parts.length; i++) {
    const prefix = parts.slice(0, i).join(".");
    if (usedPrefixes.has(prefix) || usedRuntimeNs.has(prefix)) {
      live = true;
      break;
    }
  }
  if (!live) dead.push(k);
}
dead.sort();

console.log(`catalog keys: ${cat.size}`);
console.log(`live (literal): ${used.size}`);
console.log(`live (template prefix): ${usedPrefixes.size}`);
console.log(`live (runtime-arg ns): ${usedRuntimeNs.size}`);
console.log(`possibly dead: ${dead.length} (${(dead.length / cat.size * 100).toFixed(1)}%)`);
if (process.argv.includes("--list")) {
  for (const k of dead.slice(0, 100)) console.log("  ", k);
  if (dead.length > 100) console.log(`  …(+${dead.length - 100} more)`);
}
