"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import type { RenderPayload, RenderInteraction } from "@/lib/protocol";
import { resolveComponent } from "@/lib/component-registry";
import { Icon } from "@/components/ui/icon";

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
        className="inline-flex items-center gap-2 rounded-md border border-dashed border-border bg-surface-2 px-3 py-2 font-mono text-[11px] text-text-muted"
        data-testid="render-slot-unknown"
      >
        <Icon name="alert-circle" size={12} className="text-text-subtle" />
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
          className="flex items-start gap-2.5 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-[12px] text-danger"
          data-testid="render-slot-crash"
          data-component={this.props.componentName}
        >
          <Icon name="alert-triangle" size={14} className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[10px] uppercase tracking-wide">
              render failed · {this.props.componentName}
            </div>
            <div className="mt-0.5 break-all text-text-muted">{error.message}</div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
