"use client";

/**
 * ModelRow · one model inside a ProviderSection (ADR 0016 · V2 polish).
 *
 * Compact row: mono API name + optional display name · context-window badge ·
 * inline ping pill · icon-only actions (ping / chat / delete).
 * `hover:bg-surface-2/40` softens the row without shouting.
 *
 * No trailing decorative arrow — the V2 design draft included a slide-in
 * `→` chevron to suggest interactivity, but the row's action set is already
 * fully exposed via icon buttons. The arrow had no click handler, confused
 * users into thinking the row was clickable, and was removed 2026-04-25.
 */

import { useTranslations } from "next-intl";
import { BrandMark } from "@/components/brand/BrandMark";
import { Icon, type IconName } from "@/components/ui/icon";
import { PingIndicator, type PingState } from "./PingIndicator";

export type GatewayModel = {
  id: string;
  provider_id: string;
  name: string;
  display_name: string;
  context_window: number;
  /** Optional advanced caps. null = "use model default". When set,
   *  max_input_tokens drives the composer chip denominator and
   *  max_output_tokens is forwarded as max_tokens on outbound chat. */
  max_input_tokens: number | null;
  max_output_tokens: number | null;
  enabled: boolean;
  /** Singleton flag — at most one row across the whole table is_default=true. */
  is_default: boolean;
};

export function ModelRow({
  model,
  pingState,
  onPing,
  onChatTest,
  onDelete,
  onSetDefault,
  onEdit,
}: {
  model: GatewayModel;
  pingState: PingState;
  onPing: () => void;
  onChatTest: () => void;
  onDelete: () => void;
  /** Promote this model — atomically clears any prior default + sets this row. */
  onSetDefault: () => void;
  /** Open the edit dialog for this model — allows changing display_name +
   *  context_window (the API name is immutable; rename = create new + delete). */
  onEdit: () => void;
}) {
  const t = useTranslations("gateway.modelRow");
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
            title={t("contextWindowTitle", { tokens: model.context_window.toLocaleString() })}
          >
            {formatCtx(model.context_window)}
          </span>
        )}

        {!model.enabled && (
          <span className="shrink-0 inline-flex items-center h-5 px-1.5 rounded-sm bg-surface-2 border border-border text-[10px] text-text-muted">
            {t("disabled")}
          </span>
        )}

        {/* 默认徽标 / 设为默认按钮互斥占同一槽位:
            - is_default → 蓝色「★ 默认」chip(状态标识)
            - else        → 灰色「设为默认」按钮(单击切默认)
            放在模型名称区右侧、操作按钮组之外,这样右边的
            ping / chat / delete 三个 icon 在所有行上水平对齐,不会因
            "这一行有没有默认按钮"而漂移。 */}
        {model.is_default ? (
          <span
            data-testid={`gateway-default-badge-${model.id}`}
            className="shrink-0 inline-flex items-center gap-1 h-5 px-1.5 rounded-sm bg-primary/10 border border-primary/25 text-primary text-[10px] font-semibold"
            title={t("defaultBadgeTitle")}
          >
            <Icon name="star" size={10} strokeWidth={2} />
            {t("defaultBadge")}
          </span>
        ) : (
          model.enabled && (
            <button
              type="button"
              onClick={onSetDefault}
              data-testid={`gateway-set-default-${model.id}`}
              title={t("setDefaultTitle")}
              className="shrink-0 inline-flex items-center gap-1 h-5 px-1.5 rounded-sm border border-dashed border-border bg-transparent text-text-subtle text-[10px] font-medium hover:text-primary hover:border-primary/50 hover:bg-primary/5 transition-colors duration-fast opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              <Icon name="star" size={10} strokeWidth={2} />
              {t("setDefault")}
            </button>
          )
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
          label={t("ping")}
          testId={`gateway-ping-${model.id}`}
          disabled={running}
          onClick={onPing}
        />
        <RowIconButton
          icon="message-square"
          label={t("chatTest")}
          testId={`gateway-chat-test-${model.id}`}
          onClick={onChatTest}
        />
        <RowIconButton
          icon="edit"
          label={t("edit")}
          testId={`gateway-edit-${model.id}`}
          onClick={onEdit}
        />
        <RowIconButton
          icon="trash-2"
          label={t("delete")}
          onClick={onDelete}
          tone="danger"
        />
      </div>
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
      className={`grid h-7 w-7 place-items-center rounded-md transition-colors duration-fast disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${toneCls}`}
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
