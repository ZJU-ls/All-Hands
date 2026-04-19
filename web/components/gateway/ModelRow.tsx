"use client";

import { BrandMark } from "@/components/brand/BrandMark";
import { PingIndicator, type PingState } from "./PingIndicator";

export type GatewayModel = {
  id: string;
  provider_id: string;
  name: string;
  display_name: string;
  context_window: number;
  enabled: boolean;
};

export function ModelRow({
  model,
  pingState,
  onPing,
  onChatTest,
  onDelete,
}: {
  model: GatewayModel;
  pingState: PingState;
  onPing: () => void;
  onChatTest: () => void;
  onDelete: () => void;
}) {
  const running = pingState.status === "running";
  return (
    <div
      data-testid={`gateway-model-${model.name}`}
      className="group flex items-center gap-3 py-1.5 pl-4 pr-3 border-l border-border ml-6 hover:bg-surface-2 transition-colors duration-base"
    >
      <BrandMark
        name={model.display_name || model.name}
        size="sm"
        fallbackName={model.display_name || model.name}
        testId={`gateway-model-avatar-${model.name}`}
      />
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm text-text truncate">
          {model.display_name || model.name}
        </span>
        {model.display_name && model.display_name !== model.name && (
          <span className="font-mono text-[11px] text-text-subtle truncate">
            {model.name}
          </span>
        )}
        {!model.enabled && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-text-muted">
            已禁用
          </span>
        )}
      </div>

      {model.context_window > 0 && (
        <span className="font-mono text-[10px] text-text-muted shrink-0">
          ctx={model.context_window.toLocaleString()}
        </span>
      )}

      <span
        data-testid={`gateway-ping-result-${model.id}`}
        className="shrink-0"
      >
        <PingIndicator state={pingState} />
      </span>

      <div className="ml-auto flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={onPing}
          disabled={running}
          data-testid={`gateway-ping-${model.id}`}
          className="rounded border border-border hover:border-border-strong hover:bg-surface-2 disabled:opacity-40 text-text-muted hover:text-text text-[11px] px-2 py-1 transition-colors duration-base"
        >
          ping
        </button>
        <button
          type="button"
          onClick={onChatTest}
          data-testid={`gateway-chat-test-${model.id}`}
          className="rounded border border-border hover:border-border-strong hover:bg-surface-2 text-text-muted hover:text-text text-[11px] px-2 py-1 transition-colors duration-base"
        >
          对话
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="rounded border border-border text-danger hover:bg-danger/10 hover:border-danger/50 text-[11px] px-2 py-1 transition-colors duration-base"
        >
          删除
        </button>
      </div>
    </div>
  );
}
