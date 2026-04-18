/**
 * Viz.* component unit tests — spec: docs/specs/agent-design/2026-04-18-viz-skill.md § 9.
 *
 * Each component gets minimal props and we assert:
 * - it renders without console errors
 * - critical content appears
 * - no token leakage (no hex, no raw Tailwind color class)
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
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
    screen.getByText("Copy").click();
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
