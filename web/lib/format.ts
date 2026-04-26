/**
 * Shared display formatters · single source of truth.
 *
 * Why this file exists: token / byte / duration formatting was duplicated
 * across UsageChip, RunHeader, KpiBar, RunArtifacts, ModelTestDialog with
 * subtle divergence (some "1,234", others "1.2k", others "0.0k"). One
 * canonical impl per concept keeps the product visually coherent — a
 * 28k-token reply should render identically wherever it appears.
 *
 * Conventions chosen:
 *   - tokens / counts: "1.2k" / "1.2M" with one decimal; under 1000 → raw int
 *   - bytes: "1.2 KB" / "1.2 MB" / "1.2 GB" with a space (Linear/Notion style)
 *   - duration: under 1s → "320ms"; under 60s → "1.2s"; under 1h → "2m 30s"
 *
 * No locale awareness on purpose — the UI is bilingual via next-intl, but
 * the numeric formats themselves are universal. Relative-time strings are
 * locale-aware and live in the i18n catalog (see common.relativeTime),
 * formatted by callers via useTranslations + Intl.RelativeTimeFormat.
 */

export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0 B";
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const minutes = Math.floor(s / 60);
  const remainder = Math.round(s - minutes * 60);
  return `${minutes}m ${remainder}s`;
}

