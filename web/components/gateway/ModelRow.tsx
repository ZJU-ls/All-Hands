"use client";

/**
 * ModelRow · one model inside a ProviderSection (ADR 0016 · V2 polish).
 *
 * Compact row: mono API name + optional display name · context-window badge ·
 * inline ping pill · icon-only actions (ping / chat / delete) with a trailing
 * arrow-right that slides in on hover. `hover:bg-surface-2/40` softens the
 * row without shouting.
 */

import { BrandMark } from "@/components/brand/BrandMark";
import { Icon, type IconName } from "@/components/ui/icon";
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
  const title = model.display_name || model.name;
  const showAlias = model.display_name && model.display_name !== model.name;

  return (
    <div
      data-testid={`gateway-model-${model.name}`}
      className="group relative flex items-center gap-3 py-2 pl-4 pr-3 ml-6 border-l border-border hover:bg-surface-2/40 transition-colors duration-fast"
    >
      <BrandMark
        name={title}
        size="sm"
        fallbackName={title}
        testId={`gateway-model-avatar-${model.name}`}
      />

      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span
          className={`text-[13px] font-medium text-text truncate ${
            showAlias ? "" : "font-mono text-[12.5px]"
          }`}
        >
          {title}
        </span>
        {showAlias && (
          <span className="font-mono text-[11px] text-text-subtle truncate">
            {model.name}
          </span>
        )}

        {model.context_window > 0 && (
          <span
            className="shrink-0 inline-flex items-center h-5 px-1.5 rounded-sm bg-surface-2 border border-border font-mono text-[10px] text-text-muted tabular-nums"
            title={`上下文窗口 · ${model.context_window.toLocaleString()} tokens`}
          >
            {formatCtx(model.context_window)}
          </span>
        )}

        {!model.enabled && (
          <span className="shrink-0 inline-flex items-center h-5 px-1.5 rounded-sm bg-surface-2 border border-border text-[10px] text-text-muted">
            已禁用
          </span>
        )}
      </div>

      <span
        data-testid={`gateway-ping-result-${model.id}`}
        className="shrink-0"
      >
        <PingIndicator state={pingState} />
      </span>

      <div className="shrink-0 flex items-center gap-0.5">
        <RowIconButton
          icon="activity"
          label="ping"
          testId={`gateway-ping-${model.id}`}
          disabled={running}
          onClick={onPing}
        />
        <RowIconButton
          icon="message-square"
          label="对话测试"
          testId={`gateway-chat-test-${model.id}`}
          onClick={onChatTest}
        />
        <RowIconButton
          icon="trash-2"
          label="删除"
          onClick={onDelete}
          tone="danger"
        />
      </div>

      <Icon
        name="arrow-right"
        size={12}
        aria-hidden="true"
        className="shrink-0 text-text-subtle opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition duration-base"
      />
    </div>
  );
}

function RowIconButton({
  icon,
  label,
  onClick,
  disabled,
  testId,
  tone = "default",
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
  tone?: "default" | "danger";
}) {
  const toneCls =
    tone === "danger"
      ? "text-text-subtle hover:text-danger hover:bg-danger-soft"
      : "text-text-subtle hover:text-primary hover:bg-primary/10";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      data-testid={testId}
      className={`grid h-7 w-7 place-items-center rounded-md transition-colors duration-fast disabled:opacity-40 disabled:pointer-events-none ${toneCls}`}
    >
      <Icon name={icon} size={13} />
    </button>
  );
}

function formatCtx(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}
