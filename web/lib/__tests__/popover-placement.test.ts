import { describe, expect, it } from "vitest";
import {
  computePopoverAlign,
  computePopoverSide,
} from "../popover-placement";

const VIEWPORT = 800;

describe("computePopoverSide", () => {
  it("keeps preferred bottom when there is room", () => {
    const rect = { top: 100, bottom: 140 };
    const side = computePopoverSide(rect, 300, VIEWPORT, "bottom");
    // 660 below, 100 above — plenty of room below
    expect(side).toBe("bottom");
  });

  it("flips to top when bottom is too cramped and top has more room", () => {
    const rect = { top: 600, bottom: 640 };
    // 160 below, 600 above — panel needs 300, flip up
    const side = computePopoverSide(rect, 300, VIEWPORT, "bottom");
    expect(side).toBe("top");
  });

  it("sticks with preferred side when both sides are cramped", () => {
    const rect = { top: 50, bottom: 90 };
    const viewport = 200;
    // 110 below, 50 above — neither fits 300, but below is still more
    const side = computePopoverSide(rect, 300, viewport, "bottom");
    expect(side).toBe("bottom");
  });

  it("keeps preferred top when there is room above", () => {
    const rect = { top: 500, bottom: 540 };
    const side = computePopoverSide(rect, 300, VIEWPORT, "top");
    expect(side).toBe("top");
  });

  it("flips to bottom when top is cramped and bottom has room (preferred=top)", () => {
    const rect = { top: 100, bottom: 140 };
    // 100 above, 660 below — panel needs 300, flip down
    const side = computePopoverSide(rect, 300, VIEWPORT, "top");
    expect(side).toBe("bottom");
  });

  it("treats exactly-equal space as fitting the preferred side", () => {
    const rect = { top: 100, bottom: 500 };
    // 300 below, 100 above — fits exactly below
    const side = computePopoverSide(rect, 300, VIEWPORT, "bottom");
    expect(side).toBe("bottom");
  });
});

const VIEWPORT_W = 1200;

describe("computePopoverAlign", () => {
  it("keeps preferred start when panel fits within viewport right", () => {
    const rect = { left: 100, right: 140 };
    // start → [100, 340]; fits within 1200.
    expect(computePopoverAlign(rect, 240, VIEWPORT_W, "start")).toBe("start");
  });

  it("flips start→end when start overflows right and end fits", () => {
    const rect = { left: 1050, right: 1100 };
    // start → [1050, 1290] overflows 1200.
    // end   → [860, 1100] fits.
    expect(computePopoverAlign(rect, 240, VIEWPORT_W, "start")).toBe("end");
  });

  it("keeps preferred end when panel fits", () => {
    const rect = { left: 900, right: 960 };
    // end → [720, 960] fits within 1200.
    expect(computePopoverAlign(rect, 240, VIEWPORT_W, "end")).toBe("end");
  });

  it("flips end→start when end overflows left (ModelOverrideChip case)", () => {
    const rect = { left: 80, right: 140 };
    // end   → [-100, 140] overflows left (chip too close to sidebar edge).
    // start → [80, 320] fits.
    expect(computePopoverAlign(rect, 240, VIEWPORT_W, "end")).toBe("start");
  });

  it("sticks with preferred when both sides overflow", () => {
    const rect = { left: 50, right: 90 };
    const vw = 100; // artificially tight viewport
    // start → [50, 290] overflows right (290 > 100)
    // end   → [-150, 90] overflows left (-150 < 0)
    // preferred wins.
    expect(computePopoverAlign(rect, 240, vw, "end")).toBe("end");
    expect(computePopoverAlign(rect, 240, vw, "start")).toBe("start");
  });
});
