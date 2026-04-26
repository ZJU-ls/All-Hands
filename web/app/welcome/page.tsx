"use client";

/**
 * /welcome · first-run hero greeting.
 *
 * Visual vocabulary inherited from /design-lab (ADR 0016 · Brand Blue Dual
 * Theme): massive gradient h1, mesh-gradient + masked grid backdrop,
 * floating accent orbs, eyebrow chip with pulse dot, miniature workspace
 * preview, and pill highlight cards. Tokens-only colours, no `dark:`
 * variants — the theme pack handles light/dark via CSS variables.
 */

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Icon, type IconName } from "@/components/ui/icon";
import { AllhandsLogo, AllhandsWordmark } from "@/components/brand/AllhandsLogo";
import { WorkspacePreview } from "@/components/welcome/WorkspacePreview";
import { CountUp, Tilt } from "@/components/welcome/effects";
import { markFirstRunCompleted } from "@/lib/first-run";
import { useDocumentTitle } from "@/lib/use-document-title";

export const FIRST_RUN_SCOPE = "welcome";

type HighlightKey = "h1" | "h2" | "h3";
const HIGHLIGHT_ICONS: Record<HighlightKey, IconName> = {
  h1: "sparkles",
  h2: "users",
  h3: "shield-check",
};
const HIGHLIGHT_KEYS: HighlightKey[] = ["h1", "h2", "h3"];

const STAT_DEFS: { value: number | string; labelKey: "layers" | "principles" | "tools" }[] = [
  { value: 10, labelKey: "layers" },
  { value: 8, labelKey: "principles" },
  { value: "∞", labelKey: "tools" },
];

