"use client";

/**
 * BrandMark · provider / model brand glyph.
 *
 * Visual-contract scope (product/03-visual-design.md §3.5):
 *   Brand identity glyphs are the one carved-out exception to the
 *   "颜色密度 ≤ 3" rule — same way semantic state colors (success/warn/
 *   danger) don't count. Renders the vendor's own brand colors so
 *   provider/model recognition doesn't rely on reading the name at
 *   small sizes (Anthropic's rust-orange, DeepSeek's blue, Qwen's purple,
 *   etc. — this is product, not decoration). When no color asset exists
 *   (OpenAI ships a mono mark officially; OpenRouter likewise), we keep
 *   the mono SVG rendered at currentColor via mask-image so the row
 *   still reads as a brand and doesn't drop to an empty box.
 *
 * Sources:
 *   - Color variants vendored from @lobehub/icons-static-svg (MIT) as
 *     /public/brand/<slug>-color.svg — only for brands with an
 *     official color glyph.
 *   - Mono fallbacks at /public/brand/<slug>.svg — always present.
 *
 * Why an <img> for color, mask-image for mono: <img> preserves the
 * vendor-authored fill colors exactly. mask-image strips them and uses
 * currentColor, which is what we want for brands without a color mark
 * (so they tint with the surrounding text token and don't look faded
 * against a dark shell).
 */

import Image from "next/image";

import { DotGridAvatar, initialFromName } from "@/components/ui/DotGridAvatar";

export type BrandSlug =
  | "openai"
  | "anthropic"
  | "qwen"
  | "deepseek"
  | "moonshot"
  | "minimax"
  | "zhipu"
  | "openrouter"
  | "bailian";

const BRAND_LABEL: Record<BrandSlug, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  qwen: "Qwen",
  deepseek: "DeepSeek",
  moonshot: "Moonshot",
  minimax: "MiniMax",
  zhipu: "Zhipu",
  openrouter: "OpenRouter",
  bailian: "Bailian",
};

// Brands whose vendor ships an official color glyph. Keeps the set
// explicit so we fail loudly (fall back to mono) if a new slug is
// added without a corresponding /public/brand/<slug>-color.svg.
const HAS_COLOR_VARIANT: Record<BrandSlug, boolean> = {
  openai: false,
  anthropic: true,
  qwen: true,
  deepseek: true,
  moonshot: true,
  minimax: true,
  zhipu: true,
  openrouter: false,
  bailian: true,
};

/**
 * Resolve a BrandSlug from a provider kind and/or free-form name.
 *
 * Priority:
 *   1. Explicit provider `kind` — authoritative when present.
 *      - "openai"    → openai
 *      - "anthropic" → anthropic
 *      - "aliyun"    → qwen (DashScope is a Qwen-first host in practice)
 *   2. Name-based detection — for ModelRow where only the model name is known.
 *      Ordered so the most specific token wins first (e.g. "claude" before
 *      "anthropic" before generic "gpt"). Keeps CJK tokens too ("通义","智谱").
 *   3. null — caller falls back to DotGridAvatar initials.
 */
export function resolveBrand(
  kind: string | null | undefined,
  name: string | null | undefined,
): BrandSlug | null {
  const k = (kind ?? "").toLowerCase().trim();
  if (k === "openai") return "openai";
  if (k === "anthropic") return "anthropic";
  if (k === "aliyun") return "qwen";

  const n = (name ?? "").toLowerCase();
  if (!n) return null;

  if (/claude|anthropic/.test(n)) return "anthropic";
  if (/deepseek/.test(n)) return "deepseek";
  if (/kimi|moonshot/.test(n)) return "moonshot";
  if (/glm|zhipu|chatglm|智谱/.test(n)) return "zhipu";
  if (/minimax|\babab/.test(n)) return "minimax";
  if (/openrouter/.test(n)) return "openrouter";
  if (/bailian|dashscope|百炼/.test(n)) return "bailian";
  if (/qwen|qwq|tongyi|通义/.test(n)) return "qwen";
  if (/\bgpt\b|openai|o1-|o3-|o4-/.test(n)) return "openai";

  return null;
}

const SIZE_MAP = {
  sm: 16,
  md: 20,
  lg: 28,
} as const;

export type BrandSize = keyof typeof SIZE_MAP;

type Props = {
  kind?: string | null;
  name?: string | null;
  size?: BrandSize;
  /** When brand resolution fails, the initials come from this string (falls back to `name`). */
  fallbackName?: string;
  testId?: string;
  className?: string;
};

export function BrandMark({
  kind,
  name,
  size = "md",
  fallbackName,
  testId,
  className = "",
}: Props) {
  const slug = resolveBrand(kind, name);
  if (!slug) {
    const dotSize: "sm" | "md" | "lg" = size;
    return (
      <DotGridAvatar
        initial={initialFromName(fallbackName ?? name ?? "")}
        size={dotSize}
        testId={testId}
      />
    );
  }
  const px = SIZE_MAP[size];
  const label = BRAND_LABEL[slug];

  if (HAS_COLOR_VARIANT[slug]) {
    // Use next/image with unoptimized for SVG assets — we want them pixel-
    // perfect at small sizes, and SVG doesn't benefit from the image pipeline.
    return (
      <Image
        src={`/brand/${slug}-color.svg`}
        alt={label}
        width={px}
        height={px}
        unoptimized
        role="img"
        aria-label={label}
        data-testid={testId ?? `brand-mark-${slug}`}
        data-brand={slug}
        data-variant="color"
        className={`inline-block shrink-0 ${className}`}
      />
    );
  }

  // Mono fallback — vendor-mono SVG painted at currentColor via mask-image.
  return (
    <span
      role="img"
      aria-label={label}
      data-testid={testId ?? `brand-mark-${slug}`}
      data-brand={slug}
      data-variant="mono"
      className={`inline-block shrink-0 bg-current text-text ${className}`}
      style={{
        width: px,
        height: px,
        WebkitMaskImage: `url(/brand/${slug}.svg)`,
        maskImage: `url(/brand/${slug}.svg)`,
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
    />
  );
}
