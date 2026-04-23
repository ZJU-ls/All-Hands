"use client";

/**
 * DotGridAvatar · text-only tile with dot-grid background.
 *
 * Linear Precise compliant (product/03-visual-design.md §3.5):
 *   - 图形信息只从排版 + 点阵 logo + token 颜色得到
 *   - 没有第三方 icon 库,没有图片
 *   - 颜色只走 token(bg-surface-2 · border-border · text-text · text-subtle)
 *
 * Used by: EmployeeCard (chat render), gateway ProviderSection + ModelRow.
 * Differentiation comes from the mono initials, not colour, so we stay inside
 * the §3.5 "颜色密度 ≤ 3" guard without hashing providers to tones.
 */

const SIZE_CLASS: Record<Size, string> = {
  sm: "w-5 h-5 text-[10px] rounded-sm",
  md: "w-7 h-7 text-[11px] rounded-md",
  lg: "w-10 h-10 text-[13px] rounded-lg",
};

const DOT_SIZE: Record<Size, string> = {
  sm: "3px 3px",
  md: "4px 4px",
  lg: "5px 5px",
};

type Size = "sm" | "md" | "lg";

export function DotGridAvatar({
  initial,
  size = "md",
  testId,
}: {
  initial: string;
  size?: Size;
  testId?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-testid={testId}
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden border border-border bg-surface-2 font-mono text-text ${SIZE_CLASS[size]}`}
    >
      {/* dot grid · primary-muted fades into text-subtle for a calm depth cue */}
      <span
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "radial-gradient(var(--color-text-subtle) 0.5px, transparent 0.5px)",
          backgroundSize: DOT_SIZE[size],
        }}
      />
      <span
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 30% 20%, var(--color-primary-muted), transparent 65%)",
          opacity: 0.9,
        }}
      />
      <span className="relative z-[1]">{initial}</span>
    </span>
  );
}

/**
 * Derive an avatar initial from a human-readable name.
 *
 * Rules:
 *   - override wins if provided (caller may supply a domain-specific label)
 *   - uppercased; drops whitespace; keeps at most 2 chars
 *   - words split on space / dash / slash / dot → take first char of each (up
 *     to two): "OpenRouter" → "OR"; "百炼" → "百"; "deepseek-chat" → "DC"
 */
export function initialFromName(name: string, override?: string): string {
  if (override && override.trim()) {
    return override.trim().slice(0, 2).toUpperCase();
  }
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "?";
  const words = trimmed.split(/[\s\-_/.]+/).filter(Boolean);
  if (words.length >= 2) {
    const first = words[0]?.[0] ?? "";
    const second = words[1]?.[0] ?? "";
    return (first + second).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}
