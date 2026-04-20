/**
 * First-run persistence (I-0014 · 2026-04-18-visual-upgrade §5.2).
 *
 * localStorage-backed flags keyed by `coachmark:seen:<id>` + a generic
 * `first-run:<scope>` namespace. Helpers are SSR-safe — `typeof window`
 * guards let them run during Next.js server render without throwing.
 *
 * We deliberately keep the store opinion-light: no event bus, no React
 * context. Components read-through on mount and write-back on dismiss.
 */

const COACHMARK_PREFIX = "coachmark:seen:";
const FIRST_RUN_PREFIX = "first-run:";

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // SecurityError in private mode / disabled storage. Treat as "never seen"
    // — the coachmark will just keep showing on that client, which is
    // acceptable fallback behavior.
    return null;
  }
}

export function hasSeenCoachmark(id: string): boolean {
  const s = storage();
  if (!s) return false;
  return s.getItem(COACHMARK_PREFIX + id) === "1";
}

export function markCoachmarkSeen(id: string): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(COACHMARK_PREFIX + id, "1");
  } catch {
    /* quota / denied — degrade to "keeps showing" */
  }
}

export function resetCoachmark(id: string): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(COACHMARK_PREFIX + id);
  } catch {
    /* ignore */
  }
}

export function hasCompletedFirstRun(scope: string): boolean {
  const s = storage();
  if (!s) return false;
  return s.getItem(FIRST_RUN_PREFIX + scope) === "1";
}

export function markFirstRunCompleted(scope: string): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(FIRST_RUN_PREFIX + scope, "1");
  } catch {
    /* ignore */
  }
}
