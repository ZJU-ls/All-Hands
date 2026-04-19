"use client";
import { AppShell } from "@/components/shell/AppShell";
import Link from "next/link";

export default function SettingsPage() {
  return (
    <AppShell title="设置">
      <div className="h-full overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-10 space-y-6">
          <div>
            <h2 className="text-xl font-semibold text-text">偏好</h2>
            <p className="text-sm text-text-muted mt-1">
              主题切换在右上角。其他偏好项即将加入。
            </p>
          </div>

          <div className="rounded-xl border border-border bg-surface p-5">
            <h3 className="text-sm font-semibold text-text mb-2">模型配置</h3>
            <p className="text-xs text-text-muted mb-3">
              模型供应商和模型的配置已迁移到「模型网关」。
            </p>
            <div className="flex gap-2">
              <Link
                href="/gateway/providers"
                className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-surface-2 transition-colors"
              >
                前往 供应商 →
              </Link>
              <Link
                href="/gateway/models"
                className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-surface-2 transition-colors"
              >
                前往 模型 →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
