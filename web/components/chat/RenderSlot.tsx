import type { RenderPayload } from "@/lib/protocol";
import { resolveComponent } from "@/lib/component-registry";

type Props = { payload: RenderPayload };

export function RenderSlot({ payload }: Props) {
  const Component = resolveComponent(payload.component);
  if (!Component) {
    return (
      <div className="rounded border border-dashed border-border px-3 py-2 text-xs text-text-muted">
        Unknown component: {payload.component}
      </div>
    );
  }
  return (
    <Component
      props={payload.props}
      interactions={payload.interactions}
    />
  );
}
