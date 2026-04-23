import type { Config } from "tailwindcss";

// Design tokens mirror product/03-visual-design.md (see ADR 0016).
// All colors are CSS vars so theme switching + pack extension stay a
// single source of truth. Never write hex inline in JSX.
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Surfaces + text + border
        bg: "var(--color-bg)",
        surface: "var(--color-surface)",
        "surface-2": "var(--color-surface-2)",
        "surface-3": "var(--color-surface-3)",
        "surface-4": "var(--color-surface-4)",
        "surface-hover": "var(--color-surface-hover)",
        border: "var(--color-border)",
        "border-strong": "var(--color-border-strong)",
        text: "var(--color-text)",
        "text-muted": "var(--color-text-muted)",
        "text-subtle": "var(--color-text-subtle)",

        // Primary + accent (ADR 0016 D6)
        primary: "var(--color-primary)",
        "primary-hover": "var(--color-primary-hover)",
        "primary-fg": "var(--color-primary-fg)",
        "primary-muted": "var(--color-primary-muted)",
        "primary-glow": "var(--color-primary-glow)",
        "primary-soft": "var(--color-primary-soft)",
        accent: "var(--color-accent)",

        // Semantics
        success: "var(--color-success)",
        warning: "var(--color-warning)",
        danger: "var(--color-danger)",
        "success-soft": "var(--color-success-soft)",
        "warning-soft": "var(--color-warning-soft)",
        "danger-soft": "var(--color-danger-soft)",

        // Role (chat / trace speakers)
        "role-user":   "var(--color-role-user)",
        "role-lead":   "var(--color-role-lead)",
        "role-worker": "var(--color-role-worker)",
        "role-tool":   "var(--color-role-tool)",

        // Data-viz (ADR 0012) — stable ordering; charts cycle by index.
        "viz-1": "var(--color-viz-1)",
        "viz-2": "var(--color-viz-2)",
        "viz-3": "var(--color-viz-3)",
        "viz-4": "var(--color-viz-4)",
        "viz-5": "var(--color-viz-5)",
        "viz-6": "var(--color-viz-6)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        sm: "4px",
        DEFAULT: "6px",
        md: "8px",
        lg: "12px",
        xl: "16px",
        "2xl": "20px",
        "3xl": "24px",
      },
      // ADR 0013 type scale — 5-size modular at 1.25 ratio. Role-named.
      fontSize: {
        caption: ["var(--text-caption)", { lineHeight: "1.45" }],
        sm: ["var(--text-sm)", { lineHeight: "1.55" }],
        base: ["var(--text-base)", { lineHeight: "var(--leading-body)" }],
        lg: ["var(--text-lg)", { lineHeight: "var(--leading-heading)" }],
        xl: ["var(--text-xl)", { lineHeight: "var(--leading-heading)" }],
        display: ["var(--text-display)", { lineHeight: "1.1" }],
      },
      // Motion tokens — raw `duration-NNN` is discouraged; use names.
      transitionDuration: {
        fast: "var(--dur-fast)",
        base: "var(--dur-base)",
        mid: "var(--dur-mid)",
        slow: "var(--dur-slow)",
      },
      transitionTimingFunction: {
        out: "var(--ease-out)",
        "out-quart": "var(--ease-out-quart)",
        "out-expo": "var(--ease-out-expo)",
        "out-soft": "var(--ease-out-soft)",
      },
      // Shadow tokens — brand-blue pack defines "soft" (light-biased) and
      // "glow" (dark-biased) families. Both exist in both modes; the pack
      // tunes intensity so "glow" in light is a subtle ring, "soft" in
      // dark is an almost-black drop.
      boxShadow: {
        "soft-sm":        "var(--shadow-soft-sm)",
        soft:             "var(--shadow-soft)",
        "soft-lg":        "var(--shadow-soft-lg)",
        pop:              "var(--shadow-pop)",
        "glow-sm":        "var(--shadow-glow-sm)",
        glow:             "var(--shadow-glow)",
        "glow-lg":        "var(--shadow-glow-lg)",
        "inset-hairline": "var(--shadow-inset-hairline)",
      },
      // Keyframes mirror globals.css; Tailwind utility forms for convenience.
      keyframes: {
        "ah-spin":       { to: { transform: "rotate(360deg)" } },
        "ah-pulse":      { "0%, 100%": { opacity: "1", transform: "scale(1)" }, "50%": { opacity: "0.5", transform: "scale(0.92)" } },
        "ah-shimmer":    { "0%":   { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
        "ah-bar-in":     { from: { transform: "scaleY(0)" }, to: { transform: "scaleY(1)" } },
        "ah-fade-up":    { from: { opacity: "0", transform: "translateY(4px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        "ah-float":      { "0%, 100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-6px)" } },
        "ah-pulse-ring": { "0%": { boxShadow: "0 0 0 0 var(--color-primary-muted)" }, "80%": { boxShadow: "0 0 0 8px rgba(0,0,0,0)" }, "100%": { boxShadow: "0 0 0 0 rgba(0,0,0,0)" } },
      },
      animation: {
        "spin-slow":  "ah-spin 1.2s linear infinite",
        "pulse-soft": "ah-pulse 1.6s var(--ease-out) infinite",
        "shimmer":    "ah-shimmer 1.8s var(--ease-out) infinite",
        "bar-in":     "ah-bar-in 180ms var(--ease-out)",
        "fade-up":    "ah-fade-up 280ms var(--ease-out-expo)",
        "float":      "ah-float 6s var(--ease-out-soft) infinite",
        "pulse-ring": "ah-pulse-ring 1.6s var(--ease-out) infinite",
      },
    },
  },
  plugins: [],
};

export default config;