export default function WelcomePage() {
  const router = useRouter();
  const t = useTranslations("welcome");
  const tStats = useTranslations("welcome.stats");
  const tH = useTranslations("welcome.highlights");
  useDocumentTitle(t("docTitle"));

  const handleStart = useCallback(() => {
    markFirstRunCompleted(FIRST_RUN_SCOPE);
    router.replace("/chat");
  }, [router]);

  const handleSkip = useCallback(() => {
    markFirstRunCompleted(FIRST_RUN_SCOPE);
    router.replace("/");
  }, [router]);

  return (
    <main
      data-testid="welcome-page"
      className="relative h-screen w-full overflow-x-hidden overflow-y-auto bg-bg"
    >
      {/* ─── Mesh-gradient backdrop · radial blobs in light + dark via tokens. ─── */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(900px 540px at 18% -10%, var(--color-primary-soft) 0%, transparent 55%)," +
            "radial-gradient(720px 460px at 90% 5%, var(--color-primary-muted) 0%, transparent 60%)," +
            "radial-gradient(700px 500px at 50% 110%, color-mix(in srgb, var(--color-accent) 30%, transparent) 0%, transparent 70%)",
        }}
      />
      {/* ─── Masked grid backdrop · fades out at edges, no hard lines on the page chrome. ─── */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          backgroundImage:
            "linear-gradient(var(--color-border) 1px, transparent 1px), linear-gradient(90deg, var(--color-border) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
          opacity: 0.18,
          maskImage:
            "radial-gradient(ellipse 80% 70% at 50% 0%, #000 0%, rgba(0,0,0,0.4) 60%, transparent 100%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 80% 70% at 50% 0%, #000 0%, rgba(0,0,0,0.4) 60%, transparent 100%)",
        }}
      />
      {/* ─── Floating orbs · CSS keyframes only (§3.8 #5). ─── */}
      <div
        aria-hidden
        className="pointer-events-none fixed -top-10 left-[8%] h-56 w-56 animate-float rounded-full opacity-50 blur-3xl"
        style={{ background: "var(--color-accent)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed bottom-12 right-[10%] h-72 w-72 animate-float rounded-full opacity-40 blur-3xl"
        style={{
          background: "var(--color-primary-glow)",
          animationDelay: "2s",
        }}
      />

      {/* ─── Top-right skip · low-emphasis but always reachable. ─── */}
      <div className="relative z-10 flex items-center justify-between px-6 pt-6 sm:px-10">
        <div className="inline-flex items-center gap-2.5">
          <AllhandsLogo size={36} className="shadow-glow-sm rounded-lg" />
          <AllhandsWordmark size={16} />
        </div>
        <button
          type="button"
          data-testid="welcome-skip"
          onClick={handleSkip}
          className="text-caption text-text-subtle transition-colors duration-fast hover:text-text-muted"
        >
          {t("skip")}
        </button>
      </div>

      <div className="relative mx-auto max-w-[1200px] px-6 pb-20 pt-12 sm:px-10 sm:pt-16">
        {/* ─── Hero · two-col on lg · text left, brand mark right ─── */}
        <section className="grid animate-fade-up items-center gap-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16">
          <div>
            {/* Eyebrow chip · live-pulse dot */}
            <div className="inline-flex h-7 items-center gap-2 rounded-full border border-border bg-surface px-3 shadow-soft-sm">
              <span className="relative h-2 w-2">
                <span className="absolute inset-0 animate-pulse-soft rounded-full bg-primary opacity-60" />
                <span className="absolute inset-0 rounded-full bg-primary" />
              </span>
              <span className="text-caption font-mono uppercase tracking-wider text-text-muted">
                {t("eyebrow")}
              </span>
            </div>

            {/* Massive h1 · gradient on the second line */}
            <h1 className="mt-7 text-[44px] font-bold leading-[0.98] tracking-[-0.04em] text-text sm:text-[60px] lg:text-[72px]">
              {t("h1Line1")}
              <br />
              <span className="bg-gradient-to-r from-primary via-accent to-primary-glow bg-clip-text text-transparent">
                {t("h1Line2")}
              </span>
            </h1>

            {/* Subtitle */}
            <p className="mt-7 max-w-2xl text-lg leading-relaxed text-text-muted">
              {t("subtitle")}
            </p>

            {/* CTAs */}
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <button
                type="button"
                data-testid="welcome-start"
                onClick={handleStart}
                className="group inline-flex h-12 items-center gap-2 rounded-xl bg-gradient-to-r from-primary via-primary-glow to-accent px-6 text-base font-semibold text-primary-fg shadow-glow transition-transform duration-base hover:-translate-y-px"
              >
                <Icon name="sparkles" size={16} />
                {t("getStarted")}
                <Icon
                  name="arrow-right"
                  size={16}
                  className="transition-transform duration-base group-hover:translate-x-0.5"
                />
              </button>
              <Link
                href="/design-lab"
                className="inline-flex h-12 items-center gap-2 rounded-xl border border-border-strong bg-surface px-6 text-base font-medium text-text shadow-soft-sm transition-colors duration-fast hover:bg-surface-2"
              >
                <Icon name="layout-grid" size={16} className="text-primary" />
                {t("browseDesignSystem")}
              </Link>
            </div>

            {/* Mini stat strip · numbers count up on first paint */}
            <div className="mt-12 flex flex-wrap items-center gap-x-8 gap-y-3">
              {STAT_DEFS.map((s, i) => (
                <div key={s.labelKey} className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold tracking-tight text-text tabular-nums">
                    {typeof s.value === "number" ? (
                      <CountUp value={s.value} />
                    ) : (
                      s.value
                    )}
                  </span>
                  <span className="text-caption text-text-muted">{tStats(s.labelKey)}</span>
                  {i < STAT_DEFS.length - 1 ? (
                    <span aria-hidden className="ml-2 text-text-subtle">
                      ·
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          {/* Brand mark column · click to replay the fold-in animation. */}
          <div className="hidden lg:block">
            <ReplayableHeroLogo />
          </div>
        </section>

        {/* ─── Workspace preview · auto-cycles + 3D mouse-tilt. ─── */}
        <section
          className="relative mt-16 animate-fade-up"
          style={{ animationDelay: "120ms" }}
        >
          <Tilt>
            <WorkspacePreview />
          </Tilt>
        </section>

        {/* ─── Highlights ─── */}
        <section
          className="mt-20 animate-fade-up"
          style={{ animationDelay: "200ms" }}
        >
          <div className="mb-8 flex items-end justify-between gap-6">
            <div className="space-y-2">
              <div className="text-caption font-mono uppercase tracking-[0.16em] text-primary">
                {t("highlightsEyebrow")}
              </div>
              <h2 className="max-w-xl text-2xl font-semibold tracking-tight text-text sm:text-3xl">
                {t("highlightsHeading")}
              </h2>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {HIGHLIGHT_KEYS.map((key) => (
              <article
                key={key}
                className="group relative overflow-hidden rounded-2xl border border-border bg-surface p-6 shadow-soft-sm transition-colors duration-base hover:border-border-strong hover:bg-surface-2"
              >
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent opacity-0 transition-opacity duration-base group-hover:opacity-100"
                />
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary-muted text-primary">
                    <Icon name={HIGHLIGHT_ICONS[key]} size={18} />
                  </span>
                  <span className="text-caption font-mono uppercase tracking-wider text-text-subtle">
                    {tH(`${key}.eyebrow`)}
                  </span>
                </div>
                <h3 className="mt-5 text-lg font-semibold tracking-tight text-text">
                  {tH(`${key}.title`)}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-text-muted">
                  {tH(`${key}.body`)}
                </p>
                <ul className="mt-4 space-y-1.5">
                  {(["b1", "b2", "b3"] as const).map((b) => (
                    <li
                      key={b}
                      className="flex items-start gap-2 text-caption text-text-muted"
                    >
                      <Icon
                        name="check"
                        size={12}
                        className="mt-1 shrink-0 text-primary"
                      />
                      <span>{tH(`${key}.${b}`)}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        {/* ─── Footer CTA · "ready to start" reprise ─── */}
        <section
          className="mt-20 animate-fade-up"
          style={{ animationDelay: "280ms" }}
        >
          <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-surface to-accent/10 px-8 py-10 shadow-soft-lg">
            <div
              aria-hidden
              className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 animate-float rounded-full opacity-40 blur-3xl"
              style={{ background: "var(--color-primary-glow)" }}
            />
            <div className="relative flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
              <div className="space-y-2">
                <h3 className="text-2xl font-semibold tracking-tight text-text">
                  {t("ctaHeading")}
                </h3>
                <p className="text-sm text-text-muted">
                  {t("ctaBody")}
                </p>
              </div>
              <button
                type="button"
                onClick={handleStart}
                className="group inline-flex h-12 items-center gap-2 rounded-xl bg-gradient-to-r from-primary via-primary-glow to-accent px-6 text-base font-semibold text-primary-fg shadow-glow transition-transform duration-base hover:-translate-y-px"
              >
                {t("ctaButton")}
                <Icon
                  name="arrow-right"
                  size={16}
                  className="transition-transform duration-base group-hover:translate-x-0.5"
                />
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

/**
 * Hero brand mark · click anywhere on the tile to replay the origami
 * fold-in animation. Cursor-pointer + a soft halo + a tiny "click to
 * replay" hint chip make the interaction discoverable without screaming.
 */
function ReplayableHeroLogo() {
  const tReplay = useTranslations("welcome.replay");
  const [playKey, setPlayKey] = useState(0);
  return (
    <div className="relative flex flex-col items-center gap-3">
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-10 rounded-[40px] bg-primary-glow/25 blur-3xl"
      />
      <button
        type="button"
        onClick={() => setPlayKey((k) => k + 1)}
        title={tReplay("title")}
        aria-label={tReplay("aria")}
        className="group relative cursor-pointer rounded-2xl transition-transform duration-base hover:-translate-y-0.5"
      >
        <AllhandsLogo
          key={playKey}
          size={168}
          animateIn
          className="rounded-2xl shadow-glow-lg"
        />
      </button>
      <span className="relative inline-flex items-center gap-1.5 text-caption text-text-subtle">
        <Icon name="refresh" size={11} />
        {tReplay("hint")}
      </span>
    </div>
  );
}
