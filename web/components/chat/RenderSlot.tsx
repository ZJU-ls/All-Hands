"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import type { RenderPayload, RenderInteraction } from "@/lib/protocol";
import { resolveComponent } from "@/lib/component-registry";

type Props = { payload: RenderPayload };

/**
 * RenderSlot wraps the dispatch from payload → React component. It is the
 * single point where untrusted LLM-produced render envelopes cross into the
 * app, so it must never let a malformed payload take down the whole chat:
 *
 * - Unknown component name → inline "unknown" chip (component not in registry)
 * - Component throws mid-render → inline "render failed" chip, chat keeps
 *   working (next tool call still renders)
 * - Missing/null `props` / `interactions` → normalized to `{}` / `[]` so
 *   Viz components that call `.map` / `.find` on them don't crash
 */
export function RenderSlot({ payload }: Props) {
  const component = payload?.component ?? "";
  const Component = component ? resolveComponent(component) : undefined;
  if (!Component) {
    return (
      <div
        className="rounded border border-dashed border-border px-3 py-2 text-xs text-text-muted"
        data-testid="render-slot-unknown"
      >
        Unknown component: {component || "(empty)"}
      </div>
    );
  }

  const safeProps: Record<string, unknown> =
    payload.props && typeof payload.props === "object" ? payload.props : {};
  const safeInteractions: RenderInteraction[] = Array.isArray(payload.interactions)
    ? payload.interactions
    : [];

  return (
    <RenderErrorBoundary componentName={component}>
      <Component props={safeProps} interactions={safeInteractions} />
    </RenderErrorBoundary>
  );
}

class RenderErrorBoundary extends Component<
  { componentName: string; children: ReactNode },
  { error: Error | null }
> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // Dev-console breadcrumb so the agent author can see which Viz payload
    // was malformed. Production users already see the inline fallback card.
    console.error(
      `[allhands] render suite crash in <${this.props.componentName}>:`,
      error,
      info.componentStack,
    );
  }

  override render() {
    const { error } = this.state;
    if (error) {
      return (
        <div
          className="rounded border border-dashed border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger"
          data-testid="render-slot-crash"
          data-component={this.props.componentName}
        >
          <div className="font-mono text-[10px] uppercase tracking-wide">
            render failed · {this.props.componentName}
          </div>
          <div className="mt-1 text-text-muted">{error.message}</div>
        </div>
      );
    }
    return this.props.children;
  }
}
