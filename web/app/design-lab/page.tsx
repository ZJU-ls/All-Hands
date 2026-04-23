"use client";

/**
 * allhands · /design-lab
 *
 * Living sample of the Brand Blue Dual Theme contract (ADR 0016 · 2026-04-23).
 * This page supersedes the previous Linear-Precise lab — it exercises every
 * token class, the <Icon> wrapper, and the light/dark theme switch in one
 * place so reviewers can diff the spec against the rendered reality.
 *
 * Rules when touching this file:
 *   - Colours: Tailwind token classes only (bg-surface, text-primary, …);
 *     never hex, never bg-blue-*, never dark: variants (theme pack handles it).
 *   - Icons: <Icon name="…" /> only. No direct lucide-react imports.
 *   - Motion: CSS/Tailwind keyframes only (animate-fade-up, animate-float, …);
 *     hover:-translate-y-px is fine, hover:scale-* is not.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import { useTheme } from "@/components/theme/ThemeProvider";
import { Icon, availableIconNames, type IconName } from "@/components/ui/icon";

// ─────────────────────────────────────────────────────────────────────────────
// Shared primitives (local to the lab — real components live under /components)
// ─────────────────────────────────────────────────────────────────────────────

function SectionHeading({
  eyebrow,
  title,
  caption,
}: {
  eyebrow: string;
  title: string;
  caption?: string;
}) {
  return (
    <header className="mb-8 space-y-2">
      <div className="text-caption font-mono uppercase tracking-[0.16em] text-primary">
        {eyebrow}
      </div>
      <h2 className="text-xl font-semibold tracking-tight text-text">{title}</h2>
      {caption ? (
        <p className="max-w-3xl text-sm text-text-muted">{caption}</p>
      ) : null}
    </header>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-text-muted">
      {children}
    </h3>
  );
}

function Swatch({
  label,
  className,
  note,
}: {
  label: string;
  className: string;
  note?: string;
}) {
  return (
    <div className="group space-y-2">
      <div
        className={`h-16 rounded-lg border border-border transition duration-base ${className}`}
      />
      <div className="space-y-0.5">
        <div className="text-caption font-mono text-text">{label}</div>
        {note ? (
          <div className="text-caption text-text-subtle">{note}</div>
        ) : null}
      </div>
    </div>
  );
}

// Mini sparkline used in stat cards + demo tables.
function Spark({
  points,
  className = "text-primary",
}: {
  points: number[];
  className?: string;
}) {
  const width = 120;
  const height = 32;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = Math.max(1, max - min);
  const step = width / (points.length - 1);
  const coords = points
    .map((p, i) => `${i * step},${height - ((p - min) / span) * (height - 4) - 2}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={`w-full h-8 ${className}`}>
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={coords}
      />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function DesignLabPage() {
  const { theme, toggle } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Mock state for interactive pieces
  const [tabUnderline, setTabUnderline] = useState("overview");
  const [tabPill, setTabPill] = useState("chat");
  const [modalOpen, setModalOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(true);
  const [inputValue, setInputValue] = useState("lead-agent-v3");

  const themeIcon: IconName = mounted && theme === "dark" ? "sun" : "moon";

  return (
    <div className="h-screen overflow-y-auto bg-bg text-text font-sans antialiased">
      {/* ═══════════════════════════════════════════════════════════════════
          Header · sticky topbar with theme toggle
          ═══════════════════════════════════════════════════════════════════ */}
      <header className="sticky top-0 z-40 border-b border-border bg-bg/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-4 px-8">
          <a href="#home" className="flex items-center gap-2 text-text hover:text-primary transition duration-fast">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-fg shadow-glow-sm">
              <Icon name="zap" size={14} strokeWidth={2.25} />
            </span>
            <span className="text-sm font-semibold tracking-tight">allhands</span>
          </a>
          <span className="text-caption font-mono text-text-subtle">/ design-lab</span>

          <nav className="ml-6 hidden items-center gap-1 md:flex">
            {["Tokens", "Icons", "Components", "Patterns"].map((l) => (
              <a
                key={l}
                href={`#${l.toLowerCase()}`}
                className="rounded-md px-3 py-1.5 text-sm text-text-muted hover:bg-surface-2 hover:text-text transition duration-fast"
              >
                {l}
              </a>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <a
              href="https://github.com/allhands"
              className="hidden h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm text-text-muted hover:border-border-strong hover:text-text transition duration-fast sm:inline-flex"
            >
              <Icon name="code" size={14} /> Repo
            </a>
            <button
              type="button"
              onClick={toggle}
              aria-label="Toggle theme"
              className="grid h-9 w-9 place-items-center rounded-lg border border-border text-text-muted hover:border-border-strong hover:text-text transition duration-fast"
            >
              <Icon name={themeIcon} size={15} />
            </button>
            <a
              href="#home"
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-fg shadow-soft-sm hover:bg-primary-hover hover:shadow-glow-sm transition duration-fast"
            >
              <Icon name="arrow-left" size={14} /> Back
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-8 pb-24 pt-12 space-y-24">
        {/* ═════════════════════════════════════════════════════════════════
            Hero — V2-level landing (big h1 + gradient + social proof + preview)
            ═════════════════════════════════════════════════════════════════ */}
        <section className="relative overflow-hidden rounded-3xl border border-border bg-surface shadow-soft-lg animate-fade-up">
          {/* mesh gradient backdrop */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-80"
            style={{
              background:
                "radial-gradient(1000px 600px at 15% -10%, var(--color-primary-soft) 0%, transparent 55%), radial-gradient(800px 500px at 90% 5%, var(--color-primary-muted) 0%, transparent 60%), radial-gradient(700px 500px at 50% 120%, var(--color-accent) 0%, transparent 70%)",
            }}
          />
          {/* grid backdrop, masked to fade out at the edges */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(var(--color-border) 1px, transparent 1px), linear-gradient(90deg, var(--color-border) 1px, transparent 1px)",
              backgroundSize: "32px 32px",
              opacity: 0.22,
              maskImage:
                "radial-gradient(ellipse 80% 70% at 50% 0%, #000 0%, rgba(0,0,0,0.4) 60%, transparent 100%)",
              WebkitMaskImage:
                "radial-gradient(ellipse 80% 70% at 50% 0%, #000 0%, rgba(0,0,0,0.4) 60%, transparent 100%)",
            }}
          />

          <div className="relative px-10 pt-16 pb-10">
            {/* eyebrow */}
            <div className="inline-flex h-7 items-center gap-2 rounded-full border border-border bg-surface px-3 shadow-soft-sm">
              <span className="relative h-2 w-2">
                <span className="absolute inset-0 animate-pulse-soft rounded-full bg-primary opacity-60" />
                <span className="absolute inset-0 rounded-full bg-primary" />
              </span>
              <span className="text-caption font-mono uppercase tracking-wider text-text-muted">
                ADR 0016 · Brand Blue Dual Theme
              </span>
            </div>

            {/* massive h1 · gradient text */}
            <h1 className="mt-8 max-w-5xl text-[56px] font-bold leading-[0.95] tracking-[-0.045em] sm:text-[72px] lg:text-[84px]">
              Your digital workforce,
              <br />
              <span className="bg-gradient-to-r from-primary via-accent to-primary-glow bg-clip-text text-transparent">
                designed for craft.
              </span>
            </h1>

            {/* description */}
            <p className="mt-8 max-w-2xl text-lg leading-relaxed text-text-muted">
              Every token, every component, every motion primitive — rendered
              on one page. Flip the theme toggle to diff light vs dark; what
              you see here is exactly what ships to production.
            </p>

            {/* CTAs */}
            <div className="mt-10 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="inline-flex h-12 items-center gap-2 rounded-xl bg-primary px-6 text-base font-semibold text-primary-fg shadow-soft-lg transition duration-base hover:-translate-y-px hover:shadow-glow"
              >
                <Icon name="sparkles" size={16} /> Get started — it&rsquo;s free
                <Icon name="arrow-right" size={16} />
              </button>
              <button
                type="button"
                className="inline-flex h-12 items-center gap-2 rounded-xl border border-border-strong bg-surface px-6 text-base font-semibold text-text shadow-soft-sm transition duration-base hover:-translate-y-px hover:shadow-soft"
              >
                <Icon name="play-circle" size={16} className="text-primary" />{" "}
                Watch 2-min demo
              </button>
            </div>

            {/* social proof */}
            <div className="mt-12 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-text-muted">
              <div className="flex items-center gap-3">
                <div className="flex -space-x-2">
                  {[
                    { i: "SA", g: "linear-gradient(135deg,var(--color-primary),var(--color-primary-hover))" },
                    { i: "CM", g: "linear-gradient(135deg,var(--color-accent),var(--color-primary))" },
                    { i: "BF", g: "linear-gradient(135deg,var(--color-success),var(--color-accent))" },
                    { i: "OP", g: "linear-gradient(135deg,var(--color-warning),var(--color-danger))" },
                  ].map(({ i, g }) => (
                    <span
                      key={i}
                      className="grid h-7 w-7 place-items-center rounded-full border-2 border-surface text-caption font-semibold text-primary-fg"
                      style={{ background: g }}
                    >
                      {i}
                    </span>
                  ))}
                  <span className="grid h-7 w-7 place-items-center rounded-full border-2 border-surface bg-surface-2 text-caption font-mono text-text-subtle">
                    +2k
                  </span>
                </div>
                <span>
                  <span className="font-semibold text-text">2,481</span> teams
                  hiring on allhands
                </span>
              </div>
              <span className="text-text-subtle">·</span>
              <div className="flex items-center gap-2">
                <span className="tracking-widest text-warning">★★★★★</span>
                <span>
                  <span className="font-semibold text-text">4.9</span> on
                  ProductHunt
                </span>
              </div>
            </div>
          </div>

          {/* floating product preview */}
          <div className="relative px-10 pb-14">
            <div
              aria-hidden
              className="pointer-events-none absolute -top-6 left-16 h-40 w-40 animate-float rounded-full opacity-40 blur-3xl"
              style={{ background: "var(--color-accent)" }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute -bottom-2 right-16 h-48 w-48 animate-float rounded-full opacity-30 blur-3xl"
              style={{
                background: "var(--color-primary-glow)",
                animationDelay: "2s",
              }}
            />

            <div className="relative overflow-hidden rounded-2xl border border-border bg-surface shadow-soft-lg">
              {/* browser chrome */}
              <div className="flex h-10 items-center gap-2 border-b border-border bg-surface-2/60 px-4">
                <span className="h-3 w-3 rounded-full bg-danger/70" />
                <span className="h-3 w-3 rounded-full bg-warning/70" />
                <span className="h-3 w-3 rounded-full bg-success/70" />
                <span className="ml-3 text-caption font-mono text-text-muted">
                  allhands.app / dashboard
                </span>
              </div>

              <div className="grid grid-cols-12">
                {/* mini sidebar */}
                <aside className="col-span-3 space-y-1 border-r border-border bg-surface-2/40 p-5">
                  <div className="relative flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-primary-fg shadow-soft-sm">
                    <Icon name="users" size={14} />
                    <span className="text-sm font-medium">Employees</span>
                    <span className="ml-auto rounded bg-primary-fg/20 px-1.5 text-caption font-mono">
                      37
                    </span>
                  </div>
                  {(
                    [
                      { l: "Skills", i: "wand-2" },
                      { l: "Gateway", i: "plug" },
                      { l: "Traces", i: "activity" },
                      { l: "Market", i: "store" },
                    ] as { l: string; i: IconName }[]
                  ).map((x) => (
                    <div
                      key={x.l}
                      className="flex items-center gap-2 rounded-lg px-3 py-2 text-text-muted"
                    >
                      <Icon name={x.i} size={14} />
                      <span className="text-sm">{x.l}</span>
                    </div>
                  ))}
                </aside>

                {/* main preview */}
                <div className="col-span-9 p-6">
                  <div className="mb-5 flex items-center justify-between">
                    <h3 className="text-xl font-bold tracking-tight">
                      Good afternoon, Liu
                    </h3>
                    <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-success-soft px-2.5 text-caption font-medium text-success">
                      <span className="h-1.5 w-1.5 rounded-full bg-success" />{" "}
                      Autopilot on
                    </span>
                  </div>

                  <div className="grid grid-cols-4 gap-3">
                    {/* gradient primary hero stat */}
                    <div
                      className="relative overflow-hidden rounded-xl p-4 text-primary-fg"
                      style={{
                        background:
                          "linear-gradient(135deg,var(--color-primary) 0%, var(--color-primary-hover) 100%)",
                      }}
                    >
                      <div
                        aria-hidden
                        className="absolute -right-8 -top-8 h-24 w-24 rounded-full blur-2xl"
                        style={{
                          background: "var(--color-accent)",
                          opacity: 0.4,
                        }}
                      />
                      <div className="relative text-caption font-mono uppercase tracking-wider opacity-85">
                        Active
                      </div>
                      <div className="relative mt-2 text-xl font-bold">37</div>
                      <div className="relative mt-1 text-caption font-mono opacity-90">
                        ↑ 12% week
                      </div>
                    </div>
                    {[
                      { l: "Runs · 24h", v: "214", d: "↑ 8%", t: "text-success" },
                      { l: "Success", v: "99.1%", d: "stable", t: "text-text-muted" },
                      { l: "Cost · mo", v: "$412", d: "↑ 3%", t: "text-danger" },
                    ].map((s) => (
                      <div
                        key={s.l}
                        className="rounded-xl border border-border bg-surface-2 p-4"
                      >
                        <div className="text-caption font-mono uppercase tracking-wider text-text-muted">
                          {s.l}
                        </div>
                        <div className="mt-2 text-xl font-bold">{s.v}</div>
                        <div className={`mt-1 text-caption font-mono ${s.t}`}>
                          {s.d}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═════════════════════════════════════════════════════════════════
            § 1 · Tokens
            ═════════════════════════════════════════════════════════════════ */}
        <section id="tokens" className="animate-fade-up">
          <SectionHeading
            eyebrow="§ 1"
            title="Design tokens"
            caption="Every colour, size and shadow a feature component consumes. If a value below doesn't render, the pack is missing a variable — check web/styles/themes/brand-blue/."
          />

          {/* 1.1 Colour palette */}
          <div className="space-y-10">
            <div>
              <SubHeading>1.1 · Surfaces &amp; text</SubHeading>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
                <Swatch label="bg-bg" className="bg-bg" note="app backdrop" />
                <Swatch label="bg-surface" className="bg-surface" note="card default" />
                <Swatch label="bg-surface-2" className="bg-surface-2" note="raised" />
                <Swatch label="bg-surface-3" className="bg-surface-3" note="nested" />
                <Swatch label="bg-surface-4" className="bg-surface-4" note="strongest" />
                <Swatch label="bg-surface-hover" className="bg-surface-hover" note="hover" />
              </div>
            </div>

            <div>
              <SubHeading>1.2 · Primary &amp; accent</SubHeading>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
                <Swatch label="bg-primary" className="bg-primary" note="CTA fill" />
                <Swatch label="bg-primary-hover" className="bg-primary-hover" note="pressed" />
                <Swatch label="bg-primary-muted" className="bg-primary-muted" note="soft bg" />
                <Swatch label="bg-primary-soft" className="bg-primary-soft" note="tint" />
                <Swatch label="bg-accent" className="bg-accent" note="secondary" />
                <Swatch
                  label="text-primary-glow"
                  className="bg-primary-glow"
                  note="highlight"
                />
              </div>
            </div>

            <div>
              <SubHeading>1.3 · Semantics</SubHeading>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
                <Swatch label="bg-success" className="bg-success" />
                <Swatch label="bg-success-soft" className="bg-success-soft" />
                <Swatch label="bg-warning" className="bg-warning" />
                <Swatch label="bg-warning-soft" className="bg-warning-soft" />
                <Swatch label="bg-danger" className="bg-danger" />
                <Swatch label="bg-danger-soft" className="bg-danger-soft" />
              </div>
            </div>

            <div>
              <SubHeading>1.4 · Roles &amp; viz</SubHeading>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-5 lg:grid-cols-10">
                <Swatch label="role-user" className="bg-role-user" />
                <Swatch label="role-lead" className="bg-role-lead" />
                <Swatch label="role-worker" className="bg-role-worker" />
                <Swatch label="role-tool" className="bg-role-tool" />
                <Swatch label="viz-1" className="bg-viz-1" />
                <Swatch label="viz-2" className="bg-viz-2" />
                <Swatch label="viz-3" className="bg-viz-3" />
                <Swatch label="viz-4" className="bg-viz-4" />
                <Swatch label="viz-5" className="bg-viz-5" />
                <Swatch label="viz-6" className="bg-viz-6" />
              </div>
            </div>

            {/* 1.2 typography */}
            <div>
              <SubHeading>1.5 · Typography scale</SubHeading>
              <div className="space-y-3 rounded-xl border border-border bg-surface p-6 shadow-soft-sm">
                <div className="flex items-baseline gap-4">
                  <span className="w-24 text-caption font-mono text-text-subtle">display / 32</span>
                  <span className="text-display font-semibold tracking-tight">Digital employees, dispatched.</span>
                </div>
                <div className="flex items-baseline gap-4">
                  <span className="w-24 text-caption font-mono text-text-subtle">xl / 24</span>
                  <span className="text-xl font-semibold tracking-tight">Section heading that guides the eye</span>
                </div>
                <div className="flex items-baseline gap-4">
                  <span className="w-24 text-caption font-mono text-text-subtle">lg / 19</span>
                  <span className="text-lg text-text">Lead paragraph with a slightly relaxed line-height</span>
                </div>
                <div className="flex items-baseline gap-4">
                  <span className="w-24 text-caption font-mono text-text-subtle">base / 15</span>
                  <span className="text-base text-text">Body copy for everyday reading in the product.</span>
                </div>
                <div className="flex items-baseline gap-4">
                  <span className="w-24 text-caption font-mono text-text-subtle">sm / 13</span>
                  <span className="text-sm text-text-muted">Helper text, table cells, secondary UI.</span>
                </div>
                <div className="flex items-baseline gap-4">
                  <span className="w-24 text-caption font-mono text-text-subtle">caption / 12</span>
                  <span className="text-caption font-mono uppercase tracking-wider text-text-subtle">
                    mono.caption · timestamps · overline
                  </span>
                </div>
              </div>
            </div>

            {/* 1.3 radii */}
            <div>
              <SubHeading>1.6 · Radii</SubHeading>
              <div className="grid grid-cols-3 gap-4 md:grid-cols-7">
                {(["sm", "DEFAULT", "md", "lg", "xl", "2xl", "3xl"] as const).map((r) => {
                  const cls =
                    r === "DEFAULT" ? "rounded" : `rounded-${r}`;
                  return (
                    <div key={r} className="space-y-2 text-center">
                      <div
                        className={`h-16 border border-border-strong bg-surface-2 ${cls}`}
                      />
                      <div className="text-caption font-mono text-text-muted">
                        {r === "DEFAULT" ? "rounded" : cls}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 1.4 shadows */}
            <div>
              <SubHeading>1.7 · Shadows</SubHeading>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                {[
                  "shadow-soft-sm",
                  "shadow-soft",
                  "shadow-soft-lg",
                  "shadow-pop",
                  "shadow-glow-sm",
                  "shadow-glow",
                  "shadow-glow-lg",
                  "shadow-inset-hairline",
                ].map((s) => (
                  <div
                    key={s}
                    className={`flex h-24 items-center justify-center rounded-xl border border-border bg-surface text-caption font-mono text-text-muted ${s}`}
                  >
                    {s}
                  </div>
                ))}
              </div>
            </div>

            {/* 1.5 motion */}
            <div>
              <SubHeading>1.8 · Motion</SubHeading>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <div className="rounded-xl border border-border bg-surface p-6 text-center shadow-soft-sm">
                  <div className="mx-auto h-12 w-12 animate-float rounded-full bg-primary/20 ring-1 ring-primary/40" />
                  <div className="mt-4 text-caption font-mono text-text-muted">animate-float</div>
                </div>
                <div className="rounded-xl border border-border bg-surface p-6 text-center shadow-soft-sm">
                  <div className="mx-auto h-12 w-12 animate-pulse-soft rounded-full bg-primary" />
                  <div className="mt-4 text-caption font-mono text-text-muted">animate-pulse-soft</div>
                </div>
                <div className="rounded-xl border border-border bg-surface p-6 text-center shadow-soft-sm">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center">
                    <span className="h-4 w-4 animate-pulse-ring rounded-full bg-primary" />
                  </div>
                  <div className="mt-4 text-caption font-mono text-text-muted">animate-pulse-ring</div>
                </div>
                <div className="rounded-xl border border-border bg-surface p-6 text-center shadow-soft-sm">
                  <div className="mx-auto h-3 w-36 overflow-hidden rounded-full bg-surface-3">
                    <div
                      className="h-full w-1/2 animate-shimmer rounded-full"
                      style={{
                        backgroundImage:
                          "linear-gradient(90deg, transparent, var(--color-primary-muted), transparent)",
                        backgroundSize: "200% 100%",
                      }}
                    />
                  </div>
                  <div className="mt-4 text-caption font-mono text-text-muted">animate-shimmer</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═════════════════════════════════════════════════════════════════
            § 2 · Icons
            ═════════════════════════════════════════════════════════════════ */}
        <section id="icons" className="animate-fade-up">
          <SectionHeading
            eyebrow="§ 2"
            title="Icons"
            caption={`Lucide-backed, routed through <Icon name="…" />. ${availableIconNames.length} glyphs registered — adding one means a single entry in components/ui/icon.tsx.`}
          />
          <div
            data-testid="icon-gallery"
            className="rounded-xl border border-border bg-surface p-6 shadow-soft-sm"
          >
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
              {availableIconNames.map((name) => (
                <div
                  key={name}
                  className="group flex flex-col items-center gap-2 rounded-lg border border-transparent p-3 text-text-muted hover:border-border hover:bg-surface-2 hover:text-primary transition duration-fast"
                >
                  <Icon name={name} size={18} />
                  <span className="w-full truncate text-caption font-mono text-text-subtle group-hover:text-text-muted">
                    {name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ═════════════════════════════════════════════════════════════════
            § 3 · Components
            ═════════════════════════════════════════════════════════════════ */}
        <section id="components" className="animate-fade-up space-y-16">
          <SectionHeading
            eyebrow="§ 3"
            title="Components"
            caption="Each block below is a reference for a shipped atom/molecule. Copy the markup as a starting point; never override via inline hex."
          />

          {/* 3.1 Button — primary/secondary/outline/ghost/danger × sm/md/lg */}
          <div>
            <SubHeading>3.1 · Buttons</SubHeading>
            <div className="space-y-5 rounded-xl border border-border bg-surface p-6 shadow-soft-sm">
              {(["sm", "md", "lg"] as const).map((size) => {
                const h = size === "sm" ? "h-8" : size === "md" ? "h-10" : "h-11";
                const px = size === "sm" ? "px-3" : size === "md" ? "px-4" : "px-5";
                const text = size === "sm" ? "text-caption" : "text-sm";
                return (
                  <div key={size} className="flex flex-wrap items-center gap-3">
                    <span className="w-12 text-caption font-mono text-text-subtle">
                      {size}
                    </span>
                    <button
                      className={`${h} ${px} ${text} inline-flex items-center gap-2 rounded-lg bg-primary font-medium text-primary-fg shadow-soft-sm hover:bg-primary-hover hover:shadow-glow-sm hover:-translate-y-px transition duration-fast`}
                    >
                      <Icon name="send" size={size === "sm" ? 12 : 14} />
                      Primary
                    </button>
                    <button
                      className={`${h} ${px} ${text} inline-flex items-center gap-2 rounded-lg border border-border-strong bg-surface-2 font-medium text-text hover:bg-surface-3 transition duration-fast`}
                    >
                      Secondary
                    </button>
                    <button
                      className={`${h} ${px} ${text} inline-flex items-center gap-2 rounded-lg border border-border text-text-muted hover:border-border-strong hover:text-text transition duration-fast`}
                    >
                      Outline
                    </button>
                    <button
                      className={`${h} ${px} ${text} inline-flex items-center gap-2 rounded-lg text-text-muted hover:bg-surface-2 hover:text-text transition duration-fast`}
                    >
                      Ghost
                    </button>
                    <button
                      className={`${h} ${px} ${text} inline-flex items-center gap-2 rounded-lg bg-danger-soft font-medium text-danger hover:bg-danger hover:text-white transition duration-fast`}
                    >
                      <Icon name="trash-2" size={size === "sm" ? 12 : 14} />
                      Danger
                    </button>
                  </div>
                );
              })}

              <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
                <span className="w-12 text-caption font-mono text-text-subtle">state</span>
                <button
                  disabled
                  className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-fg opacity-50"
                >
                  Disabled
                </button>
                <button className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-fg shadow-soft-sm">
                  <Icon name="loader" size={14} className="animate-spin-slow" />
                  Loading
                </button>
                <button className="group inline-flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-primary via-primary-glow to-accent px-5 text-sm font-medium text-primary-fg shadow-glow hover:shadow-glow-lg hover:-translate-y-px transition duration-base">
                  <Icon name="sparkles" size={14} /> Gradient CTA
                  <Icon name="arrow-right" size={14} className="opacity-80" />
                </button>
                <div className="inline-flex overflow-hidden rounded-lg border border-border bg-surface-2">
                  <button className="h-9 px-3 text-sm text-text hover:bg-surface-3 transition duration-fast">
                    <Icon name="chevron-left" size={14} />
                  </button>
                  <span className="grid place-items-center border-x border-border px-4 text-sm text-text">
                    Page 3
                  </span>
                  <button className="h-9 px-3 text-sm text-text hover:bg-surface-3 transition duration-fast">
                    <Icon name="chevron-right" size={14} />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* 3.2 Input · with icon · error · textarea · search · disabled */}
          <div>
            <SubHeading>3.2 · Inputs</SubHeading>
            <div className="grid gap-4 rounded-xl border border-border bg-surface p-6 shadow-soft-sm md:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-caption font-mono uppercase tracking-wider text-text-muted">Default</span>
                <input
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  className="h-10 w-full rounded-lg border border-border bg-surface-2 px-3 text-sm text-text placeholder:text-text-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 transition duration-fast"
                  placeholder="employee-id"
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-caption font-mono uppercase tracking-wider text-text-muted">With icon</span>
                <div className="relative">
                  <Icon
                    name="search"
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-text-subtle"
                  />
                  <input
                    className="h-10 w-full rounded-lg border border-border bg-surface-2 pl-9 pr-3 text-sm text-text placeholder:text-text-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 transition duration-fast"
                    placeholder="Search skills…"
                  />
                </div>
              </label>

              <label className="space-y-1.5">
                <span className="text-caption font-mono uppercase tracking-wider text-danger">Error</span>
                <input
                  className="h-10 w-full rounded-lg border border-danger bg-danger-soft/40 px-3 text-sm text-text focus:outline-none focus:ring-2 focus:ring-danger/40 transition duration-fast"
                  defaultValue="invalid@"
                />
                <span className="text-caption text-danger">
                  Must be a valid email address.
                </span>
              </label>

              <label className="space-y-1.5">
                <span className="text-caption font-mono uppercase tracking-wider text-text-muted">Disabled</span>
                <input
                  disabled
                  value="bootstrap-candidate-42"
                  className="h-10 w-full cursor-not-allowed rounded-lg border border-border bg-surface-3 px-3 text-sm text-text-subtle"
                />
              </label>

              <label className="space-y-1.5 md:col-span-2">
                <span className="text-caption font-mono uppercase tracking-wider text-text-muted">Textarea</span>
                <textarea
                  rows={3}
                  defaultValue="Plan the quarterly OKR rollout and dispatch a worker to draft the intro memo."
                  className="w-full resize-y rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text placeholder:text-text-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 transition duration-fast"
                />
              </label>
            </div>
          </div>

          {/* 3.3 Select + Checkbox + Radio + Toggle */}
          <div>
            <SubHeading>3.3 · Selection controls</SubHeading>
            <div className="grid gap-6 rounded-xl border border-border bg-surface p-6 shadow-soft-sm md:grid-cols-4">
              <label className="space-y-1.5">
                <span className="text-caption font-mono uppercase tracking-wider text-text-muted">Select</span>
                <div className="relative">
                  <select className="h-10 w-full appearance-none rounded-lg border border-border bg-surface-2 px-3 pr-9 text-sm text-text focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 transition duration-fast">
                    <option>claude-opus-4-7</option>
                    <option>claude-sonnet-4-5</option>
                    <option>gpt-5</option>
                    <option>qwen3-max</option>
                  </select>
                  <Icon
                    name="chevrons-up-down"
                    size={14}
                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-subtle"
                  />
                </div>
              </label>

              <div className="space-y-2">
                <span className="text-caption font-mono uppercase tracking-wider text-text-muted">Checkbox</span>
                {["Auto-approve READ tools", "Stream reasoning", "Record traces"].map(
                  (label, i) => (
                    <label key={label} className="flex items-center gap-2 text-sm text-text">
                      <span
                        className={`grid h-4 w-4 place-items-center rounded border ${
                          i !== 2
                            ? "border-primary bg-primary text-primary-fg"
                            : "border-border bg-surface-2"
                        }`}
                      >
                        {i !== 2 ? <Icon name="check" size={10} strokeWidth={3} /> : null}
                      </span>
                      {label}
                    </label>
                  ),
                )}
              </div>

              <div className="space-y-2">
                <span className="text-caption font-mono uppercase tracking-wider text-text-muted">Radio</span>
                {[
                  { l: "Only me", active: true },
                  { l: "Team", active: false },
                  { l: "Public", active: false },
                ].map(({ l, active }) => (
                  <label key={l} className="flex items-center gap-2 text-sm text-text">
                    <span
                      className={`grid h-4 w-4 place-items-center rounded-full border ${
                        active ? "border-primary" : "border-border"
                      }`}
                    >
                      {active ? <span className="h-2 w-2 rounded-full bg-primary" /> : null}
                    </span>
                    {l}
                  </label>
                ))}
              </div>

              <div className="space-y-3">
                <span className="text-caption font-mono uppercase tracking-wider text-text-muted">Toggle</span>
                {[
                  { l: "Confirmation gate", on: true },
                  { l: "Checkpointer", on: true },
                  { l: "Shadow mode", on: false },
                ].map(({ l, on }) => (
                  <label key={l} className="flex items-center justify-between gap-3 text-sm text-text">
                    {l}
                    <span
                      className={`relative h-5 w-9 rounded-full transition duration-fast ${
                        on ? "bg-primary" : "bg-surface-3"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-soft-sm transition duration-fast ${
                          on ? "left-4" : "left-0.5"
                        }`}
                      />
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* 3.4 Badges */}
          <div>
            <SubHeading>3.4 · Badges</SubHeading>
            <div className="space-y-4 rounded-xl border border-border bg-surface p-6 shadow-soft-sm">
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-0.5 text-caption font-medium text-primary-fg">
                  <Icon name="sparkles" size={10} /> Solid primary
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-success px-2.5 py-0.5 text-caption font-medium text-white">
                  Success
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-warning px-2.5 py-0.5 text-caption font-medium text-white">
                  Warning
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-danger px-2.5 py-0.5 text-caption font-medium text-white">
                  Danger
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-surface-3 px-2.5 py-0.5 text-caption font-medium text-text">
                  Neutral
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-0.5 text-caption font-medium text-primary">
                  Soft primary
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2.5 py-0.5 text-caption font-medium text-success">
                  <span className="h-1.5 w-1.5 rounded-full bg-success" /> Healthy
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2.5 py-0.5 text-caption font-medium text-warning">
                  Degraded
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2.5 py-0.5 text-caption font-medium text-danger">
                  <Icon name="alert-triangle" size={10} /> Failing
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 px-2.5 py-0.5 text-caption font-medium text-primary">
                  Outline primary
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-caption font-medium text-text-muted">
                  v0.4.2
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-border font-mono px-2.5 py-0.5 text-caption text-text-subtle">
                  BOOTSTRAP
                </span>
              </div>
            </div>
          </div>

          {/* 3.5 Cards */}
          <div>
            <SubHeading>3.5 · Cards</SubHeading>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="p-6 rounded-xl bg-surface border border-border shadow-soft-sm">
                <div className="text-caption font-mono uppercase tracking-wider text-text-subtle">
                  Default
                </div>
                <h4 className="mt-2 text-lg font-semibold">Drafting assistant</h4>
                <p className="mt-1 text-sm text-text-muted">
                  Turns bullet points into polished copy. 14 skills active.
                </p>
              </div>
              <div className="group p-6 rounded-xl bg-surface border border-border shadow-soft-sm hover:border-border-strong hover:shadow-soft hover:-translate-y-px transition duration-base">
                <div className="text-caption font-mono uppercase tracking-wider text-text-subtle">
                  Hover elevate
                </div>
                <h4 className="mt-2 text-lg font-semibold">Research scout</h4>
                <p className="mt-1 text-sm text-text-muted">
                  Summarises competitor docs into a 1-pager you can skim.
                </p>
                <div className="mt-4 inline-flex items-center gap-1 text-caption font-medium text-primary">
                  Configure <Icon name="arrow-right" size={12} />
                </div>
              </div>
              <div className="relative p-6 rounded-xl bg-gradient-to-br from-primary/10 to-transparent border border-primary/40 shadow-soft-lg overflow-hidden">
                <div className="absolute left-0 top-0 h-[2px] w-full bg-gradient-to-r from-primary via-primary-glow to-transparent" />
                <div className="text-caption font-mono uppercase tracking-wider text-primary">
                  Featured
                </div>
                <h4 className="mt-2 text-lg font-semibold">Lead Agent · v3</h4>
                <p className="mt-1 text-sm text-text-muted">
                  Recommended. Handles routing, dispatch and observatory in one.
                </p>
                <button className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-fg shadow-glow-sm hover:shadow-glow transition duration-fast">
                  <Icon name="play" size={13} /> Start
                </button>
              </div>

              {/* Glass card */}
              <div className="md:col-span-3 rounded-xl border border-border bg-surface-2/60 p-6 backdrop-blur-xl shadow-soft-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-caption font-mono uppercase tracking-wider text-text-subtle">
                      Glass · translucent surface-2/60 + backdrop-blur
                    </div>
                    <h4 className="mt-2 text-lg font-semibold">
                      Overlay a busy background without losing legibility
                    </h4>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-0.5 text-caption font-medium text-primary">
                    Opt-in
                  </span>
                </div>
              </div>

              {/* KPI stat grid */}
              {[
                { label: "Runs · 7d", value: "1,284", delta: "+12.4%", points: [4, 7, 6, 11, 9, 14, 13, 17, 19, 22], tone: "text-success" },
                { label: "Avg latency", value: "1.28s", delta: "-8%", points: [22, 20, 19, 17, 16, 15, 14, 13, 12, 11], tone: "text-success" },
                { label: "Approvals", value: "96%", delta: "+1.1%", points: [10, 11, 12, 14, 13, 14, 15, 15, 16, 16], tone: "text-success" },
                { label: "Errors", value: "0.4%", delta: "+0.1%", points: [2, 3, 2, 4, 3, 5, 4, 6, 5, 6], tone: "text-warning" },
              ].map((s) => (
                <div
                  key={s.label}
                  className="p-5 rounded-xl bg-surface border border-border shadow-soft-sm hover:border-border-strong transition duration-base"
                >
                  <div className="text-caption text-text-muted uppercase tracking-wider font-mono">
                    {s.label}
                  </div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-xl font-semibold tracking-tight">{s.value}</span>
                    <span className={`text-caption font-mono ${s.tone}`}>{s.delta}</span>
                  </div>
                  <Spark points={s.points} className={s.tone === "text-warning" ? "text-warning" : "text-primary"} />
                </div>
              ))}
            </div>
          </div>

          {/* 3.6 Sidebar nav items */}
          <div>
            <SubHeading>3.6 · Sidebar navigation</SubHeading>
            <div className="grid gap-6 md:grid-cols-[280px_1fr]">
              <nav className="space-y-1 rounded-xl border border-border bg-surface p-3 shadow-soft-sm">
                <div className="px-2 py-1 text-caption font-mono uppercase tracking-wider text-text-subtle">
                  Workspace
                </div>
                {[
                  { l: "Chat", icon: "message-square" as IconName, active: false },
                  { l: "Employees", icon: "users" as IconName, active: true },
                  { l: "Skills", icon: "wand-2" as IconName, active: false },
                  { l: "Observatory", icon: "activity" as IconName, active: false },
                  { l: "Traces", icon: "terminal" as IconName, active: false },
                ].map((item) => (
                  <a
                    key={item.l}
                    href="#"
                    className={
                      item.active
                        ? "relative flex items-center gap-2 rounded-lg bg-primary-muted px-3 py-2 text-sm font-medium text-primary"
                        : "flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-muted hover:bg-surface-2 hover:text-text transition duration-fast"
                    }
                  >
                    {item.active ? (
                      <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-primary animate-bar-in" />
                    ) : null}
                    <Icon name={item.icon} size={14} />
                    <span className="flex-1">{item.l}</span>
                    {item.l === "Employees" ? (
                      <span className="rounded bg-primary/20 px-1.5 text-caption font-mono text-primary">
                        12
                      </span>
                    ) : null}
                  </a>
                ))}
              </nav>
              <div className="rounded-xl border border-dashed border-border p-6 text-sm text-text-muted">
                Active item uses <code className="font-mono text-text">bg-primary-muted</code>,
                a 2px left bar (<code className="font-mono text-text">animate-bar-in</code>),
                and <code className="font-mono text-text">text-primary</code>. Inactive items
                rely on hover <code className="font-mono text-text">bg-surface-2</code> without
                colour shift until interaction.
              </div>
            </div>
          </div>

          {/* 3.7 Tabs (underline + pill) */}
          <div>
            <SubHeading>3.7 · Tabs</SubHeading>
            <div className="space-y-6 rounded-xl border border-border bg-surface p-6 shadow-soft-sm">
              <div>
                <div className="flex items-center gap-6 border-b border-border">
                  {["overview", "runs", "skills", "settings"].map((t) => (
                    <button
                      key={t}
                      onClick={() => setTabUnderline(t)}
                      className={`relative -mb-px py-2 text-sm transition duration-fast ${
                        tabUnderline === t
                          ? "text-text"
                          : "text-text-muted hover:text-text"
                      }`}
                    >
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                      {tabUnderline === t ? (
                        <span className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-primary shadow-glow-sm" />
                      ) : null}
                    </button>
                  ))}
                </div>
                <div className="mt-4 text-sm text-text-muted">
                  Underline tab — subtle, used for information hierarchy.
                </div>
              </div>

              <div>
                <div className="inline-flex rounded-lg border border-border bg-surface-2 p-1">
                  {["chat", "plan", "execute"].map((t) => (
                    <button
                      key={t}
                      onClick={() => setTabPill(t)}
                      className={`rounded-md px-3 py-1.5 text-sm transition duration-fast ${
                        tabPill === t
                          ? "bg-surface text-text shadow-soft-sm"
                          : "text-text-muted hover:text-text"
                      }`}
                    >
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
                <div className="mt-4 text-sm text-text-muted">
                  Pill tab — higher emphasis, used inside toolbars.
                </div>
              </div>
            </div>
          </div>

          {/* 3.8 Modal */}
          <div>
            <SubHeading>3.8 · Modal</SubHeading>
            <div className="rounded-xl border border-border bg-surface p-6 shadow-soft-sm">
              <button
                onClick={() => setModalOpen(true)}
                className="h-10 rounded-lg border border-border-strong bg-surface-2 px-4 text-sm text-text hover:bg-surface-3 transition duration-fast"
              >
                Open modal
              </button>

              {modalOpen ? (
                <div className="fixed inset-0 z-50 grid place-items-center bg-bg/70 p-6 backdrop-blur-sm">
                  <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-soft-lg animate-fade-up">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-caption font-mono uppercase tracking-wider text-primary">
                          Confirmation gate
                        </div>
                        <h4 className="mt-1 text-lg font-semibold">
                          Dispatch <code className="font-mono text-primary">delete_employee</code>?
                        </h4>
                      </div>
                      <button
                        onClick={() => setModalOpen(false)}
                        className="grid h-8 w-8 place-items-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text transition duration-fast"
                      >
                        <Icon name="x" size={14} />
                      </button>
                    </div>
                    <p className="mt-3 text-sm text-text-muted">
                      This is an{" "}
                      <span className="font-medium text-text">IRREVERSIBLE</span>{" "}
                      scope tool call. Approving will remove the worker and its
                      skill runtime. Traces are kept.
                    </p>
                    <div className="mt-5 flex justify-end gap-2">
                      <button
                        onClick={() => setModalOpen(false)}
                        className="h-9 rounded-lg px-3 text-sm text-text-muted hover:bg-surface-2 hover:text-text transition duration-fast"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => setModalOpen(false)}
                        className="inline-flex h-9 items-center gap-2 rounded-lg bg-danger px-3.5 text-sm font-medium text-white hover:bg-danger/90 transition duration-fast"
                      >
                        <Icon name="trash-2" size={13} /> Approve delete
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {/* 3.9 Toasts */}
          <div>
            <SubHeading>3.9 · Toasts</SubHeading>
            <div className="space-y-3 rounded-xl border border-border bg-surface p-6 shadow-soft-sm">
              {[
                { tone: "success", icon: "check-circle-2" as IconName, title: "Deployment complete", body: "Worker `drafter-v3` is live in 12ms." },
                { tone: "info",    icon: "info"            as IconName, title: "Skill resolved", body: "Activated 2 tools, 3 prompt fragments." },
                { tone: "warning", icon: "alert-triangle"  as IconName, title: "Rate limit approaching", body: "You have used 82% of the hourly budget." },
                { tone: "danger",  icon: "alert-circle"    as IconName, title: "Tool call failed", body: "fetch_url returned 503 — retrying with backoff." },
              ].map((t) => {
                const colour = {
                  success: "border-success/40 bg-success-soft text-success",
                  info: "border-primary/40 bg-primary-muted text-primary",
                  warning: "border-warning/40 bg-warning-soft text-warning",
                  danger: "border-danger/40 bg-danger-soft text-danger",
                }[t.tone]!;
                return (
                  <div
                    key={t.tone}
                    className={`flex items-start gap-3 rounded-xl border p-3 shadow-soft-sm ${colour}`}
                  >
                    <Icon name={t.icon} size={16} />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-text">{t.title}</div>
                      <div className="text-caption text-text-muted">{t.body}</div>
                    </div>
                    <button className="text-text-subtle hover:text-text transition duration-fast">
                      <Icon name="x" size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 3.10 Tooltip */}
          <div>
            <SubHeading>3.10 · Tooltip</SubHeading>
            <div className="rounded-xl border border-border bg-surface p-10 shadow-soft-sm">
              <div className="relative inline-block group">
                <button className="inline-flex h-10 items-center gap-2 rounded-lg border border-border-strong bg-surface-2 px-4 text-sm text-text">
                  <Icon name="info" size={14} /> Hover for tooltip
                </button>
                <span
                  className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-surface-4 px-2.5 py-1 text-caption font-mono text-text shadow-soft-lg opacity-0 group-hover:opacity-100 transition duration-fast"
                >
                  ⌘K · Open command palette
                </span>
              </div>
            </div>
          </div>

          {/* 3.11 Avatar */}
          <div>
            <SubHeading>3.11 · Avatars</SubHeading>
            <div className="flex flex-wrap items-end gap-8 rounded-xl border border-border bg-surface p-6 shadow-soft-sm">
              {[24, 32, 40].map((s) => (
                <div
                  key={s}
                  className="flex flex-col items-center gap-2"
                >
                  <span
                    className="grid place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-primary-fg font-semibold shadow-glow-sm"
                    style={{ width: s, height: s, fontSize: s * 0.4 }}
                  >
                    AL
                  </span>
                  <span className="text-caption font-mono text-text-subtle">{s}px</span>
                </div>
              ))}

              <div className="flex -space-x-2">
                {["text-role-user", "text-role-lead", "text-role-worker", "text-role-tool"].map((c, i) => (
                  <span
                    key={c}
                    className="grid h-9 w-9 place-items-center rounded-full border-2 border-surface bg-surface-3 text-caption font-mono text-text"
                  >
                    {"AEMR"[i]}
                  </span>
                ))}
                <span className="grid h-9 w-9 place-items-center rounded-full border-2 border-surface bg-surface-2 text-caption font-mono text-text-muted">
                  +3
                </span>
              </div>

              <div className="relative">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-fg">
                  LA
                </span>
                <span className="absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 border-surface bg-success animate-pulse-soft" />
              </div>
            </div>
          </div>

          {/* 3.12 Progress */}
          <div>
            <SubHeading>3.12 · Progress</SubHeading>
            <div className="grid gap-6 rounded-xl border border-border bg-surface p-6 shadow-soft-sm md:grid-cols-[1fr_auto]">
              <div className="space-y-4">
                {[
                  { l: "Bootstrapping workspace", v: 78, tone: "bg-primary" },
                  { l: "Indexing skills", v: 42, tone: "bg-accent" },
                  { l: "Running dispatch", v: 94, tone: "bg-success" },
                ].map((p) => (
                  <div key={p.l} className="space-y-1.5">
                    <div className="flex justify-between text-caption font-mono text-text-muted">
                      <span>{p.l}</span>
                      <span>{p.v}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3">
                      <div
                        className={`h-full rounded-full ${p.tone} shadow-glow-sm`}
                        style={{ width: `${p.v}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Ring */}
              <div className="flex flex-col items-center gap-2">
                <svg viewBox="0 0 48 48" className="h-24 w-24 -rotate-90">
                  <circle cx="24" cy="24" r="20" fill="none" stroke="var(--color-surface-3)" strokeWidth="4" />
                  <circle
                    cx="24"
                    cy="24"
                    r="20"
                    fill="none"
                    stroke="var(--color-primary)"
                    strokeWidth="4"
                    strokeDasharray={2 * Math.PI * 20}
                    strokeDashoffset={(1 - 0.72) * 2 * Math.PI * 20}
                    strokeLinecap="round"
                  />
                </svg>
                <span className="text-caption font-mono text-text-muted">72%</span>
              </div>
            </div>
          </div>

          {/* 3.13 Skeleton */}
          <div>
            <SubHeading>3.13 · Skeleton</SubHeading>
            <div className="grid gap-3 rounded-xl border border-border bg-surface p-6 shadow-soft-sm">
              {[60, 90, 75].map((w, i) => (
                <div
                  key={i}
                  className="h-3 animate-shimmer rounded-md"
                  style={{
                    width: `${w}%`,
                    backgroundImage:
                      "linear-gradient(90deg, var(--color-surface-2), var(--color-surface-3), var(--color-surface-2))",
                    backgroundSize: "200% 100%",
                  }}
                />
              ))}
              <div className="mt-4 flex gap-3">
                <div
                  className="h-10 w-10 animate-shimmer rounded-full"
                  style={{
                    backgroundImage:
                      "linear-gradient(90deg, var(--color-surface-2), var(--color-surface-3), var(--color-surface-2))",
                    backgroundSize: "200% 100%",
                  }}
                />
                <div className="flex-1 space-y-2">
                  <div
                    className="h-3 w-1/3 animate-shimmer rounded-md"
                    style={{
                      backgroundImage:
                        "linear-gradient(90deg, var(--color-surface-2), var(--color-surface-3), var(--color-surface-2))",
                      backgroundSize: "200% 100%",
                    }}
                  />
                  <div
                    className="h-3 w-2/3 animate-shimmer rounded-md"
                    style={{
                      backgroundImage:
                        "linear-gradient(90deg, var(--color-surface-2), var(--color-surface-3), var(--color-surface-2))",
                      backgroundSize: "200% 100%",
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* 3.14 Empty state */}
          <div>
            <SubHeading>3.14 · Empty state</SubHeading>
            <div className="rounded-xl border border-dashed border-border bg-surface p-12 text-center shadow-soft-sm">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary animate-float">
                <Icon name="sparkles" size={22} />
              </div>
              <h4 className="mt-4 text-lg font-semibold">No employees yet</h4>
              <p className="mt-1 text-sm text-text-muted">
                Dispatch your first employee from a skill template, or ask the Lead
                Agent to design one for you.
              </p>
              <div className="mt-4 flex justify-center gap-2">
                <button className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-fg shadow-soft-sm hover:bg-primary-hover transition duration-fast">
                  <Icon name="plus" size={13} /> New employee
                </button>
                <button className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3.5 text-sm text-text-muted hover:border-border-strong hover:text-text transition duration-fast">
                  <Icon name="book-open" size={13} /> Guide
                </button>
              </div>
            </div>
          </div>

          {/* 3.15 Code block */}
          <div>
            <SubHeading>3.15 · Code block</SubHeading>
            <div className="overflow-hidden rounded-xl border border-border bg-surface-2 shadow-soft-sm">
              <div className="flex items-center justify-between border-b border-border px-4 py-2">
                <div className="flex items-center gap-2 text-caption font-mono text-text-muted">
                  <Icon name="file-code-2" size={12} /> skills/lead-agent/SKILL.yaml
                </div>
                <button className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-caption text-text-muted hover:bg-surface-3 hover:text-text transition duration-fast">
                  <Icon name="copy" size={12} /> Copy
                </button>
              </div>
              <pre className="overflow-x-auto px-4 py-3 text-caption font-mono leading-relaxed text-text">
{`id: allhands.builtin.lead_agent
descriptor: "routes intent · dispatches workers · interrupts on gate"
tool_ids:
  - dispatch_employee
  - spawn_subagent
  - resolve_skill
max_iterations: 12
model_ref: claude-opus-4-7`}
              </pre>
            </div>
          </div>

          {/* 3.16 Command palette */}
          <div>
            <SubHeading>3.16 · Command palette</SubHeading>
            <div className="relative rounded-xl border border-border bg-surface p-6 shadow-soft-sm">
              <button
                onClick={() => setCmdOpen(true)}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 text-sm text-text-muted hover:border-border-strong hover:text-text transition duration-fast"
              >
                <Icon name="search" size={13} /> Type a command or search…
                <span className="ml-6 rounded-md border border-border bg-surface-3 px-1.5 font-mono text-caption text-text-muted">
                  ⌘K
                </span>
              </button>

              {cmdOpen ? (
                <div className="mt-6 w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-soft-lg">
                  <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                    <Icon name="search" size={14} className="text-text-subtle" />
                    <input
                      autoFocus
                      placeholder="Jump to employee, skill, or trace…"
                      className="flex-1 bg-transparent text-sm text-text placeholder:text-text-subtle focus:outline-none"
                    />
                    <button
                      onClick={() => setCmdOpen(false)}
                      className="rounded-md px-1.5 py-0.5 text-caption font-mono text-text-subtle hover:bg-surface-2 hover:text-text transition duration-fast"
                    >
                      ESC
                    </button>
                  </div>
                  <ul className="max-h-72 overflow-y-auto py-2">
                    {[
                      { i: "users" as IconName, l: "Jump to Employees", s: "G E" },
                      { i: "wand-2" as IconName, l: "Resolve skill…", s: "R S" },
                      { i: "activity" as IconName, l: "Observatory · last 24h", s: "G O" },
                      { i: "terminal" as IconName, l: "Open trace for run #48a1", s: "" },
                      { i: "settings" as IconName, l: "Settings · Providers", s: "," },
                    ].map((row, i) => (
                      <li
                        key={row.l}
                        className={`mx-2 flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition duration-fast ${
                          i === 0
                            ? "bg-primary-muted text-primary"
                            : "text-text-muted hover:bg-surface-2 hover:text-text"
                        }`}
                      >
                        <Icon name={row.i} size={14} />
                        <span className="flex-1">{row.l}</span>
                        {row.s ? (
                          <span className="rounded border border-border bg-surface-2 px-1.5 font-mono text-caption text-text-subtle">
                            {row.s}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>

          {/* 3.17 Chat bubbles */}
          <div>
            <SubHeading>3.17 · Chat bubbles</SubHeading>
            <div className="space-y-4 rounded-xl border border-border bg-surface p-6 shadow-soft-sm">
              {/* user */}
              <div className="flex justify-end">
                <div className="max-w-[70%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-fg shadow-soft-sm">
                  Ship the P3 rework by EOD and keep docs synced.
                </div>
              </div>

              {/* reasoning */}
              <div className="flex items-start gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-surface-3 text-primary">
                  <Icon name="brain" size={14} />
                </span>
                <div className="flex-1 rounded-2xl border border-dashed border-primary/40 bg-primary/5 px-4 py-2.5 text-sm italic text-text-muted">
                  <span className="text-caption font-mono uppercase tracking-wider text-primary">
                    thinking
                  </span>
                  <div className="mt-1">
                    Needs token audit first — then rewire atoms. Workers can
                    parallelise skills + tokens.
                  </div>
                </div>
              </div>

              {/* tool call */}
              <div className="flex items-start gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-surface-3 text-text">
                  <Icon name="terminal" size={14} />
                </span>
                <div className="flex-1 rounded-2xl border border-border bg-surface-2 px-4 py-2.5">
                  <div className="flex items-center gap-2 text-caption font-mono text-text-muted">
                    <Icon name="zap" size={12} className="text-primary" />
                    dispatch_employee · worker=rework-atoms
                  </div>
                  <div className="mt-1 text-sm text-text">
                    →{" "}
                    <span className="font-mono text-success">ok</span> ·{" "}
                    <span className="text-text-muted">trace #48a1</span>
                  </div>
                </div>
              </div>

              {/* agent answer */}
              <div className="flex items-start gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-fg shadow-glow-sm">
                  <Icon name="sparkles" size={14} />
                </span>
                <div className="max-w-[70%] rounded-2xl rounded-bl-md border border-border bg-surface-2 px-4 py-2.5 text-sm text-text shadow-soft-sm">
                  Tokens audited, atoms rewired. Sent a PR with 14 files changed;
                  design-lab renders in both themes with zero diff.
                </div>
              </div>
            </div>
          </div>

          {/* 3.18 Table */}
          <div>
            <SubHeading>3.18 · Table</SubHeading>
            <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-soft-sm">
              <div className="flex items-center gap-3 border-b border-border px-4 py-3">
                <div className="relative flex-1 max-w-sm">
                  <Icon
                    name="search"
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-text-subtle"
                  />
                  <input
                    placeholder="Filter runs…"
                    className="h-9 w-full rounded-lg border border-border bg-surface-2 pl-9 pr-3 text-sm text-text placeholder:text-text-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 transition duration-fast"
                  />
                </div>
                <button className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm text-text-muted hover:border-border-strong hover:text-text transition duration-fast">
                  <Icon name="filter" size={13} /> Filter
                </button>
                <button className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-fg shadow-soft-sm hover:bg-primary-hover transition duration-fast">
                  <Icon name="plus" size={13} /> New run
                </button>
              </div>

              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-2 text-text-muted">
                    {["Run", "Employee", "Status", "Latency", "Trend", ""].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-2 text-left text-caption font-mono uppercase tracking-wider font-medium"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { id: "48a1", emp: "rework-atoms",   status: "ok",      latency: "1.28s", pts: [4, 6, 7, 9, 12, 14, 13, 15, 17] },
                    { id: "48a0", emp: "drafter-v3",     status: "running", latency: "0.84s", pts: [12, 11, 13, 12, 14, 13, 14, 15, 15] },
                    { id: "489f", emp: "research-scout", status: "warn",    latency: "4.11s", pts: [9, 7, 11, 14, 8, 12, 6, 10, 5] },
                    { id: "489e", emp: "lead-agent",     status: "ok",      latency: "0.62s", pts: [6, 7, 6, 9, 8, 10, 11, 12, 13] },
                    { id: "489d", emp: "dispatcher",     status: "error",   latency: "—",     pts: [4, 4, 3, 4, 3, 5, 3, 6, 2] },
                  ].map((row) => {
                    const badge = {
                      ok:      "bg-success-soft text-success",
                      running: "bg-primary-muted text-primary",
                      warn:    "bg-warning-soft text-warning",
                      error:   "bg-danger-soft text-danger",
                    }[row.status]!;
                    return (
                      <tr
                        key={row.id}
                        className="border-b border-border text-text last:border-b-0 hover:bg-surface-2 transition duration-fast"
                      >
                        <td className="px-4 py-3 font-mono text-text-muted">#{row.id}</td>
                        <td className="px-4 py-3">{row.emp}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption font-medium ${badge}`}>
                            <span className="h-1.5 w-1.5 rounded-full bg-current" />
                            {row.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-text-muted">{row.latency}</td>
                        <td className="px-4 py-3 w-32">
                          <Spark
                            points={row.pts}
                            className={
                              row.status === "error"
                                ? "text-danger"
                                : row.status === "warn"
                                  ? "text-warning"
                                  : "text-primary"
                            }
                          />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button className="grid h-7 w-7 place-items-center rounded-md text-text-muted hover:bg-surface-3 hover:text-text transition duration-fast">
                            <Icon name="more-horizontal" size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="flex items-center justify-between border-t border-border px-4 py-3 text-caption text-text-muted">
                <span>Showing 5 of 128 runs</span>
                <div className="inline-flex overflow-hidden rounded-md border border-border bg-surface-2">
                  <button className="h-7 px-2 hover:bg-surface-3 transition duration-fast">
                    <Icon name="chevron-left" size={13} />
                  </button>
                  <span className="grid place-items-center border-x border-border px-3 font-mono text-text">
                    1 / 26
                  </span>
                  <button className="h-7 px-2 hover:bg-surface-3 transition duration-fast">
                    <Icon name="chevron-right" size={13} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═════════════════════════════════════════════════════════════════
            Footer
            ═════════════════════════════════════════════════════════════════ */}
        <footer className="border-t border-border pt-8 text-caption font-mono text-text-subtle">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <span>allhands · design-lab · ADR 0016</span>
            <div className="flex items-center gap-4">
              <Link href="/" className="hover:text-text transition duration-fast">/ home</Link>
              <a href="#tokens" className="hover:text-text transition duration-fast">/ tokens</a>
              <a href="#components" className="hover:text-text transition duration-fast">/ components</a>
              <a href="https://github.com/allhands" className="inline-flex items-center gap-1 hover:text-text transition duration-fast">
                <Icon name="code" size={11} /> repo
              </a>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
