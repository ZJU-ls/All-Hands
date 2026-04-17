import type { ComponentType } from "react";

/**
 * ComponentRegistry — render-tool contract.
 *
 * Render tools return `{ component, props, interactions }`. The registry
 * maps `component` (string) → React component. Adding a new render tool =
 * add a component file + one entry here. No other plumbing required.
 *
 * See product/04-architecture.md §L10 and CLAUDE.md §6.5.
 */
export type RenderInteraction = {
  kind: "button" | "form_submit" | "link";
  label: string;
  action: string; // "invoke_tool" | "send_message" | "navigate"
  payload?: Record<string, unknown>;
};

export type RenderProps = {
  props: Record<string, unknown>;
  interactions: RenderInteraction[];
};

type RegistryEntry = ComponentType<RenderProps>;

const registry = new Map<string, RegistryEntry>();

export function registerComponent(name: string, component: RegistryEntry): void {
  if (registry.has(name)) {
    throw new Error(`ComponentRegistry: duplicate registration for "${name}"`);
  }
  registry.set(name, component);
}

export function resolveComponent(name: string): RegistryEntry | undefined {
  return registry.get(name);
}

export function registeredComponents(): string[] {
  return [...registry.keys()].sort();
}

// Register built-in render components (client-side only)
if (typeof window !== "undefined") {
  import("../components/render/MarkdownCard").then(({ MarkdownCard }) => {
    try {
      registerComponent("MarkdownCard", MarkdownCard);
    } catch {
      // Already registered (hot reload)
    }
  });
}
