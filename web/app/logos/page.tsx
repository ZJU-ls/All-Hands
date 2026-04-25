"use client";

/**
 * /logos · logo concept gallery.
 *
 * Side-by-side preview of every <AllhandsLogo concept=…> variant at 4
 * sizes × 2 themes × 2 variants (tile / mono). Pick a row, tell the team
 * which concept to keep, and we ship that one app-wide.
 */

import { useTheme } from "@/components/theme/ThemeProvider";
import {
  AllhandsLogo,
  AllhandsWordmark,
  LOGO_CONCEPTS,
  type LogoConcept,
} from "@/components/brand/AllhandsLogo";
import { Icon } from "@/components/ui/icon";

const SIZES: number[] = [16, 28, 48, 80];

export default function LogoGalleryPage() {
  const { theme, toggle } = useTheme();
  return (
    <main className="h-screen overflow-y-auto bg-bg">
      <header className="sticky top-0 z-30 border-b border-border bg-bg/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1280px] items-center justify-between px-8 py-5">
          <div className="flex items-center gap-3">
            <AllhandsLogo size={32} concept="constellation" />
            <div>
              <h1 className="text-base font-semibold tracking-tight text-text">
                Logo gallery
              </h1>
              <p className="text-caption text-text-subtle">
                5 concepts · 4 sizes · light / dark · pick one
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={toggle}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm text-text-muted transition-colors duration-fast hover:border-border-strong hover:text-text"
          >
            <Icon name={theme === "dark" ? "sun" : "moon"} size={14} />
            {theme === "dark" ? "Light" : "Dark"}
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-[1280px] px-8 pb-24 pt-10 space-y-10">
        {LOGO_CONCEPTS.map((c) => (
          <section
            key={c.id}
            className="overflow-hidden rounded-2xl border border-border bg-surface shadow-soft-sm"
          >
            <header className="flex items-baseline justify-between gap-6 border-b border-border bg-surface-2/40 px-6 py-4">
              <div className="space-y-1">
                <div className="flex items-baseline gap-2">
                  <h2 className="text-lg font-semibold tracking-tight text-text">
                    {c.name}
                  </h2>
                  <code className="font-mono text-caption text-text-subtle">
                    concept=&quot;{c.id}&quot;
                  </code>
                </div>
                <p className="max-w-2xl text-sm text-text-muted">{c.story}</p>
              </div>
            </header>

            <div className="grid divide-y divide-border lg:grid-cols-2 lg:divide-x lg:divide-y-0">
              <SizeRow concept={c.id} variant="tile" label="Tile · 默认 · 渐变" />
              <SizeRow
                concept={c.id}
                variant="mono"
                label="Mono · 描边 · currentColor"
              />
            </div>

            <footer className="border-t border-border bg-surface-2/30 px-6 py-4">
              <h3 className="mb-3 text-caption font-mono uppercase tracking-wider text-text-subtle">
                In context
              </h3>
              <div className="grid gap-3 md:grid-cols-3">
                {/* Sidebar header preview */}
                <ContextPreview label="Sidebar header">
                  <div className="flex items-center gap-2.5">
                    <AllhandsLogo size={32} concept={c.id} />
                    <div>
                      <div className="text-sm font-semibold tracking-tight text-text">
                        allhands
                      </div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-text-subtle">
                        v0 · mvp
                      </div>
                    </div>
                  </div>
                </ContextPreview>

                {/* Hero pairing */}
                <ContextPreview label="Welcome top-bar">
                  <div className="flex items-center gap-2.5">
                    <AllhandsLogo
                      size={36}
                      concept={c.id}
                      className="shadow-glow-sm rounded-lg"
                    />
                    <AllhandsWordmark size={16} />
                  </div>
                </ContextPreview>

                {/* Favicon scale */}
                <ContextPreview label="Favicon (16px)">
                  <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1">
                    <AllhandsLogo size={16} concept={c.id} />
                    <span className="text-caption text-text-muted">
                      allhands · 对话
                    </span>
                  </div>
                </ContextPreview>
              </div>
            </footer>
          </section>
        ))}

        <p className="text-caption text-text-subtle">
          告诉我你要哪个 concept(constellation / spark / cluster / halo /
          pulse),我把它替换为 app-wide 默认并清掉其它候选。
        </p>
      </div>
    </main>
  );
}

function SizeRow({
  concept,
  variant,
  label,
}: {
  concept: LogoConcept;
  variant: "tile" | "mono";
  label: string;
}) {
  return (
    <div className="space-y-4 px-6 py-6">
      <h3 className="text-caption font-mono uppercase tracking-wider text-text-subtle">
        {label}
      </h3>
      <div className="flex items-end gap-8">
        {SIZES.map((s) => (
          <div key={s} className="flex flex-col items-center gap-2">
            <AllhandsLogo size={s} concept={concept} variant={variant} />
            <span className="font-mono text-[10px] text-text-subtle">{s}px</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ContextPreview({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface px-4 py-4">
      <div className="text-caption font-mono uppercase tracking-wider text-text-subtle">
        {label}
      </div>
      <div className="flex min-h-[44px] items-center">{children}</div>
    </div>
  );
}
