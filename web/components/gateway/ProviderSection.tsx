"use client";

import { BrandMark } from "@/components/brand/BrandMark";
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
  const bulkLabel = bulkPingInProgress
    ? `连通性测试 (${bulkPingInProgress.done}/${bulkPingInProgress.total})`
    : "连通性测试";

  return (
    <section
      data-testid={`gateway-provider-${provider.name}`}
      className="border-b border-border"
    >
      <header className="flex items-center gap-2 px-3 py-2 hover:bg-surface-2 transition-colors duration-base">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={open ? "折叠" : "展开"}
          data-testid={`gateway-provider-toggle-${provider.name}`}
          className="font-mono text-text-muted hover:text-text w-4 text-center text-[12px] shrink-0"
        >
          {open ? "▾" : "▸"}
        </button>

        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-2.5 min-w-0 text-left"
        >
          <BrandMark
            kind={provider.kind}
            name={provider.name}
            size="md"
            fallbackName={provider.name}
            testId={`gateway-provider-avatar-${provider.name}`}
          />
          <span
            data-testid={`gateway-provider-kind-${provider.name}`}
            className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-2 text-text-muted border border-border shrink-0"
          >
            {KIND_BADGE[provider.kind]}
          </span>
          <span className="text-sm font-medium text-text truncate">
            {provider.name}
          </span>
          <span
            aria-hidden="true"
            className={`w-[7px] h-[7px] rounded-full shrink-0 ${
              provider.enabled ? "bg-success" : "bg-border"
            }`}
          />
          {provider.is_default && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/15 text-primary shrink-0">
              默认
            </span>
          )}
          {!provider.enabled && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-text-muted shrink-0">
              已禁用
            </span>
          )}
          <span className="text-[11px] text-text-muted truncate">
            {models.length} models · default={provider.default_model}
          </span>
        </button>

        <div className="ml-auto flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onBulkPing}
            disabled={bulkPingInProgress !== null || models.length === 0}
            data-testid={`gateway-bulk-ping-${provider.name}`}
            className="rounded border border-border hover:border-border-strong hover:bg-surface-2 disabled:opacity-40 text-text-muted hover:text-text text-[11px] px-2 py-1 transition-colors duration-base"
          >
            {bulkLabel}
          </button>
          {!provider.is_default && (
            <button
              type="button"
              onClick={onSetDefault}
              className="rounded border border-border hover:border-border-strong hover:bg-surface-2 text-text-muted hover:text-text text-[11px] px-2 py-1 transition-colors duration-base"
            >
              设为默认
            </button>
          )}
          <button
            type="button"
            onClick={onEdit}
            className="rounded border border-border hover:border-border-strong hover:bg-surface-2 text-text-muted hover:text-text text-[11px] px-2 py-1 transition-colors duration-base"
          >
            编辑
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded border border-border text-danger hover:bg-danger/10 hover:border-danger/50 text-[11px] px-2 py-1 transition-colors duration-base"
          >
            删除
          </button>
        </div>
      </header>

      {open && (
        <div className="pb-3 pt-1">
          <div className="px-3 pb-1.5">
            <p className="font-mono text-[11px] text-text-subtle truncate">
              {provider.base_url}
            </p>
          </div>

          {models.length === 0 ? (
            <div className="ml-6 mr-3 border-l border-border pl-4 py-3">
              <p className="text-[12px] text-text-muted">
                此供应商下尚未注册任何模型
              </p>
              <button
                type="button"
                onClick={onAddModel}
                className="mt-1.5 rounded border border-border hover:border-border-strong hover:bg-surface-2 text-text-muted hover:text-text text-[11px] px-2 py-1 transition-colors duration-base"
              >
                + 注册第一个模型
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
              <div className="ml-6 border-l border-border pl-4 pt-1">
                <button
                  type="button"
                  onClick={onAddModel}
                  className="rounded border border-border hover:border-border-strong hover:bg-surface-2 text-text-muted hover:text-text text-[11px] px-2 py-1 transition-colors duration-base"
                >
                  + 注册模型
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
