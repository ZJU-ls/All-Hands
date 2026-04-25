"use client";

/**
 * ProviderSection · per-provider accordion inside /gateway (ADR 0016 · V2).
 *
 * Header — BrandMark tile · provider name · kind / default / disabled chips ·
 * model count · right-side action cluster (bulk ping · set-default · edit ·
 * delete) · rotating chevron.
 * Body   — base_url + nested ModelRows + "+ 注册模型" outline button.
 *
 * The enclosing <section> on `/gateway` already wraps providers in a
 * `rounded-xl bg-surface shadow-soft-sm` container; each ProviderSection is
 * one divider-separated block inside it (no double rounding).
 */

import { useTranslations } from "next-intl";
import { BrandMark } from "@/components/brand/BrandMark";
import { Icon } from "@/components/ui/icon";
import { ModelRow, type GatewayModel } from "./ModelRow";
import type { PingState } from "./PingIndicator";

export type ProviderKind = "openai" | "anthropic" | "aliyun";

export type GatewayProvider = {
  id: string;
  name: string;
  kind: ProviderKind;
  base_url: string;
  api_key_set: boolean;
  default_model: string;
  is_default: boolean;
  enabled: boolean;
};

const KIND_BADGE: Record<ProviderKind, string> = {
  openai: "OPENAI",
  anthropic: "ANTHROPIC",
  aliyun: "ALIYUN",
};

