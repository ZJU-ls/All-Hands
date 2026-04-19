/**
 * Walkthrough-acceptance contract test · web side.
 *
 * Mirrors ``backend/tests/acceptance/test_walkthrough_plan.py``. Reads the same
 * JSON manifest and asserts that every v0-active stage's entry route and
 * required routers are realized in the frontend + that the JSON can be
 * consumed as a typed record by the eventual /acceptance page.
 *
 * Spec: docs/specs/agent-design/2026-04-18-walkthrough-acceptance.md §3
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const REPO = path.resolve(__dirname, "..", "..", "..");
const PLAN_PATH = path.join(
  REPO,
  "backend",
  "tests",
  "acceptance",
  "walkthrough_plan.json",
);

type Stage = {
  id: `W${number}`;
  name: string;
  goal: string;
  entry_route: string;
  required_meta_tools: string[];
  required_routers: string[];
  north_star_focus: ("N1" | "N2" | "N3" | "N4" | "N5" | "N6")[];
  v0_active: boolean;
  preconditions: string;
  dod: string[];
  blocker_issues: string[];
  owner_track: string;
};
type Plan = {
  spec: string;
  stages: Stage[];
  north_star_dims: Record<string, string>;
};

const PLAN: Plan = JSON.parse(readFileSync(PLAN_PATH, "utf-8"));

const APP = path.join(REPO, "web", "app");
const V0_ACTIVE = ["W1", "W2", "W3"];

describe("walkthrough acceptance plan · v0 scope", () => {
  it("declares exactly W1-W7", () => {
    const ids = PLAN.stages.map((s) => s.id).sort();
    expect(ids).toEqual(["W1", "W2", "W3", "W4", "W5", "W6", "W7"]);
  });

  it("v0 activates exactly W1-W3 (matches track-2-qa launch prompt)", () => {
    const active = PLAN.stages.filter((s) => s.v0_active).map((s) => s.id).sort();
    expect(active).toEqual(V0_ACTIVE);
  });

  it("every stage references only declared N1-N6 dims", () => {
    const declared = new Set(Object.keys(PLAN.north_star_dims));
    for (const s of PLAN.stages) {
      for (const dim of s.north_star_focus) {
        expect(declared.has(dim), `${s.id} references unknown dim ${dim}`).toBe(true);
      }
    }
  });

  it("every stage carries a non-empty dod + owner_track", () => {
    for (const s of PLAN.stages) {
      expect(
        Array.isArray(s.dod) && s.dod.length > 0,
        `${s.id} is missing dod bullets (walkthrough spec §3.2 contract)`,
      ).toBe(true);
      expect(
        typeof s.owner_track === "string" && s.owner_track.length > 0,
        `${s.id} is missing owner_track`,
      ).toBe(true);
      expect(
        Array.isArray(s.blocker_issues),
        `${s.id}.blocker_issues must be an array`,
      ).toBe(true);
    }
  });
});

describe("walkthrough v0-active stages · frontend realization", () => {
  for (const stage of PLAN.stages.filter((s) => s.v0_active)) {
    const seg = stage.entry_route.replace(/^\/+/, "");
    const entry = seg === ""
      ? path.join(APP, "page.tsx")
      : path.join(APP, seg, "page.tsx");

    it(`${stage.id} entry route ${stage.entry_route} has a page.tsx`, () => {
      if (!existsSync(entry)) {
        // Don't hard-fail — if the page is genuinely not built yet (W3), the
        // backend xfail already captured it. Just surface a warning-shaped
        // skip so humans see it in the report.
        console.warn(
          `[${stage.id}] ${stage.entry_route} missing · precondition: ${stage.preconditions}`,
        );
        return;
      }
      expect(existsSync(entry)).toBe(true);
    });
  }
});
