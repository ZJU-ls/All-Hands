/**
 * I-0012 regression · design-lab must host a live sample for every
 * render-tool component registered in component-registry.ts.
 *
 * We scan the source of web/app/design-lab/page.tsx (not the rendered DOM) so
 * the check stays static: no jsdom, no dynamic registry import ordering
 * traps. The contract is "the file mentions the component by its React
 * element name", which is what human reviewers scan for.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DESIGN_LAB = resolve(__dirname, "../app/design-lab/page.tsx");

// Source of truth: component-registry.ts registers these. Keep in lockstep.
// For Viz.Table / Viz.KV etc we import the bare member name (Table / KV)
// in design-lab, so the check accepts either the dotted registry key OR
// the bare import name.
const REGISTERED = [
  { key: "MarkdownCard", aliases: ["MarkdownCard"] },
  { key: "PlanTimeline", aliases: ["PlanTimeline"] },
  { key: "PlanCard", aliases: ["PlanCard"] },
  { key: "Viz.Table", aliases: ["Viz.Table", "<Table"] },
  { key: "Viz.KV", aliases: ["Viz.KV", "<KV"] },
  { key: "Viz.Cards", aliases: ["Viz.Cards", "<Cards"] },
  { key: "Viz.Timeline", aliases: ["Viz.Timeline", "<Timeline"] },
  { key: "Viz.Steps", aliases: ["Viz.Steps", "<Steps"] },
  { key: "Viz.Code", aliases: ["Viz.Code", "<Code"] },
  { key: "Viz.Diff", aliases: ["Viz.Diff", "<Diff"] },
  { key: "Viz.Callout", aliases: ["Viz.Callout", "<Callout"] },
  { key: "Viz.LinkCard", aliases: ["Viz.LinkCard", "<LinkCard"] },
  { key: "Artifact.Preview", aliases: ["Artifact.Preview", "ArtifactPreview"] },
  { key: "EmployeeCard", aliases: ["EmployeeCard"] },
];

describe("I-0012 · design-lab render library coverage", () => {
  const src = readFileSync(DESIGN_LAB, "utf8");

  for (const { key, aliases } of REGISTERED) {
    it(`hosts a live sample for ${key}`, () => {
      const hit = aliases.some((a) => src.includes(a));
      expect(
        hit,
        `design-lab/page.tsx must mention ${key} (tried: ${aliases.join(
          ", ",
        )}). See I-0012.`,
      ).toBe(true);
    });
  }
});