export function ProviderSection({
  provider,
  models,
  open,
  onToggle,
  pingStates,
  onPingModel,
  onBulkPing,
  bulkPingInProgress,
  onSetDefault,
  onEdit,
  onDelete,
  onAddModel,
  onChatTestModel,
  onDeleteModel,
}: {
  provider: GatewayProvider;
  models: GatewayModel[];
  open: boolean;
  onToggle: () => void;
  pingStates: Record<string, PingState>;
  onPingModel: (m: GatewayModel) => void;
  onBulkPing: () => void;
  bulkPingInProgress: { done: number; total: number } | null;
  onSetDefault: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddModel: () => void;
  onChatTestModel: (m: GatewayModel) => void;
  onDeleteModel: (m: GatewayModel) => void;
}) {
  const t = useTranslations("gateway.providerSection");
  const bulkRunning = bulkPingInProgress !== null;
  const bulkLabel = bulkRunning
    ? t("bulkRunning", { done: bulkPingInProgress.done, total: bulkPingInProgress.total })
    : t("bulkLabel");

  return (
    <section
      data-testid={`gateway-provider-${provider.name}`}
      className="border-b border-border last:border-b-0"
    >
      <header
        className={`flex items-center gap-3 px-4 py-3 transition-colors duration-fast ${
          open ? "bg-surface-2/50" : "hover:bg-surface-2/40"
        }`}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={open ? t("collapse") : t("expand")}
          data-testid={`gateway-provider-toggle-${provider.name}`}
          className="flex items-center gap-3 min-w-0 flex-1 text-left"
        >
          <BrandMark
            kind={provider.kind}
            name={provider.name}
            size="md"
            fallbackName={provider.name}
            testId={`gateway-provider-avatar-${provider.name}`}
          />

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[14px] font-semibold text-text truncate">
                {provider.name}
              </span>
              <span
                data-testid={`gateway-provider-kind-${provider.name}`}
                className="shrink-0 inline-flex items-center h-5 px-1.5 rounded-sm bg-surface-2 border border-border font-mono text-[9px] tracking-wider text-text-muted"
              >
                {KIND_BADGE[provider.kind]}
              </span>
              {provider.is_default && (
                <span className="shrink-0 inline-flex items-center gap-1 h-5 px-1.5 rounded-sm bg-primary/10 border border-primary/25 text-primary text-[10px] font-semibold">
                  <Icon name="star" size={10} strokeWidth={2} />
                  {t("default")}
                </span>
              )}
              {!provider.enabled && (
                <span className="shrink-0 inline-flex items-center h-5 px-1.5 rounded-sm bg-surface-2 border border-border text-[10px] text-text-muted">
                  {t("disabled")}
                </span>
              )}
              <span
                aria-hidden="true"
                className={`shrink-0 w-[7px] h-[7px] rounded-full ${
                  provider.enabled ? "bg-success" : "bg-border-strong"
                }`}
              />
            </div>
            <div className="mt-0.5 flex items-center gap-2 min-w-0">
              <span className="inline-flex items-center gap-1 text-[11px] text-text-muted tabular-nums">
                <Icon
                  name="brain"
                  size={11}
                  className="text-text-subtle"
                />
                {t("modelsCount", { n: models.length })}
              </span>
              <span aria-hidden="true" className="text-text-subtle">
                ·
              </span>
              <span className="font-mono text-[11px] text-text-subtle truncate">
                default={provider.default_model}
              </span>
            </div>
          </div>

          <Icon
            name="chevron-down"
            size={14}
            aria-hidden="true"
            className={`shrink-0 text-text-muted transition-transform duration-base ${
              open ? "rotate-180" : "rotate-0"
            }`}
          />
        </button>

        <div className="shrink-0 flex items-center gap-1.5 border-l border-border pl-3">
          <button
            type="button"
            onClick={onBulkPing}
            disabled={bulkRunning || models.length === 0}
            data-testid={`gateway-bulk-ping-${provider.name}`}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-surface border border-border text-[11px] font-medium text-text-muted hover:border-primary/40 hover:text-primary disabled:opacity-40 disabled:hover:border-border disabled:hover:text-text-muted transition-colors duration-fast"
          >
            <Icon
              name={bulkRunning ? "loader" : "activity"}
              size={11}
              className={bulkRunning ? "animate-spin-slow" : ""}
            />
            <span className="tabular-nums">{bulkLabel}</span>
          </button>
          {!provider.is_default && (
            <button
              type="button"
              onClick={onSetDefault}
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-surface border border-border text-[11px] font-medium text-text-muted hover:border-primary/40 hover:text-primary transition-colors duration-fast"
            >
              <Icon name="star" size={11} />
              {t("setAsDefault")}
            </button>
          )}
          <IconOnlyButton icon="edit" label={t("edit")} onClick={onEdit} />
          <IconOnlyButton
            icon="trash-2"
            label={t("delete")}
            onClick={onDelete}
            tone="danger"
          />
        </div>
      </header>

      {open && (
        <div
          className="pb-3 pt-1 animate-fade-up"
          style={{ animationDuration: "var(--dur-base)" }}
        >
          <div className="px-4 pb-2">
            <p className="inline-flex items-center gap-1.5 font-mono text-[11px] text-text-subtle truncate max-w-full">
              <Icon name="link" size={11} className="shrink-0" />
              <span className="truncate">{provider.base_url}</span>
            </p>
          </div>

          {models.length === 0 ? (
            <div className="ml-6 mr-4 rounded-lg border border-dashed border-border bg-surface-2/30 px-4 py-4 flex items-center gap-3">
              <div
                aria-hidden="true"
                className="grid h-8 w-8 place-items-center rounded-full bg-primary/10 text-primary"
              >
                <Icon name="brain" size={14} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] text-text">{t("noModelsTitle")}</p>
                <p className="text-[11px] text-text-muted">
                  {t("noModelsHint", { name: provider.name })}
                </p>
              </div>
              <button
                type="button"
                onClick={onAddModel}
                className="shrink-0 inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-primary text-primary-fg text-[11px] font-semibold shadow-soft-sm hover:bg-primary-hover hover:-translate-y-px transition duration-base"
              >
                <Icon name="plus" size={11} />
                {t("registerModel")}
              </button>
            </div>
          ) : (
            <div>
              {models.map((m) => (
                <ModelRow
                  key={m.id}
                  model={m}
                  pingState={pingStates[m.id] ?? { status: "idle" }}
                  onPing={() => onPingModel(m)}
                  onChatTest={() => onChatTestModel(m)}
                  onDelete={() => onDeleteModel(m)}
                />
              ))}
              <div className="ml-6 border-l border-border pl-4 pt-2 pr-3">
                <button
                  type="button"
                  onClick={onAddModel}
                  className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-dashed border-border bg-transparent hover:bg-surface-2/50 hover:border-primary/40 hover:text-primary text-[11px] font-medium text-text-muted transition-colors duration-fast"
                >
                  <Icon name="plus" size={11} />
                  {t("registerModel")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function IconOnlyButton({
  icon,
  label,
  onClick,
  tone = "default",
}: {
  icon: Parameters<typeof Icon>[0]["name"];
  label: string;
  onClick: () => void;
  tone?: "default" | "danger";
}) {
  const toneCls =
    tone === "danger"
      ? "text-text-subtle hover:text-danger hover:bg-danger-soft hover:border-danger/30"
      : "text-text-subtle hover:text-primary hover:bg-primary/10 hover:border-primary/30";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`grid h-7 w-7 place-items-center rounded-md bg-surface border border-border transition-colors duration-fast ${toneCls}`}
    >
      <Icon name={icon} size={12} />
    </button>
  );
}
