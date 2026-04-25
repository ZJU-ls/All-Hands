/**
 * BrandMark · resolver priority + render-mode contract.
 *
 * Contract:
 *   - Explicit provider kind wins over any name-based guess.
 *   - aliyun kind surfaces the Qwen brand (DashScope hosts Qwen).
 *   - Model names route by the most specific token first
 *     (claude → anthropic, deepseek → deepseek, etc.).
 *   - Unknown → DotGridAvatar fallback with sensible initials.
 */

import { describe, it, expect } from "vitest";
import { render } from "@/tests/test-utils/i18n-render";

import { BrandMark, resolveBrand } from "../BrandMark";

describe("resolveBrand", () => {
  it("prefers explicit provider kind over name heuristics", () => {
    // Name would normally resolve to deepseek, but the authoritative kind wins.
    expect(resolveBrand("openai", "deepseek-chat")).toBe("openai");
    expect(resolveBrand("anthropic", "gpt-4o")).toBe("anthropic");
  });

  it("maps aliyun provider kind to qwen brand", () => {
    expect(resolveBrand("aliyun", "qwen-plus")).toBe("qwen");
    expect(resolveBrand("aliyun", "")).toBe("qwen");
  });

  it("detects brand from model name alone", () => {
    expect(resolveBrand(null, "claude-3-5-sonnet-latest")).toBe("anthropic");
    expect(resolveBrand(null, "anthropic/claude-3.5-sonnet")).toBe("anthropic");
    expect(resolveBrand(null, "deepseek-coder")).toBe("deepseek");
    expect(resolveBrand(null, "kimi-k2.5")).toBe("moonshot");
    expect(resolveBrand(null, "qwen-max")).toBe("qwen");
    expect(resolveBrand(null, "glm-5")).toBe("zhipu");
    expect(resolveBrand(null, "MiniMax-M2.5")).toBe("minimax");
    expect(resolveBrand(null, "openai/gpt-4o-mini")).toBe("openai");
  });

  it("returns null when nothing matches", () => {
    expect(resolveBrand(null, "unknown-model-xyz")).toBeNull();
    expect(resolveBrand("", "")).toBeNull();
    expect(resolveBrand(null, null)).toBeNull();
  });
});

describe("<BrandMark />", () => {
  it("renders a mask-based mono tile for a brand without a color asset", () => {
    // OpenAI / OpenRouter ship only a mono glyph officially; falling back to
    // mask-image keeps them on the surrounding text token rather than going
    // faded gray.
    const { getByRole } = render(<BrandMark kind="openai" name="openai" />);
    const el = getByRole("img");
    expect(el.getAttribute("data-brand")).toBe("openai");
    expect(el.getAttribute("data-variant")).toBe("mono");
    expect(el.getAttribute("aria-label")).toBe("OpenAI");
    const style = el.getAttribute("style") ?? "";
    expect(style).toContain("/brand/openai.svg");
  });

  it("renders the vendor-color asset for brands that ship one", () => {
    // Anthropic, Qwen, DeepSeek, Kimi, MiniMax, Zhipu, Bailian all ship an
    // official color mark. §3.5 exempts brand identity from the colour-
    // density rule, so we surface those straight rather than masking them.
    const { getByRole } = render(<BrandMark kind="anthropic" name="claude" />);
    const el = getByRole("img") as HTMLImageElement;
    expect(el.getAttribute("data-brand")).toBe("anthropic");
    expect(el.getAttribute("data-variant")).toBe("color");
    expect(el.getAttribute("aria-label")).toBe("Anthropic");
    // next/image may rewrite the src through its own pipeline, so match on
    // suffix rather than equality.
    expect(el.getAttribute("src") ?? "").toMatch(/anthropic-color\.svg/);
  });

  it("falls back to DotGridAvatar when brand cannot be resolved", () => {
    const { queryByRole, getByText } = render(
      <BrandMark kind={null} name="unknown-model-xyz" />,
    );
    // No img role → brand not rendered.
    expect(queryByRole("img")).toBeNull();
    // DotGridAvatar surfaces mono initials split on `-`: "unknown-model" → UM.
    expect(getByText("UM")).toBeDefined();
  });

  it("uses fallbackName for initials when brand is unknown", () => {
    const { getByText } = render(
      <BrandMark kind={null} name="unknown-xyz" fallbackName="Custom Provider" />,
    );
    expect(getByText("CP")).toBeDefined();
  });
});
