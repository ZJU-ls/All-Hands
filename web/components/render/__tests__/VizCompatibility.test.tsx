import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Stat } from "../Viz/Stat";
import { LineChart } from "../Viz/LineChart";
import { BarChart } from "../Viz/BarChart";

describe("Viz compatibility", () => {
  it("Stat accepts stringified delta with trend alias", () => {
    render(
      <Stat
        props={{
          label: "今日 Token 消耗",
          value: "128450",
          unit: "tokens",
          delta: '{"value":12,"trend":"up"}',
        }}
        interactions={[]}
      />,
    );

    expect(screen.getByText("今日 Token 消耗")).toBeInTheDocument();
    expect(screen.getByText("128450")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("LineChart renders series values passed as strings via data alias", () => {
    const { container } = render(
      <LineChart
        props={{
          x: ["Mon", "Tue", "Wed"],
          series: [
            { label: "p50", data: ["120", "140", "130"] },
            { label: "p95", points: [{ y: "300" }, { y: "420" }, { y: "360" }] },
          ],
        }}
        interactions={[]}
      />,
    );

    expect(screen.queryByText("No series")).toBeNull();
    expect(container.querySelector('path[d]')).not.toBeNull();
    expect(screen.getByText("p50")).toBeInTheDocument();
    expect(screen.getByText("p95")).toBeInTheDocument();
  });

  it("BarChart renders bars with distinct heights when values arrive as numeric strings", () => {
    // Regression: LLMs sometimes send bar values as "12" instead of 12. The
    // strict `typeof === "number"` filter used to collapse every bar to
    // value=0, so maxVal=0 → pct=0 → no visible bars (just colored 2px lines
    // from `minHeight` fallback) — the "same height / missing bars" bug the
    // user reported. After the fix, numeric strings are coerced, so bars
    // render at correct relative heights.
    const { container } = render(
      <BarChart
        props={{
          bars: [
            { label: "A", value: "12" },
            { label: "B", value: "6" },
            { label: "C", value: "3" },
          ],
        }}
        interactions={[]}
      />,
    );

    expect(screen.queryByText("No bars")).toBeNull();
    // Each bar value is rendered as a <div> label above the bar; assert
    // all three numeric labels are present.
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    // And at least one bar element has a non-zero height (pct > 0). The
    // bar divs carry inline `height: <n>%` styles; we pull them off the DOM.
    const bars = Array.from(
      container.querySelectorAll<HTMLDivElement>("div[style*='height']"),
    );
    const heights = bars
      .map((el) => el.style.height)
      .filter((h) => h.endsWith("%"));
    expect(heights.length).toBeGreaterThan(0);
    // Biggest bar (value 12) is 100%; smallest (value 3) is 25%. Pre-fix
    // they'd all have been 0%.
    expect(heights).toContain("100%");
    expect(heights.some((h) => h !== "100%" && h !== "0%")).toBe(true);
  });
});
