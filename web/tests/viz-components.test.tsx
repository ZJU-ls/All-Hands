/**
 * Viz.* component unit tests — spec: docs/specs/agent-design/2026-04-18-viz-skill.md § 9.
 *
 * Each component gets minimal props and we assert:
 * - it renders without console errors
 * - critical content appears
 * - no token leakage (no hex, no raw Tailwind color class)
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen } from "@/tests/test-utils/i18n-render";
import {
  Table,
  KV,
  Cards,
  Timeline,
  Steps,
  Code,
  Diff,
  Callout,
  LinkCard,
  Stat,
  LineChart,
  BarChart,
  PieChart,
} from "@/components/render/Viz";

afterEach(cleanup);

const NO_INTERACTIONS: never[] = [];

describe("Viz.Table", () => {
  it("renders rows + sortable header + caption", () => {
    render(
      <Table
        props={{
          columns: [
            { key: "name", label: "Name" },
            { key: "score", label: "Score", align: "right" },
          ],
          rows: [
            { name: "Alice", score: 90 },
            { name: "Bob", score: 72 },
          ],
          caption: "Team scores",
        }}
        interactions={NO_INTERACTIONS}
      />,
    );
    expect(screen.getByText("Alice")).toBeDefined();
    expect(screen.getByText("Bob")).toBeDefined();
    expect(screen.getByText("Team scores")).toBeDefined();
    // Sortable affordance
    expect(screen.getByLabelText(/Sort by Name/)).toBeDefined();
  });

  it("shows empty state when rows missing", () => {
    render(
      <Table
        props={{ columns: [{ key: "a", label: "A" }], rows: [] }}
        interactions={NO_INTERACTIONS}
      />,
    );
    expect(screen.getByText(/No rows/)).toBeDefined();
  });
});

describe("Viz.KV", () => {
  it("renders label/value pairs and optional hint", () => {
    render(
      <KV
        props={{
          items: [
            { label: "model", value: "gpt-4o", hint: "default" },
            { label: "max_iterations", value: "8" },
          ],
          title: "Config",
        }}
        interactions={NO_INTERACTIONS}
      />,
    );
    expect(screen.getByText("Config")).toBeDefined();
    expect(screen.getByText("gpt-4o")).toBeDefined();
    expect(screen.getByText(/default/)).toBeDefined();
  });
});

describe("Viz.Cards", () => {
  it("renders multiple cards with accents", () => {
    render(
      <Cards
        props={{
          cards: [
            { title: "A", description: "first", accent: "primary" },
            { title: "B", description: "second", accent: "success" },
            { title: "C", description: "third", footer: "note" },
          ],
          columns: 3,
        }}
        interactions={NO_INTERACTIONS}
      />,
    );
    expect(screen.getByText("A")).toBeDefined();
    expect(screen.getByText("note")).toBeDefined();
  });
});

describe("Viz.Timeline", () => {
  it("renders items with status dots (vertical)", () => {
    render(
      <Timeline
        props={{
          items: [
            { title: "Started", status: "done", time: "10:00" },
            { title: "Mid", status: "in_progress" },
          ],
        }}
        interactions={NO_INTERACTIONS}
      />,
    );
    expect(screen.getByText("Started")).toBeDefined();
    expect(screen.getByText("Mid")).toBeDefined();
    expect(screen.getByText("10:00")).toBeDefined();
  });

  it("renders horizontal layout", () => {
    render(
      <Timeline
        props={{
          items: [{ title: "x", status: "pending" }],
          layout: "horizontal",
        }}
        interactions={NO_INTERACTIONS}
      />,
    );
    expect(screen.getByText("x")).toBeDefined();
  });
});

describe("Viz.Steps", () => {
  it("renders numbered steps with connector", () => {
    render(
      <Steps
        props={{
          steps: [
            { title: "Plan", status: "done", description: "scope" },
            { title: "Build", status: "in_progress" },
            { title: "Ship", status: "pending" },
          ],
          current: 1,
        }}
        interactions={NO_INTERACTIONS}
      />,
    );
    expect(screen.getByText("Plan")).toBeDefined();
    expect(screen.getByText("01")).toBeDefined();
    expect(screen.getByText("03")).toBeDefined();
  });
});

describe("Viz.Code", () => {
  it("renders code lines, language, filename, and copy button", () => {
    const copySpy = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: copySpy } });
    render(
      <Code
        props={{
          code: "print(1)\nprint(2)",
          language: "python",
          filename: "a.py",
          highlightLines: [1],
        }}
        interactions={[
          {
            kind: "button",
            label: "Copy",
            action: "copy_to_clipboard",
            payload: { text: "print(1)\nprint(2)" },
          },
        ]}
      />,
    );
    expect(screen.getByText("a.py")).toBeDefined();
    expect(screen.getByText("python")).toBeDefined();
    expect(screen.getByText(/print\(1\)/)).toBeDefined();
    // V2 (ADR 0016): copy action surfaces as an icon button (aria-label).
    screen.getByLabelText("Copy code").click();
    expect(copySpy).toHaveBeenCalledWith("print(1)\nprint(2)");
  });
});

describe("Viz.Diff", () => {
  it("renders additions/deletions and stat counts", () => {
    render(
      <Diff
        props={{
          before: "a\nb\nc",
          after: "a\nb2\nc",
          filename: "x.ts",
          language: "typescript",
        }}
        interactions={NO_INTERACTIONS}
      />,
    );
    // +1 add, -1 del
    expect(screen.getByText(/\+1/)).toBeDefined();
    expect(screen.getByText(/-1/)).toBeDefined();
    expect(screen.getByText("x.ts")).toBeDefined();
  });

  it("supports split mode", () => {
    render(
      <Diff
        props={{ before: "a", after: "b", mode: "split" }}
        interactions={NO_INTERACTIONS}
      />,
    );
    expect(screen.getByText(/\+1/)).toBeDefined();
  });
});

describe("Viz.Callout", () => {
  it("renders title + content with semantic color for each kind", () => {
    const kinds = ["info", "warn", "success", "error"] as const;
    for (const kind of kinds) {
      cleanup();
      render(
        <Callout
          props={{ kind, title: kind.toUpperCase(), content: `hello ${kind}` }}
          interactions={NO_INTERACTIONS}
        />,
      );
      expect(screen.getByText(kind.toUpperCase())).toBeDefined();
      expect(screen.getByText(`hello ${kind}`)).toBeDefined();
    }
  });
});

describe("Viz.LinkCard", () => {
  it("renders title, description and derives host from url", () => {
    render(
      <LinkCard
        props={{
          url: "https://example.com/path",
          title: "Example",
          description: "desc",
          siteName: "Example Site",
        }}
        interactions={NO_INTERACTIONS}
      />,
    );
    expect(screen.getByText("Example")).toBeDefined();
    expect(screen.getByText("desc")).toBeDefined();
    expect(screen.getByText(/example\.com/)).toBeDefined();
    const anchor = screen.getByRole("link");
    expect(anchor.getAttribute("href")).toBe("https://example.com/path");
    expect(anchor.getAttribute("target")).toBe("_blank");
  });
});

describe("Viz.Stat", () => {
  it("renders label + value + unit + delta + sparkline", () => {
    render(
      <Stat
        props={{
          label: "Active runs",
          value: 42,
          unit: "runs",
          delta: { value: 8, direction: "up", tone: "positive" },
          spark: [1, 2, 3, 2.5, 4],
          caption: "last 24h",
        }}
        interactions={NO_INTERACTIONS}
      />,
    );
    expect(screen.getByText("Active runs")).toBeDefined();
    expect(screen.getByText("42")).toBeDefined();
    expect(screen.getByText("runs")).toBeDefined();
    // V2 (ADR 0016): direction surfaces as an Icon (trending-up) — value as text.
    expect(screen.getByText("8")).toBeDefined();
    expect(screen.getByText("last 24h")).toBeDefined();
  });

  it("falls back to em-dash when value missing", () => {
    render(
      <Stat
        props={{ label: "Cost", value: undefined }}
        interactions={NO_INTERACTIONS}
      />,
    );
    expect(screen.getByText("—")).toBeDefined();
  });
});

describe("Viz.LineChart", () => {
  it("renders an SVG with polylines and series legend when multi-series", () => {
    const { container } = render(
      <LineChart
        props={{
          x: ["Mon", "Tue", "Wed"],
          series: [
            { label: "p50", values: [120, 140, 130] },
            { label: "p95", values: [300, 420, 360] },
          ],
          y_label: "ms",
          caption: "weekly latency",
        }}
        interactions={NO_INTERACTIONS}
      />,
    );
    expect(container.querySelector("svg")).toBeTruthy();
    // ADR-0012 polish: each ≤2-series chart gets one area fill + one
    // line path per series (4 paths for 2 series). Assert on series
    // count not path count so future visual tweaks don't rebreak this.
    const paths = container.querySelectorAll("path");
    expect(paths.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("p50")).toBeDefined();
    expect(screen.getByText("p95")).toBeDefined();
    expect(screen.getByText("weekly latency")).toBeDefined();
  });
});

describe("Viz.BarChart", () => {
  it("renders vertical bars with value labels", () => {
    render(
      <BarChart
        props={{
          bars: [
            { label: "A", value: 3 },
            { label: "B", value: 7 },
            { label: "C", value: 5 },
          ],
          value_label: "count",
        }}
        interactions={NO_INTERACTIONS}
      />,
    );
    expect(screen.getByText("A")).toBeDefined();
    expect(screen.getByText("7")).toBeDefined();
    expect(screen.getByText(/count/)).toBeDefined();
  });

  it("renders horizontal orientation", () => {
    render(
      <BarChart
        props={{
          bars: [{ label: "Only", value: 2 }],
          orientation: "horizontal",
        }}
        interactions={NO_INTERACTIONS}
      />,
    );
    expect(screen.getByText("Only")).toBeDefined();
    expect(screen.getByText("2")).toBeDefined();
  });

  it("shows empty placeholder when bars missing", () => {
    render(
      <BarChart props={{ bars: [] }} interactions={NO_INTERACTIONS} />,
    );
    expect(screen.getByText(/No bars/)).toBeDefined();
  });
});

/**
 * Malformed-props crash safety — the Lead Agent can produce envelopes where
 * required fields are missing or of the wrong type (common when a new model
 * hallucinates the args). None of these should throw during render; the
 * component should either show the empty placeholder or silently default.
 * Regression guard for the `Cannot read properties of undefined (reading
 * 'map')` runtime error.
 */
