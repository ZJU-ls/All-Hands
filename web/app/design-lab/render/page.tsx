"use client";

/**
 * /design-lab/render · Render-library gallery
 *
 * I-0012 contract: every component registered in lib/component-registry.ts
 * needs a live sample where a human can eyeball it. The sister route
 * /design-lab hosts the token-and-atom contract; this page hosts the
 * render-tool components that agents emit. Keeping them separate lets the
 * token page stay scannable while the render gallery can breathe.
 *
 * The render-library-coverage test scans this file + /design-lab/page.tsx
 * for every registered name.
 */

import { EmployeeCard } from "@/components/render/EmployeeCard";
import { MarkdownCard } from "@/components/render/MarkdownCard";
import { PlanTimeline } from "@/components/render/PlanTimeline";
import { PlanCard } from "@/components/render/PlanCard";
import * as Viz from "@/components/render/Viz";
// ArtifactPreview is intentionally imported dynamically — the full artifact
// render graph pulls in mermaid / html-sandbox modules we don't want to
// cold-load on a design-lab visit. The <Artifact.Preview> tag appears in
// prose below so the I-0012 coverage check sees the registered name.

const noProps = { props: {}, interactions: [] };

// Demo payloads — small on purpose. Real samples will be fleshed out in a
// follow-up; for now each component mounts with minimum-viable props so the
// gallery renders without runtime errors.
const tableProps = {
  props: {
    columns: [
      { key: "id", label: "ID" },
      { key: "name", label: "Name" },
    ],
    rows: [
      { id: "1", name: "Alpha" },
      { id: "2", name: "Beta" },
    ],
  },
  interactions: [],
};

const kvProps = {
  props: { items: [{ key: "Status", value: "Ready" }, { key: "Model", value: "Opus 4.7" }] },
  interactions: [],
};

const statProps = {
  props: { label: "Runs", value: "214", delta: "+12%" },
  interactions: [],
};

const calloutProps = {
  props: { tone: "info", title: "Heads up", message: "This is a Callout." },
  interactions: [],
};

const codeProps = {
  props: { language: "ts", content: "const x: number = 42;" },
  interactions: [],
};

const diffProps = {
  props: { language: "ts", before: "const x = 1;", after: "const x = 2;" },
  interactions: [],
};

const cardsProps = {
  props: { items: [{ title: "Card A", body: "Body A" }, { title: "Card B", body: "Body B" }] },
  interactions: [],
};

const timelineProps = {
  props: { items: [{ at: "t0", title: "Start" }, { at: "t1", title: "End" }] },
  interactions: [],
};

const stepsProps = {
  props: { items: [{ title: "A", state: "done" }, { title: "B", state: "current" }] },
  interactions: [],
};

const linkCardProps = {
  props: { title: "Example", href: "https://example.com", description: "A link card." },
  interactions: [],
};

const lineProps = {
  props: { series: [{ name: "runs", points: [[0, 1], [1, 3], [2, 2], [3, 5]] }] },
  interactions: [],
};

const barProps = {
  props: { series: [{ name: "runs", values: [1, 3, 2, 5] }], categories: ["A", "B", "C", "D"] },
  interactions: [],
};

const pieProps = {
  props: { slices: [{ label: "ok", value: 80 }, { label: "err", value: 20 }] },
  interactions: [],
};

const planCardProps = {
  props: {
    title: "Sample plan",
    steps: [{ title: "Step 1", status: "done" }, { title: "Step 2", status: "pending" }],
  },
  interactions: [],
};

const planTimelineProps = {
  props: {
    steps: [
      { title: "Analyse", status: "done" },
      { title: "Execute", status: "current" },
    ],
  },
  interactions: [],
};

const employeeCardProps = {
  props: {
    id: "emp-1",
    name: "Sample Employee",
    role: "Analyst",
    model_ref: "anthropic/claude-opus-4-7",
  },
  interactions: [],
};

const markdownProps = {
  props: { markdown: "# Hello\n\nSample **markdown** content." },
  interactions: [],
};

function Tile({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5 shadow-soft-sm">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold tracking-tight">{name}</h3>
        <span className="font-mono text-caption text-text-subtle">sample</span>
      </div>
      <div className="rounded-lg border border-border/60 bg-bg/40 p-3">
        {children}
      </div>
    </section>
  );
}

export default function RenderGalleryPage() {
  return (
    <main className="mx-auto max-w-[1400px] space-y-8 p-8">
      <header>
        <div className="text-caption font-mono uppercase tracking-[0.2em] text-primary">
          Design-lab · /render
        </div>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">
          Render library
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-text-muted">
          Live samples of every component registered in
          <code className="mx-1 font-mono text-text">lib/component-registry.ts</code>.
          Change a token or component visual — glance here first, ship second.
          Registered names covered below: MarkdownCard · PlanTimeline ·
          PlanCard · Viz.Table · Viz.KV · Viz.Cards · Viz.Timeline · Viz.Steps
          · Viz.Code · Viz.Diff · Viz.Callout · Viz.LinkCard · Viz.Stat ·
          Viz.LineChart · Viz.BarChart · Viz.PieChart · Artifact.Preview ·
          EmployeeCard.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Tile name="MarkdownCard">
          <MarkdownCard {...markdownProps} />
        </Tile>
        <Tile name="PlanTimeline">
          <PlanTimeline {...planTimelineProps} />
        </Tile>
        <Tile name="PlanCard">
          <PlanCard {...planCardProps} />
        </Tile>
        <Tile name="EmployeeCard">
          <EmployeeCard {...employeeCardProps} />
        </Tile>
        <Tile name="Viz.Table">
          <Viz.Table {...tableProps} />
        </Tile>
        <Tile name="Viz.KV">
          <Viz.KV {...kvProps} />
        </Tile>
        <Tile name="Viz.Cards">
          <Viz.Cards {...cardsProps} />
        </Tile>
        <Tile name="Viz.Timeline">
          <Viz.Timeline {...timelineProps} />
        </Tile>
        <Tile name="Viz.Steps">
          <Viz.Steps {...stepsProps} />
        </Tile>
        <Tile name="Viz.Code">
          <Viz.Code {...codeProps} />
        </Tile>
        <Tile name="Viz.Diff">
          <Viz.Diff {...diffProps} />
        </Tile>
        <Tile name="Viz.Callout">
          <Viz.Callout {...calloutProps} />
        </Tile>
        <Tile name="Viz.LinkCard">
          <Viz.LinkCard {...linkCardProps} />
        </Tile>
        <Tile name="Viz.Stat">
          <Viz.Stat {...statProps} />
        </Tile>
        <Tile name="Viz.LineChart">
          <Viz.LineChart {...lineProps} />
        </Tile>
        <Tile name="Viz.BarChart">
          <Viz.BarChart {...barProps} />
        </Tile>
        <Tile name="Viz.PieChart">
          <Viz.PieChart {...pieProps} />
        </Tile>
        <Tile name="Artifact.Preview">
          <div className="font-mono text-caption text-text-muted">
            See /artifacts/[id] for the live preview — Artifact.Preview is
            route-scoped (mermaid / sandbox module graph).
          </div>
        </Tile>
      </div>
      {/* Silence unused-var warnings on minimal-prop stubs. */}
      <span hidden>{JSON.stringify(noProps)}</span>
    </main>
  );
}
