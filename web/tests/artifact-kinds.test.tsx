/**
 * Artifact kind views unit tests — spec § 11 (artifacts-skill).
 *
 * Each view renders its kind of content without console errors. MermaidView
 * loads mermaid lazily so we stub the dynamic import.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@/tests/test-utils/i18n-render";

import { MarkdownView } from "@/components/artifacts/kinds/MarkdownView";
import { CodeView } from "@/components/artifacts/kinds/CodeView";
import { HtmlView } from "@/components/artifacts/kinds/HtmlView";
import { ImageView } from "@/components/artifacts/kinds/ImageView";
import { DataView } from "@/components/artifacts/kinds/DataView";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MarkdownView", () => {
  it("renders markdown text through marked", async () => {
    const { container } = render(<MarkdownView content={"# Hello\n\nworld"} />);
    await waitFor(() => {
      expect(container.querySelector("h1")?.textContent).toContain("Hello");
    });
  });
});

describe("CodeView", () => {
  it("renders code with line numbers and language label", () => {
    render(<CodeView content={"print(1)\nprint(2)"} language="python" />);
    expect(screen.getByText("python")).toBeDefined();
    expect(screen.getByText(/print\(1\)/)).toBeDefined();
    expect(screen.getByText("2")).toBeDefined();
  });
});

describe("HtmlView", () => {
  it("renders sandboxed iframe with srcDoc", () => {
    render(<HtmlView content="<p>hi</p>" />);
    const frame = document.querySelector("iframe");
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute("sandbox")).toBe("");
    expect(frame?.getAttribute("srcdoc")).toBe("<p>hi</p>");
  });
});

describe("ImageView", () => {
  it("renders an img tag with src + alt", () => {
    render(<ImageView src="https://example/a.png" alt="logo" />);
    const img = screen.getByRole("img") as HTMLImageElement;
    expect(img.src).toContain("a.png");
    expect(img.alt).toBe("logo");
  });
});

describe("DataView", () => {
  it("renders row-array JSON as a table", () => {
    render(
      <DataView
        content={JSON.stringify([
          { name: "alice", score: 90 },
          { name: "bob", score: 72 },
        ])}
      />,
    );
    expect(screen.getByText("alice")).toBeDefined();
    expect(screen.getByText("bob")).toBeDefined();
  });

  it("renders scalar JSON as raw block", () => {
    render(<DataView content='"hello"' />);
    expect(screen.getByText(/hello/)).toBeDefined();
  });

  it("falls back to raw string when not JSON", () => {
    render(<DataView content="not,json,csv" />);
    expect(screen.getByText(/not,json,csv/)).toBeDefined();
  });
});