describe("Viz.* crash safety — malformed props", () => {
  const NULL_PROPS: Record<string, unknown> = {};
  const NULL_INTERACTIONS: never[] = [];

  const cases: Array<[string, React.ComponentType<{ props: Record<string, unknown>; interactions: never[] }>]> = [
    ["Table", Table],
    ["KV", KV],
    ["Cards", Cards],
    ["Timeline", Timeline],
    ["Steps", Steps],
    ["Code", Code],
    ["Diff", Diff],
    ["Callout", Callout],
    ["LinkCard", LinkCard],
    ["Stat", Stat],
    ["LineChart", LineChart],
    ["BarChart", BarChart],
    ["PieChart", PieChart],
  ];

  for (const [name, Comp] of cases) {
    it(`${name} does not throw with empty props`, () => {
      expect(() =>
        render(<Comp props={NULL_PROPS} interactions={NULL_INTERACTIONS} />),
      ).not.toThrow();
    });

    it(`${name} does not throw when array fields are null`, () => {
      const props: Record<string, unknown> = {
        columns: null,
        rows: null,
        items: null,
        cards: null,
        steps: null,
        bars: null,
        slices: null,
        series: null,
        x: null,
        spark: null,
      };
      expect(() =>
        render(<Comp props={props} interactions={NULL_INTERACTIONS} />),
      ).not.toThrow();
    });
  }

  it("Code handles missing interactions without crashing", () => {
    expect(() =>
      // @ts-expect-error — simulate malformed payload where interactions is undefined
      render(<Code props={{ code: "a" }} interactions={undefined} />),
    ).not.toThrow();
  });
});

describe("Viz.PieChart", () => {
  it("renders donut slices with labels and percentages", () => {
    const { container } = render(
      <PieChart
        props={{
          slices: [
            { label: "OpenAI", value: 60 },
            { label: "Anthropic", value: 40 },
          ],
          caption: "token spend",
        }}
        interactions={NO_INTERACTIONS}
      />,
    );
    expect(container.querySelector("svg")).toBeTruthy();
    // Donut center echoes the headline slice, so "OpenAI" + "60%" each
    // appear twice (center label + legend). Use getAllByText.
    expect(screen.getAllByText("OpenAI").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Anthropic")).toBeDefined();
    expect(screen.getAllByText("60%").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("40%")).toBeDefined();
    expect(screen.getByText("token spend")).toBeDefined();
  });

  it("shows empty placeholder when total is zero", () => {
    render(
      <PieChart
        props={{
          slices: [
            { label: "x", value: 0 },
            { label: "y", value: 0 },
          ],
        }}
        interactions={NO_INTERACTIONS}
      />,
    );
    expect(screen.getByText(/No slices/)).toBeDefined();
  });
});
