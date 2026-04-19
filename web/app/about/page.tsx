"use client";
import { AppShell } from "@/components/shell/AppShell";

export default function AboutPage() {
  return (
    <AppShell title="关于">
      <div className="h-full overflow-y-auto">
        <div className="max-w-2xl mx-auto px-8 py-10 space-y-4">
          <h2 className="text-xl font-semibold">allhands</h2>
          <p className="text-sm text-text-muted">
            One for All — 开源自部署的数字员工组织平台。
          </p>
          <p className="text-sm text-text-muted">
            通过与 Lead Agent 对话来设计、调度并观测一支员工团队。所有能力以 Tool
            的形式注册,前端菜单只是入口,后端遵循 Tool First 原则。
          </p>
          <div className="pt-4 text-xs text-text-subtle">版本: v0 · MVP</div>
        </div>
      </div>
    </AppShell>
  );
}
