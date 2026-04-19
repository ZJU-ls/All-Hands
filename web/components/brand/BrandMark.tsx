"use client";

/**
 * BrandMark · mono brand logo for providers + models.
 *
 * Linear Precise compliant (product/03-visual-design.md §3.5):
 *   - Glyphs are rendered via CSS `mask-image` over `background-color: currentColor`,
 *     so every logo inherits the surrounding text token color. No independent
 *     color is introduced for the brand.
 *   - Source SVGs live in /public/brand/*.svg (vendored from @lobehub/icons-static-svg,
 *     MIT). We only ship the mono variants (no `-color`, no `-text`).
 *   - When no brand can be resolved, we fall back to DotGridAvatar so the row
 *     keeps its rhythm instead of showing an empty box.
 *
 * Why mask-image not <img>: <img src="/brand/x.svg"> ignores currentColor. Using
 * the SVG as a mask lets bg-current paint the shape in the active text token,
 * keeping the whole Gateway page inside the §3.5 "颜色密度 ≤ 3" guard while
 * still being recognisably OpenAI / Qwen / etc.
 */

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
  return (
    <span
      role="img"
      aria-label={label}
      data-testid={testId ?? `brand-mark-${slug}`}
      data-brand={slug}
      className={`inline-block shrink-0 bg-current text-text-muted ${className}`}
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
