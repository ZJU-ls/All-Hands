/**
 * AgentMarkdown · shared marked-based renderer for assistant prose.
 *
 * The dialog / bubble surfaces used to show raw text with
 * whitespace-pre-wrap, which loses headings, lists, and code fences that
 * models routinely emit. This component restores real markdown rendering
 * everywhere an agent speaks.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

import { AgentMarkdown } from "../AgentMarkdown";

afterEach(cleanup);

describe("AgentMarkdown", () => {
  it("renders markdown headings and lists via marked", async () => {
    const { container } = render(
      <AgentMarkdown content={"# Title\n\n- one\n- two"} />,
    );
    await waitFor(() => {
      expect(container.querySelector("h1")?.textContent).toContain("Title");
      const items = container.querySelectorAll("li");
      expect(items.length).toBe(2);
    });
  });

  it("renders inline code and fenced blocks", async () => {
    const { container } = render(
      <AgentMarkdown
        content={"hello `inline` world\n\n```\nblock\n```"}
      />,
    );
    await waitFor(() => {
      expect(container.querySelector("code")?.textContent).toContain("inline");
      expect(container.querySelectorAll("pre").length).toBe(1);
    });
  });
});
