import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { DotGridAvatar, initialFromName } from "../DotGridAvatar";

describe("initialFromName", () => {
  it("uppercases override and caps at 2 chars", () => {
    expect(initialFromName("ignored", "bai")).toBe("BA");
    expect(initialFromName("ignored", "x")).toBe("X");
  });

  it("splits multi-word names on space/dash/slash/dot", () => {
    expect(initialFromName("OpenRouter Labs")).toBe("OL");
    expect(initialFromName("deepseek-chat")).toBe("DC");
    expect(initialFromName("anthropic/claude-3.5-sonnet")).toBe("AC");
  });

  it("falls back to first two chars for single-word names", () => {
    expect(initialFromName("Bailian")).toBe("BA");
    expect(initialFromName("q")).toBe("Q");
  });

  it("keeps CJK glyphs intact", () => {
    expect(initialFromName("百炼")).toBe("百炼");
    expect(initialFromName("智谱 AI")).toBe("智A");
  });

  it("returns '?' for empty input without override", () => {
    expect(initialFromName("")).toBe("?");
    expect(initialFromName("   ")).toBe("?");
  });
});

describe("<DotGridAvatar />", () => {
  it("renders the initial once (dot-grid overlay is aria-hidden)", () => {
    const { getByText } = render(<DotGridAvatar initial="BA" />);
    expect(getByText("BA")).toBeTruthy();
  });

  it("only emits token-backed classes (Linear Precise §3.5)", () => {
    const { container } = render(<DotGridAvatar initial="OR" />);
    const cls = container.firstElementChild?.className ?? "";
    expect(cls).toContain("bg-surface-2");
    expect(cls).toContain("border-border");
    expect(cls).toContain("text-text");
    expect(cls).not.toMatch(/bg-(zinc|slate|blue|red|green|amber|yellow)-\d+/);
    expect(cls).not.toMatch(/text-(zinc|slate|blue|red|green|amber|yellow)-\d+/);
  });

  it("supports sm / md / lg size via tailwind classes", () => {
    const { container: sm } = render(<DotGridAvatar initial="A" size="sm" />);
    const { container: lg } = render(<DotGridAvatar initial="A" size="lg" />);
    expect(sm.firstElementChild?.className).toContain("w-5");
    expect(lg.firstElementChild?.className).toContain("w-10");
  });
});
