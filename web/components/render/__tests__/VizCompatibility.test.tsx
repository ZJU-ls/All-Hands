import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Stat } from "../Viz/Stat";
import { LineChart } from "../Viz/LineChart";

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
});
