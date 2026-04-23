import type { Config } from "tailwindcss";

// Design tokens mirror product/03-visual-design.md.
// All colors are CSS vars so theme switching stays a single source of truth.
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
        bg: "var(--color-bg)",
        surface: "var(--color-surface)",
        "surface-2": "var(--color-surface-2)",
        "surface-3": "var(--color-surface-3)",
        border: "var(--color-border)",
        "border-strong": "var(--color-border-strong)",
        text: "var(--color-text)",
        "text-muted": "var(--color-text-muted)",
        "text-subtle": "var(--color-text-subtle)",
        primary: "var(--color-primary)",
        "primary-hover": "var(--color-primary-hover)",
        "primary-fg": "var(--color-primary-fg)",
        success: "var(--color-success)",
        warning: "var(--color-warning)",
        danger: "var(--color-danger)",
        // Data-viz palette (ADR 0012) — scoped to components/render/Viz/**
        // and chart surfaces. Keep ordering stable; charts cycle by index.
        "viz-1": "var(--color-viz-1)",
        "viz-2": "var(--color-viz-2)",
        "viz-3": "var(--color-viz-3)",
        "viz-4": "var(--color-viz-4)",
        "viz-5": "var(--color-viz-5)",
        "viz-6": "var(--color-viz-6)",
        // Translucent surface tints — bake alpha so call sites don't
        // compose opacity strings (keeps the JSX scannable).
        "surface-hover": "var(--color-surface-hover)",
        "primary-soft": "var(--color-primary-soft)",
        "success-soft": "var(--color-success-soft)",
        "warning-soft": "var(--color-warning-soft)",
        "danger-soft": "var(--color-danger-soft)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        sm: "4px",
        md: "6px",
        lg: "10px",
        xl: "16px",
      },
      // ADR 0013 type scale — 5-size modular at 1.25 ratio. Utilities:
      // text-caption / text-sm / text-base / text-lg / text-xl / text-display.
      // `text-sm` and `text-xl` shadow Tailwind defaults on purpose so the
      // existing JSX picks up the new values without renaming.
      fontSize: {
        caption: ["var(--text-caption)", { lineHeight: "1.45" }],
        sm: ["var(--text-sm)", { lineHeight: "1.55" }],
        base: ["var(--text-base)", { lineHeight: "var(--leading-body)" }],
        lg: ["var(--text-lg)", { lineHeight: "var(--leading-heading)" }],
        xl: ["var(--text-xl)", { lineHeight: "var(--leading-heading)" }],
        display: ["var(--text-display)", { lineHeight: "1.1" }],
      },
      // Motion tokens — see product/06-ux-principles.md §P08 & globals.css.
      // Raw `duration-NNN` is banned by ux-principles.test.ts.
      transitionDuration: {
        fast: "var(--dur-fast)",
        base: "var(--dur-base)",
        mid: "var(--dur-mid)",
        slow: "var(--dur-slow)",
      },
      transitionTimingFunction: {
        out: "var(--ease-out)",
        // ADR 0013 — longer-tailed curves for hero-level reveals and
        // Viz entry animations. Keep `out` as the default for chrome.
        "out-quart": "var(--ease-out-quart)",
        "out-expo": "var(--ease-out-expo)",
      },
    },
  },
  plugins: [],
};

export default config;
