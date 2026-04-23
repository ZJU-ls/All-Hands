"use client";
import { AppShell } from "@/components/shell/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Icon, type IconName } from "@/components/ui/icon";
import Link from "next/link";

export default function SettingsPage() {
  return (
    <AppShell title="设置">
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-8 px-8 py-10 animate-fade-up">
          <PageHeader
            title="设置"
            subtitle="偏好与工作区配置 · 主题切换在右上角 · 模型/供应商请到「模型网关」"
          />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <SettingsCard
              icon="server"
              title="供应商"
              description="管理 LLM 供应商凭证、基础 URL 与启用开关。"
              href="/gateway/providers"
              ctaLabel="前往供应商"
            />
            <SettingsCard
              icon="brain"
              title="模型"
              description="模型列表、默认模型、用量限额与故障回退。"
              href="/gateway/models"
              ctaLabel="前往模型"
            />
            <SettingsCard
              icon="plug"
              title="MCP 服务器"
              description="外接工具服务器的注册、连接与同步。"
              href="/mcp-servers"
              ctaLabel="前往 MCP"
            />
            <SettingsCard
              icon="bell"
              title="通知渠道"
              description="Slack、邮件、Webhook 等推送渠道配置。"
              href="/channels"
              ctaLabel="前往通知"
            />
          </div>

          <div className="rounded-xl border border-border bg-surface-2/40 p-5 text-caption text-text-muted">
            <div className="flex items-start gap-2">
              <Icon name="info" size={14} className="mt-0.5 text-text-subtle" />
              <div>
                更多偏好项(语言、时区、快捷键覆盖、AP 长循环预算等)即将加入。
                主题切换仍在右上角 sun/moon 按钮。
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function SettingsCard({
  icon,
  title,
  description,
  href,
  ctaLabel,
}: {
  icon: IconName;
  title: string;
  description: string;
  href: string;
  ctaLabel: string;
}) {
  return (
    <Link
      href={href}
      className="group relative block overflow-hidden rounded-xl border border-border bg-surface p-5 shadow-soft-sm transition duration-base hover:-translate-y-px hover:border-border-strong hover:shadow-soft"
    >
      <div className="flex items-start gap-4">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-muted text-primary">
          <Icon name={icon} size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold tracking-tight text-text">{title}</h3>
          <p className="mt-1 text-caption leading-relaxed text-text-muted">{description}</p>
        </div>
        <Icon
          name="arrow-right"
          size={14}
          className="mt-1 shrink-0 self-start text-text-subtle opacity-0 transition-[opacity,transform] duration-fast group-hover:translate-x-0.5 group-hover:opacity-100 group-hover:text-primary"
        />
      </div>
      <div className="mt-4 border-t border-border/60 pt-3 text-caption font-medium text-primary">
        {ctaLabel} →
      </div>
    </Link>
  );
}
