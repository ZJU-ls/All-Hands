import { describe, expect, it } from "vitest";
import { computePopoverSide } from "../popover-placement";

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
