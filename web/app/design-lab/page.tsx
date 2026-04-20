"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Table,
  KV,
  Cards,
  Timeline,
  Steps,
  Code,
  Diff,
  Callout,
  LinkCard,
} from "@/components/render/Viz";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  FirstRun,
} from "@/components/state";
import {
  ChatIcon,
  UserIcon,
  SkillIcon,
  ModelIcon,
  PluginIcon,
  ProviderIcon,
  TriggerIcon,
  TaskIcon,
  CockpitIcon,
  ObservatoryIcon,
  ChannelIcon,
  MarketIcon,
  StockIcon,
  SettingsIcon,
  SearchIcon,
  SendIcon,
  StopIcon,
  AttachIcon,
  ThinkIcon,
  ExternalIcon,
  CopyIcon,
  CheckIcon,
  type IconProps,
} from "@/components/icons";
import { EmployeeCard } from "@/components/render/EmployeeCard";
import { MarkdownCard } from "@/components/render/MarkdownCard";
import { PlanTimeline } from "@/components/render/PlanTimeline";
import { PlanCard } from "@/components/render/PlanCard";

/**
 * Design Lab: three concept variants side-by-side in both light & dark.
 * Pick one, then we iterate on the chosen concept and persist rules.
 */

type Mode = "dark" | "light";

export default function DesignLabPage() {
  return (
    <>
      <div className="h-screen overflow-y-auto bg-bg text-text p-8" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
        <header className="max-w-7xl mx-auto mb-10">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight mb-1">Design Lab</h1>
              <p className="text-sm text-text-muted">
                三个风格方向 · 每个方向展示侧栏 + 页头 + 卡片 + CTA · 深浅主题各一
              </p>
            </div>
            <Link
              href="/chat"
              className="text-xs text-text-muted hover:text-text underline underline-offset-4"
            >
              ← 返回应用
            </Link>
          </div>
        </header>

        <div className="max-w-7xl mx-auto space-y-14">
          <ConceptSection
            letter="A"
            name="Linear Precise"
            tagline="Inter + JetBrains Mono · Indigo · 侧栏 2px 色条 · hairline 分隔"
            notes={[
              "品牌色: Indigo #6366F1 — 只用于激活指示、焦点、主 CTA、logo",
              "Icon 替代: 竖色条(菜单激活)、mono 符号(· / → ⌘)、极少量 1-line SVG",
              "动效: 150-220ms ease-out,卡片 hover 仅边框亮度变化,无位移",
              "气质: 类 Linear / Vercel Dashboard,密度适中,精度感强",
            ]}
          >
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ConceptFrame mode="dark">
                <ConceptA mode="dark" />
              </ConceptFrame>
              <ConceptFrame mode="light">
                <ConceptA mode="light" />
              </ConceptFrame>
            </div>
          </ConceptSection>

          <ConceptSection
            letter="B"
            name="Mono Brutalist"
            tagline="JetBrains Mono 全站 · Cyan · hairline 网格 · terminal 味道"
            notes={[
              "品牌色: Cyan #06B6D4 — 冷静清爽,搭配全 mono 字体放大技术感",
              "Icon 替代: 方括号 [·] 记号、mono 字符边框、ASCII-style 列表前缀",
              "动效: 极短 120ms,带 0.5px→1px 边框加粗,偶尔轻微下划线动画",
              "气质: 类 Replit / Fig / 旧 Cursor, 极客向,信息密度高",
            ]}
          >
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ConceptFrame mode="dark">
                <ConceptB mode="dark" />
              </ConceptFrame>
              <ConceptFrame mode="light">
                <ConceptB mode="light" />
              </ConceptFrame>
            </div>
          </ConceptSection>

          <ConceptSection
            letter="C"
            name="Vercel Soft"
            tagline="Inter 全站 · Neutral + subtle gradient · 柔和阴影 · 大留白"
            notes={[
              "品牌色: Zinc/Black 做主色,强调中性,强调状态仅用 emerald/red 语义",
              "Icon 替代: 纯排版 + 极细几何装饰线 + 柔和 radial gradient 做氛围感",
              "动效: 220-280ms, 带轻微 scale(1→1.015) + opacity, 柔和阴影 hover",
              "气质: 类 Vercel Dashboard / v0 / Resend,商业感更强,阅读更舒适",
            ]}
          >
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ConceptFrame mode="dark">
                <ConceptC mode="dark" />
              </ConceptFrame>
              <ConceptFrame mode="light">
                <ConceptC mode="light" />
              </ConceptFrame>
            </div>
          </ConceptSection>

          <ConceptADeepDive />

          <StateShowcase />

          <IconGallery />

          <EmployeeCardShowcase />

          <VizShowcase />

          <RenderLibraryShowcase />

          <div className="rounded-2xl border border-border p-6 bg-surface">
            <h3 className="text-sm font-semibold mb-2">下一步</h3>
            <p className="text-xs text-text-muted mb-1">
              方向 <span className="font-mono text-text">A</span> 确认后,告诉我颜色 / 字号 / 动效节奏有没有要微调的。
            </p>
            <p className="text-xs text-text-muted">
              最终把规则写入
              <span className="font-mono text-text"> product/03-visual-design.md</span>、
              <span className="font-mono text-text"> CLAUDE.md</span>、
              <span className="font-mono text-text"> design-system/MASTER.md</span>,保证后续 Claude 一直遵守。
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

/* ---------- shared scaffolding ---------- */

function ConceptSection({
  letter,
  name,
  tagline,
  notes,
  children,
}: {
  letter: string;
  name: string;
  tagline: string;
  notes: string[];
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-baseline gap-3 mb-3">
        <div className="text-3xl font-semibold tracking-tight">{letter}</div>
        <div>
          <h2 className="text-lg font-semibold">{name}</h2>
          <p className="text-xs text-text-muted" style={{ fontFamily: "JetBrains Mono, monospace" }}>
            {tagline}
          </p>
        </div>
      </div>
      <ul className="mb-4 text-xs text-text-muted space-y-1 list-none pl-0">
        {notes.map((n) => (
          <li key={n} className="flex gap-2">
            <span className="text-text-subtle">·</span>
            <span>{n}</span>
          </li>
        ))}
      </ul>
      {children}
    </section>
  );
}

function ConceptFrame({ mode, children }: { mode: Mode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl overflow-hidden border border-border">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-surface">
        <span className="text-[10px] uppercase tracking-wider text-text-subtle font-mono">
          {mode}
        </span>
        <div className="flex gap-1">
          <div className="h-2 w-2 rounded-full bg-border" />
          <div className="h-2 w-2 rounded-full bg-border" />
          <div className="h-2 w-2 rounded-full bg-border" />
        </div>
      </div>
      {children}
    </div>
  );
}

/* ---------- Concept A: Linear Precise ---------- */

function ConceptA({ mode }: { mode: Mode }) {
  const dark = mode === "dark";
  const bg = dark ? "#09090B" : "#FFFFFF";
  const surface = dark ? "#111113" : "#FAFAFA";
  const border = dark ? "#27272A" : "#E4E4E7";
  const text = dark ? "#FAFAFA" : "#18181B";
  const muted = dark ? "#A1A1AA" : "#71717A";
  const subtle = dark ? "#71717A" : "#A1A1AA";
  const primary = "#6366F1";
  const primaryFg = "#FFFFFF";

  return (
    <div style={{ background: bg, color: text, fontFamily: "Inter, system-ui, sans-serif" }} className="flex h-[360px]">
      {/* sidebar */}
      <aside style={{ background: surface, borderRight: `1px solid ${border}`, width: 200 }} className="shrink-0 flex flex-col">
        <div style={{ height: 44, borderBottom: `1px solid ${border}` }} className="flex items-center px-3 gap-2">
          <LogoDotgrid primary={primary} />
          <span className="text-[13px] font-semibold tracking-tight">allhands</span>
        </div>
        <nav className="py-2 text-[12px]">
          <SectionLabel color={subtle}>工作区</SectionLabel>
          <NavItemA label="对话" color={text} muted={muted} primary={primary} active />
          <NavItemA label="历史会话" color={text} muted={muted} primary={primary} />
          <SectionLabel color={subtle}>模型网关</SectionLabel>
          <NavItemA label="供应商" color={text} muted={muted} primary={primary} />
          <NavItemA label="模型" color={text} muted={muted} primary={primary} />
          <SectionLabel color={subtle}>运行时</SectionLabel>
          <NavItemA label="审批" color={text} muted={muted} primary={primary} />
        </nav>
      </aside>

      {/* main */}
      <div className="flex-1 flex flex-col">
        <header style={{ height: 44, borderBottom: `1px solid ${border}` }} className="flex items-center justify-between px-5">
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] font-semibold">供应商</span>
            <span style={{ color: subtle, fontFamily: "JetBrains Mono, monospace" }} className="text-[10px]">
              /gateway/providers · 2
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span style={{ color: muted, fontFamily: "JetBrains Mono, monospace" }} className="text-[10px] px-1.5 py-0.5 border rounded" {...({} as object)}>
              ⌘K
            </span>
            <button style={{ background: primary, color: primaryFg }} className="text-[11px] font-medium px-2.5 py-1 rounded-md">
              新建供应商
            </button>
          </div>
        </header>
        <div className="p-5 space-y-2">
          <CardA
            title="OpenAI"
            sub="https://api.openai.com/v1"
            meta="key · set   default · gpt-4o-mini"
            tag="默认"
            border={border} surface={surface} primary={primary} text={text} muted={muted} subtle={subtle}
          />
          <CardA
            title="DeepSeek"
            sub="https://api.deepseek.com/v1"
            meta="key · set   default · deepseek-chat"
            border={border} surface={surface} primary={primary} text={text} muted={muted} subtle={subtle}
          />
        </div>
      </div>
    </div>
  );
}

function NavItemA({
  label, active, color, muted, primary,
}: {
  label: string; active?: boolean; color: string; muted: string; primary: string;
}) {
  return (
    <div className="relative flex items-center h-7 px-3 text-[12px] cursor-pointer" style={{ color: active ? color : muted }}>
      {active && (
        <span style={{ background: primary }} className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r" />
      )}
      <span className="ml-0">{label}</span>
    </div>
  );
}

function SectionLabel({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <div className="px-3 mt-3 mb-1 text-[9px] font-semibold uppercase tracking-wider" style={{ color, fontFamily: "JetBrains Mono, monospace" }}>
      {children}
    </div>
  );
}

function CardA({
  title, sub, meta, tag, border, surface, primary, text, muted, subtle,
}: {
  title: string; sub: string; meta: string; tag?: string;
  border: string; surface: string; primary: string; text: string; muted: string; subtle: string;
}) {
  return (
    <div style={{ background: surface, border: `1px solid ${border}` }} className="rounded-lg px-4 py-3 flex items-center justify-between">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium" style={{ color: text }}>{title}</span>
          {tag && (
            <span className="text-[9px] font-semibold px-1.5 py-[1px] rounded" style={{ background: `${primary}22`, color: primary }}>
              {tag}
            </span>
          )}
        </div>
        <div className="text-[11px] mt-0.5" style={{ color: subtle, fontFamily: "JetBrains Mono, monospace" }}>{sub}</div>
        <div className="text-[10px] mt-1" style={{ color: muted, fontFamily: "JetBrains Mono, monospace" }}>{meta}</div>
      </div>
      <div className="flex items-center gap-1.5 text-[11px]" style={{ color: muted }}>
        <span className="px-2 py-1 rounded border" style={{ borderColor: border }}>测试</span>
        <span className="px-2 py-1 rounded border" style={{ borderColor: border }}>模型</span>
        <span className="px-2 py-1 rounded border" style={{ borderColor: border }}>···</span>
      </div>
    </div>
  );
}

function LogoDotgrid({ primary }: { primary: string }) {
  return (
    <div className="grid grid-cols-3 gap-[2px]" style={{ width: 14, height: 14 }}>
      {Array.from({ length: 9 }).map((_, i) => (
        <div key={i} style={{ background: [0, 2, 4, 6, 8].includes(i) ? primary : "transparent", borderRadius: 1 }} />
      ))}
    </div>
  );
}

/* ---------- Concept B: Mono Brutalist ---------- */

function ConceptB({ mode }: { mode: Mode }) {
  const dark = mode === "dark";
  const bg = dark ? "#000000" : "#FAFAF9";
  const surface = dark ? "#0A0A0A" : "#FFFFFF";
  const border = dark ? "#1F1F1F" : "#E5E5E5";
  const text = dark ? "#F5F5F5" : "#111111";
  const muted = dark ? "#888888" : "#666666";
  const primary = "#06B6D4";

  return (
    <div style={{ background: bg, color: text, fontFamily: "JetBrains Mono, monospace" }} className="flex h-[360px] text-[12px]">
      <aside style={{ background: surface, borderRight: `1px solid ${border}`, width: 220 }} className="shrink-0 flex flex-col">
        <div style={{ height: 44, borderBottom: `1px solid ${border}` }} className="flex items-center px-3">
          <span className="text-[13px] font-bold tracking-tight">
            [<span style={{ color: primary }}>allhands</span>]
          </span>
        </div>
        <nav className="py-2">
          <SectionLabelB color={muted}>── workspace</SectionLabelB>
          <NavItemB label="chat" active primary={primary} muted={muted} text={text} />
          <NavItemB label="conversations" muted={muted} text={text} />
          <SectionLabelB color={muted}>── gateway</SectionLabelB>
          <NavItemB label="providers" muted={muted} text={text} />
          <NavItemB label="models" muted={muted} text={text} />
          <SectionLabelB color={muted}>── runtime</SectionLabelB>
          <NavItemB label="confirmations" muted={muted} text={text} />
        </nav>
      </aside>

      <div className="flex-1 flex flex-col">
        <header style={{ height: 44, borderBottom: `1px solid ${border}` }} className="flex items-center justify-between px-5">
          <div>
            <span className="text-[12px] font-bold">$ providers</span>
            <span className="text-[10px] ml-2" style={{ color: muted }}>─ 2 items</span>
          </div>
          <button
            style={{ background: "transparent", color: primary, border: `1px solid ${primary}` }}
            className="text-[11px] font-bold px-2.5 py-1"
          >
            [+ new]
          </button>
        </header>
        <div className="p-5 space-y-1">
          <CardB title="OpenAI" sub="api.openai.com/v1" flag="* default" border={border} primary={primary} text={text} muted={muted} />
          <CardB title="DeepSeek" sub="api.deepseek.com/v1" border={border} primary={primary} text={text} muted={muted} />
        </div>
      </div>
    </div>
  );
}

function NavItemB({
  label, active, primary, muted, text,
}: { label: string; active?: boolean; primary?: string; muted: string; text: string }) {
  return (
    <div className="h-6 px-3 flex items-center text-[11px] cursor-pointer" style={{ color: active ? text : muted }}>
      <span style={{ color: active ? primary : muted, width: 14 }}>{active ? ">" : " "}</span>
      <span>{label}</span>
    </div>
  );
}

function SectionLabelB({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <div className="px-3 mt-3 mb-1 text-[9px] uppercase" style={{ color }}>
      {children}
    </div>
  );
}

function CardB({
  title, sub, flag, border, primary, text, muted,
}: {
  title: string; sub: string; flag?: string;
  border: string; primary: string; text: string; muted: string;
}) {
  return (
    <div style={{ border: `1px solid ${border}` }} className="px-3 py-2 flex items-center justify-between">
      <div className="flex items-baseline gap-3">
        <span style={{ color: primary }} className="text-[11px]">[+]</span>
        <div>
          <div className="text-[12px] font-bold" style={{ color: text }}>
            {title}
            {flag && <span className="text-[10px] ml-2" style={{ color: primary }}>{flag}</span>}
          </div>
          <div className="text-[10px]" style={{ color: muted }}>{sub}</div>
        </div>
      </div>
      <div className="text-[10px]" style={{ color: muted }}>test · models · del</div>
    </div>
  );
}

/* ---------- Concept C: Vercel Soft ---------- */

function ConceptC({ mode }: { mode: Mode }) {
  const dark = mode === "dark";
  const bg = dark ? "#0A0A0A" : "#FFFFFF";
  const surface = dark ? "#141414" : "#FAFAFA";
  const border = dark ? "#262626" : "#EAEAEA";
  const text = dark ? "#FFFFFF" : "#000000";
  const muted = dark ? "#A3A3A3" : "#666666";
  const subtle = dark ? "#525252" : "#999999";
  const primary = dark ? "#FFFFFF" : "#000000";
  const primaryFg = dark ? "#000000" : "#FFFFFF";
  const glow = dark
    ? "radial-gradient(ellipse 240px 80px at 50% -20%, rgba(255,255,255,0.06), transparent)"
    : "radial-gradient(ellipse 240px 80px at 50% -20%, rgba(0,0,0,0.04), transparent)";

  return (
    <div style={{ background: bg, color: text, fontFamily: "Inter, system-ui, sans-serif", position: "relative" }} className="flex h-[360px]">
      <div style={{ background: glow, position: "absolute", inset: 0, pointerEvents: "none" }} />
      <aside style={{ background: "transparent", borderRight: `1px solid ${border}`, width: 220 }} className="shrink-0 flex flex-col relative">
        <div style={{ height: 48 }} className="flex items-center px-4 gap-2">
          <div style={{ width: 18, height: 18, borderRadius: 5, background: primary, color: primaryFg }} className="flex items-center justify-center text-[10px] font-bold">
            a
          </div>
          <span className="text-[13px] font-semibold tracking-tight">allhands</span>
        </div>
        <nav className="px-2 py-1 text-[12px] space-y-0.5">
          <SectionLabelC color={subtle}>Workspace</SectionLabelC>
          <NavItemC label="Chat" active text={text} muted={muted} surface={surface} border={border} />
          <NavItemC label="Conversations" text={text} muted={muted} surface={surface} border={border} />
          <SectionLabelC color={subtle}>Gateway</SectionLabelC>
          <NavItemC label="Providers" text={text} muted={muted} surface={surface} border={border} />
          <NavItemC label="Models" text={text} muted={muted} surface={surface} border={border} />
          <SectionLabelC color={subtle}>Runtime</SectionLabelC>
          <NavItemC label="Confirmations" text={text} muted={muted} surface={surface} border={border} />
        </nav>
      </aside>

      <div className="flex-1 flex flex-col relative">
        <header style={{ height: 48 }} className="flex items-center justify-between px-6">
          <div>
            <div className="text-[14px] font-semibold tracking-tight">Providers</div>
            <div className="text-[10px]" style={{ color: subtle }}>
              Configure LLM endpoints · 2 active
            </div>
          </div>
          <button
            style={{ background: primary, color: primaryFg }}
            className="text-[11px] font-medium px-3 py-1.5 rounded-full shadow-sm"
          >
            Add Provider
          </button>
        </header>
        <div className="p-6 space-y-3">
          <CardC title="OpenAI" sub="api.openai.com/v1" meta="gpt-4o-mini" tag="Default" border={border} surface={surface} text={text} muted={muted} subtle={subtle} />
          <CardC title="DeepSeek" sub="api.deepseek.com/v1" meta="deepseek-chat" border={border} surface={surface} text={text} muted={muted} subtle={subtle} />
        </div>
      </div>
    </div>
  );
}

function NavItemC({
  label, active, text, muted, surface, border,
}: {
  label: string; active?: boolean; text: string; muted: string; surface: string; border: string;
}) {
  return (
    <div
      style={{
        background: active ? surface : "transparent",
        border: active ? `1px solid ${border}` : "1px solid transparent",
        color: active ? text : muted,
      }}
      className="h-7 px-3 flex items-center text-[12px] rounded-md cursor-pointer font-medium"
    >
      {label}
    </div>
  );
}

function SectionLabelC({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <div className="px-3 mt-3 mb-1 text-[10px] font-medium" style={{ color }}>
      {children}
    </div>
  );
}

function CardC({
  title, sub, meta, tag, border, surface, text, muted, subtle,
}: {
  title: string; sub: string; meta: string; tag?: string;
  border: string; surface: string; text: string; muted: string; subtle: string;
}) {
  return (
    <div
      style={{ background: surface, border: `1px solid ${border}` }}
      className="rounded-xl px-5 py-4 flex items-center justify-between transition-shadow"
    >
      <div>
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold tracking-tight" style={{ color: text }}>{title}</span>
          {tag && (
            <span
              style={{ border: `1px solid ${border}`, color: muted }}
              className="text-[9px] font-medium px-2 py-[2px] rounded-full"
            >
              {tag}
            </span>
          )}
        </div>
        <div className="text-[11px] mt-0.5" style={{ color: subtle, fontFamily: "JetBrains Mono, monospace" }}>{sub}</div>
        <div className="text-[11px] mt-1.5" style={{ color: muted }}>
          Model <span style={{ color: text, fontFamily: "JetBrains Mono, monospace" }}>{meta}</span>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <button style={{ border: `1px solid ${border}`, color: muted }} className="text-[11px] px-2.5 py-1 rounded-md hover:border-current">Test</button>
        <button style={{ border: `1px solid ${border}`, color: muted }} className="text-[11px] px-2.5 py-1 rounded-md hover:border-current">Models</button>
        <button style={{ border: `1px solid ${border}`, color: muted }} className="text-[11px] px-2 py-1 rounded-md">⋯</button>
      </div>
    </div>
  );
}

// silence TS "Unused" for placeholder object spread in header chip
const _u = useState;
void _u;

/* ========================================================================
 * Concept A — Deep Dive
 *   color / typography / buttons / inputs / badges / icon-replacements /
 *   animations / loading / empty / modal preview — in both dark & light
 * ====================================================================== */

function ConceptADeepDive() {
  return (
    <section>
      <div className="flex items-baseline gap-3 mb-3">
        <div className="text-3xl font-semibold tracking-tight">A+</div>
        <div>
          <h2 className="text-lg font-semibold">Linear Precise · 深度展示</h2>
          <p className="text-xs text-text-muted" style={{ fontFamily: "JetBrains Mono, monospace" }}>
            颜色 · 字号 · 按钮 · 输入 · 徽章 · icon 替代 · 动效 · loading · 空状态
          </p>
        </div>
      </div>

      {/* local keyframes — scoped to this page */}
      <style>{`
        @keyframes ah-spin { to { transform: rotate(360deg); } }
        @keyframes ah-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .5; transform: scale(.92); } }
        @keyframes ah-shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        @keyframes ah-bar-in { from { transform: scaleY(0); } to { transform: scaleY(1); } }
        @keyframes ah-caret { 0%, 45% { opacity: 1; } 50%, 95% { opacity: 0; } }
        @keyframes ah-dot { 0% { opacity: .2; } 50% { opacity: 1; } 100% { opacity: .2; } }
      `}</style>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ConceptFrame mode="dark">
          <DeepDiveFrame mode="dark" />
        </ConceptFrame>
        <ConceptFrame mode="light">
          <DeepDiveFrame mode="light" />
        </ConceptFrame>
      </div>
    </section>
  );
}

function useDeepDiveTokens(mode: Mode) {
  const dark = mode === "dark";
  return {
    bg: dark ? "#09090B" : "#FFFFFF",
    surface: dark ? "#111113" : "#FAFAFA",
    surface2: dark ? "#18181B" : "#F4F4F5",
    surface3: dark ? "#1F1F22" : "#EDEDEF",
    border: dark ? "#27272A" : "#E4E4E7",
    borderStrong: dark ? "#3F3F46" : "#D4D4D8",
    text: dark ? "#FAFAFA" : "#18181B",
    muted: dark ? "#A1A1AA" : "#71717A",
    subtle: dark ? "#71717A" : "#A1A1AA",
    primary: "#6366F1",
    primaryHover: "#7C7FF3",
    primaryFg: "#FFFFFF",
    success: "#10B981",
    warning: "#F59E0B",
    danger: "#EF4444",
  };
}

function DeepDiveFrame({ mode }: { mode: Mode }) {
  const t = useDeepDiveTokens(mode);
  return (
    <div
      style={{ background: t.bg, color: t.text, fontFamily: "Inter, system-ui, sans-serif" }}
      className="p-6 space-y-6"
    >
      <Group title="Color · 语义色板" t={t}>
        <div className="flex flex-wrap gap-2">
          <Swatch name="bg" hex={t.bg} t={t} outline />
          <Swatch name="surface" hex={t.surface} t={t} />
          <Swatch name="surface-2" hex={t.surface2} t={t} />
          <Swatch name="border" hex={t.border} t={t} />
          <Swatch name="text" hex={t.text} t={t} />
          <Swatch name="muted" hex={t.muted} t={t} />
          <Swatch name="primary" hex={t.primary} t={t} />
          <Swatch name="success" hex={t.success} t={t} />
          <Swatch name="warning" hex={t.warning} t={t} />
          <Swatch name="danger" hex={t.danger} t={t} />
        </div>
      </Group>

      <Group title="Typography · 字号阶梯" t={t}>
        <div className="space-y-1.5">
          <TypeRow size={26} weight={600} tracking="-0.01em" label="H1 · 26/600" t={t} sample="一个员工组织平台" />
          <TypeRow size={18} weight={600} tracking="-0.005em" label="H2 · 18/600" t={t} sample="模型网关 · 供应商" />
          <TypeRow size={14} weight={500} label="Label · 14/500" t={t} sample="默认模型" />
          <TypeRow size={13} weight={400} label="Body · 13/400" t={t} sample="第一步:配置一个兼容 OpenAI 协议的端点。" />
          <TypeRow size={11} weight={500} label="Caption · 11/500" mono t={t} sample="POST /api/providers · 201 Created" />
        </div>
      </Group>

      <Group title="Buttons · 五种,每种 4 状态" t={t}>
        <div className="space-y-2.5">
          <ButtonRow label="Primary" t={t} variant="primary" />
          <ButtonRow label="Secondary" t={t} variant="secondary" />
          <ButtonRow label="Ghost" t={t} variant="ghost" />
          <ButtonRow label="Danger" t={t} variant="danger" />
          <ButtonRow label="Icon-less glyph" t={t} variant="glyph" />
        </div>
        <p className="text-[10px] mt-2" style={{ color: t.subtle, fontFamily: "JetBrains Mono, monospace" }}>
          transition: 150ms cubic-bezier(.4,0,.2,1) · 无位移 · 仅颜色/边框变化
        </p>
      </Group>

      <Group title="Inputs · 焦点 1px 变色,无阴影膨胀" t={t}>
        <div className="space-y-2 max-w-sm">
          <InputDemo label="Base URL" value="https://api.openai.com/v1" t={t} mono focused={false} />
          <InputDemo label="API Key (focused)" value="sk-•••" t={t} mono focused />
          <InputDemo label="名称 (error)" value="" t={t} error placeholder="请输入供应商名称" />
        </div>
      </Group>

      <Group title="Badges · 角标与状态标签" t={t}>
        <div className="flex flex-wrap gap-1.5">
          <Badge t={t} tone="primary">默认</Badge>
          <Badge t={t} tone="neutral">已禁用</Badge>
          <Badge t={t} tone="success">connected</Badge>
          <Badge t={t} tone="warning">rate-limited</Badge>
          <Badge t={t} tone="danger">failed</Badge>
          <Badge t={t} tone="mono">gpt-4o-mini</Badge>
        </div>
      </Group>

      <Group title="Icon 替代方案 · 不用图标包,用有意义的元素" t={t}>
        <div className="grid grid-cols-2 gap-3">
          <GlyphCard t={t} title="键盘提示">
            <KbdChip t={t}>⌘</KbdChip>
            <KbdChip t={t}>K</KbdChip>
            <span style={{ color: t.subtle }} className="text-[11px] mx-1">·</span>
            <KbdChip t={t}>↵</KbdChip>
            <KbdChip t={t}>Esc</KbdChip>
          </GlyphCard>
          <GlyphCard t={t} title="状态点(会脉动)">
            <StatusDot color={t.success} pulse /> <span className="text-[11px]" style={{ color: t.muted }}>running</span>
            <StatusDot color={t.warning} pulse /> <span className="text-[11px]" style={{ color: t.muted }}>queued</span>
            <StatusDot color={t.danger} /> <span className="text-[11px]" style={{ color: t.muted }}>error</span>
          </GlyphCard>
          <GlyphCard t={t} title="mono 方向符(文字即图)">
            <span style={{ fontFamily: "JetBrains Mono, monospace", color: t.text }} className="text-[12px]">
              list → detail · a → b · prev ← next · ↑ up · ↓ down
            </span>
          </GlyphCard>
          <GlyphCard t={t} title="点阵 logo / 激活色条">
            <LogoDotgrid primary={t.primary} />
            <div className="ml-3 flex items-center h-6 relative pl-3" style={{ color: t.text }}>
              <span
                style={{ background: t.primary, animation: "ah-bar-in 180ms ease-out both", transformOrigin: "center" }}
                className="absolute left-0 top-1 bottom-1 w-[2px] rounded-r"
              />
              <span className="text-[12px]">active nav</span>
            </div>
          </GlyphCard>
          <GlyphCard t={t} title="允许的 1-line SVG(1.5px stroke)">
            <Stroke t={t} /> <Check t={t} /> <ArrowRight t={t} /> <External t={t} /> <Copy t={t} />
          </GlyphCard>
          <GlyphCard t={t} title="输入光标 · 打字态">
            <span className="text-[12px]" style={{ color: t.text, fontFamily: "JetBrains Mono, monospace" }}>
              user@allhands:~${" "}
              <span
                style={{
                  display: "inline-block",
                  width: 7,
                  height: 12,
                  background: t.primary,
                  verticalAlign: "-2px",
                  animation: "ah-caret 1s step-end infinite",
                }}
              />
            </span>
          </GlyphCard>
        </div>
      </Group>

      <Group title="Loading · 四种态,节奏一致" t={t}>
        <div className="grid grid-cols-2 gap-3">
          <GlyphCard t={t} title="Spinner">
            <Spinner color={t.primary} />
            <span className="text-[11px] ml-2" style={{ color: t.muted }}>Running…</span>
          </GlyphCard>
          <GlyphCard t={t} title="三点省略">
            <Dot color={t.primary} delay={0} />
            <Dot color={t.primary} delay={150} />
            <Dot color={t.primary} delay={300} />
          </GlyphCard>
          <GlyphCard t={t} title="Shimmer skeleton">
            <Shimmer t={t} w={180} h={10} />
            <div className="mt-1.5" />
            <Shimmer t={t} w={120} h={8} />
          </GlyphCard>
          <GlyphCard t={t} title="Progress bar">
            <div style={{ width: "100%", height: 4, background: t.surface2, borderRadius: 2, overflow: "hidden" }}>
              <div style={{ width: "62%", height: "100%", background: t.primary, transition: "width 300ms ease" }} />
            </div>
            <span className="text-[10px] mt-1.5" style={{ color: t.muted, fontFamily: "JetBrains Mono, monospace" }}>
              62% · 1240 / 2000 tokens
            </span>
          </GlyphCard>
        </div>
      </Group>

      <Group title="Card · hover 仅边框变亮,无位移" t={t}>
        <HoverCard t={t} />
      </Group>

      <Group title="Empty state · 占位虚线 + 文字引导" t={t}>
        <div
          style={{ border: `1px dashed ${t.border}`, background: t.surface }}
          className="rounded-lg p-5 text-center"
        >
          <p className="text-[12px]" style={{ color: t.text }}>尚未配置任何供应商</p>
          <p className="text-[11px] mt-1" style={{ color: t.muted }}>
            添加 OpenAI / DeepSeek / Ollama / 本地 vLLM 等兼容端点即可开始
          </p>
          <button
            style={{ background: t.primary, color: t.primaryFg }}
            className="text-[11px] font-medium px-3 py-1.5 rounded-md mt-3 transition-colors hover:opacity-95"
          >
            新建供应商
          </button>
        </div>
      </Group>

      <Group title="Modal preview · 确认对话" t={t}>
        <div
          style={{ background: t.surface, border: `1px solid ${t.border}` }}
          className="rounded-xl p-4 max-w-md"
        >
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-[13px] font-semibold" style={{ color: t.text }}>确认删除供应商</span>
            <Badge t={t} tone="danger">IRREVERSIBLE</Badge>
          </div>
          <p className="text-[12px]" style={{ color: t.muted }}>
            将删除「OpenAI」及其下的 3 个模型。此操作不可恢复。
          </p>
          <div className="flex gap-2 justify-end mt-4">
            <button
              style={{ border: `1px solid ${t.border}`, color: t.text }}
              className="text-[12px] px-3 py-1.5 rounded-md transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            >
              取消
            </button>
            <button
              style={{ background: t.danger, color: "#FFFFFF" }}
              className="text-[12px] font-medium px-3 py-1.5 rounded-md transition-opacity hover:opacity-90"
            >
              删除
            </button>
          </div>
        </div>
      </Group>
    </div>
  );
}

/* ---------- helpers for deep dive ---------- */

type Tokens = ReturnType<typeof useDeepDiveTokens>;

function Group({ title, t, children }: { title: string; t: Tokens; children: React.ReactNode }) {
  return (
    <div>
      <div
        className="text-[10px] font-semibold uppercase tracking-wider mb-2"
        style={{ color: t.subtle, fontFamily: "JetBrains Mono, monospace" }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function Swatch({ name, hex, t, outline }: { name: string; hex: string; t: Tokens; outline?: boolean }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <div
        style={{
          background: hex,
          border: outline ? `1px solid ${t.border}` : "1px solid transparent",
          width: 56,
          height: 40,
          borderRadius: 6,
        }}
      />
      <div className="text-[9px]" style={{ color: t.muted, fontFamily: "JetBrains Mono, monospace" }}>
        {name}
      </div>
      <div className="text-[9px]" style={{ color: t.subtle, fontFamily: "JetBrains Mono, monospace" }}>
        {hex}
      </div>
    </div>
  );
}

function TypeRow({
  size, weight, tracking, label, sample, mono, t,
}: {
  size: number; weight: number; tracking?: string; label: string; sample: string; mono?: boolean; t: Tokens;
}) {
  return (
    <div className="flex items-baseline gap-4">
      <div
        className="text-[10px] shrink-0 w-28"
        style={{ color: t.subtle, fontFamily: "JetBrains Mono, monospace" }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: size,
          fontWeight: weight,
          letterSpacing: tracking,
          color: t.text,
          fontFamily: mono ? "JetBrains Mono, monospace" : "Inter, system-ui, sans-serif",
        }}
      >
        {sample}
      </div>
    </div>
  );
}

function ButtonRow({
  label, t, variant,
}: {
  label: string; t: Tokens; variant: "primary" | "secondary" | "ghost" | "danger" | "glyph";
}) {
  const base = "text-[12px] font-medium px-3 py-1.5 rounded-md transition-colors";
  const styles: Record<typeof variant, { def: React.CSSProperties; hover: React.CSSProperties; disabled: React.CSSProperties }> = {
    primary: {
      def: { background: t.primary, color: t.primaryFg },
      hover: { background: t.primaryHover, color: t.primaryFg },
      disabled: { background: t.primary, color: t.primaryFg, opacity: 0.4 },
    },
    secondary: {
      def: { background: t.surface, color: t.text, border: `1px solid ${t.border}` },
      hover: { background: t.surface2, color: t.text, border: `1px solid ${t.borderStrong}` },
      disabled: { background: t.surface, color: t.muted, border: `1px solid ${t.border}`, opacity: 0.5 },
    },
    ghost: {
      def: { background: "transparent", color: t.muted },
      hover: { background: t.surface2, color: t.text },
      disabled: { background: "transparent", color: t.subtle, opacity: 0.5 },
    },
    danger: {
      def: { background: "transparent", color: t.danger, border: `1px solid ${t.border}` },
      hover: { background: `${t.danger}1A`, color: t.danger, border: `1px solid ${t.danger}80` },
      disabled: { background: "transparent", color: t.danger, border: `1px solid ${t.border}`, opacity: 0.4 },
    },
    glyph: {
      def: { background: t.surface, color: t.muted, border: `1px solid ${t.border}` },
      hover: { background: t.surface2, color: t.text, border: `1px solid ${t.borderStrong}` },
      disabled: { background: t.surface, color: t.subtle, border: `1px solid ${t.border}`, opacity: 0.5 },
    },
  };
  const s = styles[variant];
  return (
    <div className="flex items-center gap-3">
      <div
        className="text-[10px] w-24 shrink-0"
        style={{ color: t.subtle, fontFamily: "JetBrains Mono, monospace" }}
      >
        {label}
      </div>
      <button style={s.def} className={base}>
        {variant === "glyph" ? <GlyphChip t={t} /> : "Default"}
      </button>
      <button style={s.hover} className={base}>
        {variant === "glyph" ? <GlyphChip t={t} hover /> : "Hover"}
      </button>
      <button style={{ ...s.def }} className={`${base} relative`}>
        <span className="inline-flex items-center gap-1.5">
          <Spinner color={variant === "primary" || variant === "danger" ? t.primaryFg : t.muted} small />
          Loading…
        </span>
      </button>
      <button style={s.disabled} className={base} disabled>
        Disabled
      </button>
    </div>
  );
}

function GlyphChip({ t, hover }: { t: Tokens; hover?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <ArrowRight t={t} small />
      <span>{hover ? "Action" : "Action"}</span>
    </span>
  );
}

function InputDemo({
  label, value, placeholder, t, mono, focused, error,
}: {
  label: string; value: string; placeholder?: string; t: Tokens; mono?: boolean; focused?: boolean; error?: boolean;
}) {
  const borderColor = error ? t.danger : focused ? t.primary : t.border;
  return (
    <div>
      <div className="text-[10px] mb-1" style={{ color: t.muted }}>
        {label}
      </div>
      <div
        style={{
          background: t.bg,
          border: `1px solid ${borderColor}`,
          transition: "border-color 150ms ease",
        }}
        className="rounded-md px-3 py-2 text-[12px] flex items-center"
      >
        <span
          style={{
            color: value ? t.text : t.subtle,
            fontFamily: mono ? "JetBrains Mono, monospace" : "Inter, system-ui, sans-serif",
          }}
        >
          {value || placeholder}
        </span>
      </div>
      {error && (
        <div className="text-[10px] mt-1" style={{ color: t.danger }}>
          必填字段
        </div>
      )}
    </div>
  );
}

function Badge({
  children, t, tone,
}: {
  children: React.ReactNode;
  t: Tokens;
  tone: "primary" | "neutral" | "success" | "warning" | "danger" | "mono";
}) {
  const map: Record<typeof tone, { bg: string; fg: string; border?: string; mono?: boolean }> = {
    primary: { bg: `${t.primary}22`, fg: t.primary },
    neutral: { bg: t.surface2, fg: t.muted },
    success: { bg: `${t.success}1A`, fg: t.success },
    warning: { bg: `${t.warning}1A`, fg: t.warning },
    danger: { bg: `${t.danger}1A`, fg: t.danger },
    mono: { bg: t.surface2, fg: t.text, mono: true },
  };
  const s = map[tone];
  return (
    <span
      style={{
        background: s.bg,
        color: s.fg,
        fontFamily: s.mono ? "JetBrains Mono, monospace" : "Inter, system-ui, sans-serif",
      }}
      className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
    >
      {children}
    </span>
  );
}

function GlyphCard({ title, t, children }: { title: string; t: Tokens; children: React.ReactNode }) {
  return (
    <div
      style={{ background: t.surface, border: `1px solid ${t.border}` }}
      className="rounded-lg px-3 py-2.5"
    >
      <div
        className="text-[9px] font-semibold uppercase tracking-wider mb-1.5"
        style={{ color: t.subtle, fontFamily: "JetBrains Mono, monospace" }}
      >
        {title}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">{children}</div>
    </div>
  );
}

function KbdChip({ t, children }: { t: Tokens; children: React.ReactNode }) {
  return (
    <span
      style={{
        border: `1px solid ${t.border}`,
        background: t.surface2,
        color: t.muted,
        fontFamily: "JetBrains Mono, monospace",
      }}
      className="text-[10px] px-1.5 py-0.5 rounded"
    >
      {children}
    </span>
  );
}

function StatusDot({ color, pulse }: { color: string; pulse?: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 7,
        height: 7,
        borderRadius: "50%",
        background: color,
        animation: pulse ? "ah-pulse 1.6s ease-in-out infinite" : undefined,
        marginRight: 6,
      }}
    />
  );
}

function Spinner({ color, small }: { color: string; small?: boolean }) {
  const size = small ? 10 : 14;
  return (
    <span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        border: `1.5px solid ${color}40`,
        borderTopColor: color,
        borderRadius: "50%",
        animation: "ah-spin 700ms linear infinite",
      }}
    />
  );
}

function Dot({ color, delay }: { color: string; delay: number }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 6,
        height: 6,
        margin: "0 2px",
        borderRadius: "50%",
        background: color,
        animation: `ah-dot 1.2s ease-in-out ${delay}ms infinite`,
      }}
    />
  );
}

function Shimmer({ t, w, h }: { t: Tokens; w: number; h: number }) {
  return (
    <div
      style={{
        width: w,
        height: h,
        borderRadius: h / 2,
        background: `linear-gradient(90deg, ${t.surface2} 0%, ${t.surface3} 50%, ${t.surface2} 100%)`,
        backgroundSize: "200% 100%",
        animation: "ah-shimmer 1.4s linear infinite",
      }}
    />
  );
}

function HoverCard({ t }: { t: Tokens }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: t.surface,
        border: `1px solid ${hover ? t.borderStrong : t.border}`,
        transition: "border-color 180ms ease",
      }}
      className="rounded-lg px-4 py-3 flex items-center justify-between cursor-pointer max-w-md"
    >
      <div>
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium" style={{ color: t.text }}>OpenAI</span>
          <Badge t={t} tone="primary">默认</Badge>
        </div>
        <div className="text-[11px] mt-0.5" style={{ color: t.subtle, fontFamily: "JetBrains Mono, monospace" }}>
          https://api.openai.com/v1
        </div>
      </div>
      <span
        style={{
          color: hover ? t.text : t.subtle,
          transition: "color 180ms ease, transform 180ms ease",
          transform: hover ? "translateX(2px)" : "translateX(0)",
        }}
      >
        <ArrowRight t={t} />
      </span>
    </div>
  );
}

/* ---------- allowed 1-line SVGs (1.5px stroke) ---------- */

function Stroke({ t }: { t: Tokens }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M3 8 H13" stroke={t.muted} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
function Check({ t }: { t: Tokens }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M3.5 8.5 L6.5 11.5 L12.5 4.5" stroke={t.success} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ArrowRight({ t, small }: { t: Tokens; small?: boolean }) {
  const s = small ? 12 : 14;
  return (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <path d="M3 8 H12 M8 4 L12 8 L8 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: t.text }} />
    </svg>
  );
}
function External({ t }: { t: Tokens }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M6 4 H4 V12 H12 V10 M9 3 H13 V7 M13 3 L8 8" stroke={t.muted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function Copy({ t }: { t: Tokens }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <rect x="5" y="5" width="8" height="8" rx="1.5" stroke={t.muted} strokeWidth="1.5" />
      <path d="M11 5 V3.5 A1 1 0 0 0 10 2.5 H4 A1 1 0 0 0 3 3.5 V10 A1 1 0 0 0 4 11 H5" stroke={t.muted} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/* ---------- Shared state components (I-0007) ---------- */

function StateShowcase() {
  return (
    <section className="rounded-2xl border border-border p-6 bg-surface">
      <header className="mb-5">
        <h2 className="text-sm font-semibold mb-1">State 组件样本(EmptyState / ErrorState / LoadingState / FirstRun)</h2>
        <p className="text-xs text-text-muted">
          每个现有页面的空 / 错 / 载入 / 首次态都走这四个组件 · 禁止再写裸
          <span className="font-mono text-text"> &quot;Loading…&quot; / &quot;No data&quot; / &quot;Error&quot;</span> 字面量。
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ShowcaseCard title="EmptyState · 基础 + action">
          <EmptyState
            title="尚未配置任何供应商"
            description="添加 OpenAI / DeepSeek / Ollama 等兼容端点即可开始"
            action={{ label: "新建供应商", onClick: () => undefined }}
          />
        </ShowcaseCard>

        <ShowcaseCard title="ErrorState · 可回退 + detail">
          <ErrorState
            title="拉取供应商失败"
            description="连接超时 · 可重试"
            detail="GET /api/providers → timeout after 10s"
            action={{ label: "重试", onClick: () => undefined }}
          />
        </ShowcaseCard>

        <ShowcaseCard title="LoadingState · 三点 + skeleton">
          <div className="space-y-3">
            <LoadingState title="正在建立 SSE 连接" description="首次 snapshot < 1s" />
            <LoadingState variant="skeleton" />
          </div>
        </ShowcaseCard>

        <ShowcaseCard title="FirstRun · 首次访问引导">
          <FirstRun
            title="欢迎来到 allhands"
            description="先做这 3 步,5 分钟上手对话式员工组织"
            steps={[
              {
                title: "配置模型网关",
                description: "OpenAI / DeepSeek / 本地 vLLM",
                done: true,
              },
              {
                title: "和 Lead 说一句话,让它帮你建 1 个员工",
              },
              {
                title: "开第一个对话 · 观察 cockpit 实时推送",
              },
            ]}
            primaryAction={{ label: "开始", onClick: () => undefined }}
            secondaryAction={{ label: "先看文档", onClick: () => undefined }}
          />
        </ShowcaseCard>
      </div>
    </section>
  );
}

/* ---------- EmployeeCard showcase (I-0008 · create_employee render target) ---------- */

function EmployeeCardShowcase() {
  return (
    <section className="rounded-2xl border border-border p-6 bg-surface">
      <header className="mb-5">
        <h2 className="text-sm font-semibold mb-1">
          EmployeeCard · create_employee 的回包长这样
        </h2>
        <p className="text-xs text-text-muted">
          meta tool <span className="font-mono text-text">create_employee</span>{" "}
          成功后返回 <span className="font-mono text-text">{"{component: \"EmployeeCard\", props}"}</span> · Lead
          的回话里就直接渲染这个卡片 · 用户不用离开 /chat。
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ShowcaseCard title="active · 带 2px 激活色条">
          <EmployeeCard
            props={{
              employee_id: "emp_01HACTIVE",
              name: "Researcher",
              role: "Desk research specialist",
              system_prompt_preview:
                "你是一名擅长桌面研究的助手 · 必须引用来源 · 对存疑结论用 markdown 脚注标注。",
              skill_count: 2,
              tool_count: 7,
              model: { provider: "openai", name: "gpt-4o-mini" },
              status: "active",
            }}
            interactions={[]}
          />
        </ShowcaseCard>

        <ShowcaseCard title="draft · 刚建完还没跑过">
          <EmployeeCard
            props={{
              employee_id: "emp_02HDRAFT",
              name: "Writer",
              role: "稿件起草 + 排版润色",
              system_prompt_preview:
                "把输入材料改写成 300-500 字正式版 · 结尾不加 emoji · 标题控制在 18 字以内。",
              skill_count: 1,
              tool_count: 3,
              model: { provider: "deepseek", name: "deepseek-chat" },
              status: "draft",
            }}
            interactions={[]}
          />
        </ShowcaseCard>

        <ShowcaseCard title="paused · 临时停用">
          <EmployeeCard
            props={{
              employee_id: "emp_03HPAUSE",
              name: "Trader-Sim",
              role: "A 股行情观察 · 纯模拟不下单",
              system_prompt_preview: "只做只读观察 · 严禁调用任何 WRITE 工具。",
              skill_count: 3,
              tool_count: 5,
              model: { provider: "anthropic", name: "haiku" },
              status: "paused",
            }}
            interactions={[]}
          />
        </ShowcaseCard>

        <ShowcaseCard title="极简 props · 只塞 id + 名字">
          <EmployeeCard
            props={{
              employee_id: "emp_04HBARE",
              name: "Minimal",
            }}
            interactions={[]}
          />
        </ShowcaseCard>
      </div>
    </section>
  );
}

/* ---------- Viz.* showcase (activated by agent-design viz-skill spec) ---------- */

function VizShowcase() {
  return (
    <section className="rounded-2xl border border-border p-6 bg-surface">
      <header className="mb-5">
        <h2 className="text-sm font-semibold mb-1">Viz.* 渲染组件样本</h2>
        <p className="text-xs text-text-muted">
          skill <span className="font-mono text-text">allhands.render</span>{" "}
          · 这里每个组件都是 render tool 返回 payload 的目标组件,Agent 把数据塞进工具就长成这样。
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ShowcaseCard title="Viz.Table · 多行对比">
          <Table
            props={{
              columns: [
                { key: "name", label: "Name" },
                { key: "model", label: "Model" },
                { key: "iter", label: "Iter", align: "right" },
              ],
              rows: [
                { name: "Lead", model: "gpt-4o", iter: 12 },
                { name: "Researcher", model: "haiku", iter: 8 },
                { name: "Writer", model: "gpt-4o-mini", iter: 5 },
              ],
              caption: "当前对话涉及的员工",
            }}
            interactions={[]}
          />
        </ShowcaseCard>

        <ShowcaseCard title="Viz.KV · 单实体详情">
          <KV
            props={{
              items: [
                { label: "id", value: "emp_01HABC", hint: "uuid" },
                { label: "model", value: "gpt-4o" },
                { label: "tools", value: "12 registered" },
                { label: "skills", value: "render, artifacts" },
              ],
              title: "Lead Agent",
            }}
            interactions={[]}
          />
        </ShowcaseCard>

        <ShowcaseCard title="Viz.Cards · 并列方案">
          <Cards
            props={{
              cards: [
                {
                  title: "方案 A · 稳定",
                  description: "沿用现有 markdown + 手写样式,低风险。",
                  footer: "cost: low",
                  accent: "default",
                },
                {
                  title: "方案 B · 结构化",
                  description: "全量切 Viz.*,Agent 输出更密且可点。",
                  footer: "cost: mid",
                  accent: "primary",
                },
                {
                  title: "方案 C · 图表化",
                  description: "加 Recharts,图表类场景最强,但包大。",
                  footer: "cost: high",
                  accent: "warn",
                },
              ],
              columns: 3,
            }}
            interactions={[]}
          />
        </ShowcaseCard>

        <ShowcaseCard title="Viz.Callout · 提示 / 警告 / 成功 / 错误">
          <div className="space-y-3">
            <Callout
              props={{
                kind: "info",
                title: "INFO",
                content: "数据源更新,对话里的 token 计费将使用新价目表。",
              }}
              interactions={[]}
            />
            <Callout
              props={{
                kind: "warn",
                title: "HEADS UP",
                content: "执行 write_file 需确认 · 下次调用会弹 Confirmation Gate。",
              }}
              interactions={[]}
            />
            <Callout
              props={{
                kind: "success",
                title: "DONE",
                content: "8 条测试通过,分支已切回 main。",
              }}
              interactions={[]}
            />
            <Callout
              props={{
                kind: "error",
                title: "FAILED",
                content: "Provider 401 — 检查 API key 或点切换 provider。",
              }}
              interactions={[]}
            />
          </div>
        </ShowcaseCard>

        <ShowcaseCard title="Viz.Timeline · 过程 / 历史">
          <Timeline
            props={{
              items: [
                { title: "会话创建", status: "done", time: "10:02" },
                { title: "Lead 调用 dispatch_employee", status: "done", time: "10:04" },
                { title: "Researcher 在线", status: "in_progress", time: "10:05" },
                { title: "汇总回 Lead", status: "pending" },
              ],
            }}
            interactions={[]}
          />
        </ShowcaseCard>

        <ShowcaseCard title="Viz.Steps · wizard">
          <Steps
            props={{
              steps: [
                { title: "选 Provider", status: "done", description: "OpenAI / Anthropic / …" },
                { title: "填 API Key", status: "done", description: "写到加密存储" },
                { title: "拉模型列表", status: "in_progress", description: "第一次拉常见 30-60s" },
                { title: "挑默认模型", status: "pending" },
                { title: "开始对话", status: "pending" },
              ],
              current: 2,
            }}
            interactions={[]}
          />
        </ShowcaseCard>

        <ShowcaseCard title="Viz.Code · 代码片段">
          <Code
            props={{
              code: `def dispatch(employee_id: str, task: str) -> DispatchResult:\n    depth = current_dispatch_depth() + 1\n    if depth >= MAX_DISPATCH_DEPTH:\n        raise MaxDispatchDepthExceeded(depth, MAX_DISPATCH_DEPTH)\n    return run_sub_agent(employee_id, task, depth=depth)`,
              language: "python",
              filename: "execution/dispatch.py",
              highlightLines: [3, 4],
            }}
            interactions={[
              {
                kind: "button",
                label: "Copy",
                action: "copy_to_clipboard",
                payload: { text: "def dispatch(...)" },
              },
            ]}
          />
        </ShowcaseCard>

        <ShowcaseCard title="Viz.Diff · 前后对比">
          <Diff
            props={{
              before: "const max = 3;\nconst limit = max - 1;\nreturn limit;",
              after:
                "const max = MAX_DISPATCH_DEPTH;\nconst limit = max;\nreturn limit;",
              language: "typescript",
              filename: "dispatch.ts",
            }}
            interactions={[]}
          />
        </ShowcaseCard>

        <ShowcaseCard title="Viz.LinkCard · 富外链">
          <LinkCard
            props={{
              url: "https://docs.anthropic.com/",
              title: "Anthropic Docs",
              description: "Claude API / Agent SDK / Model docs.",
              siteName: "Anthropic",
            }}
            interactions={[]}
          />
        </ShowcaseCard>
      </div>
    </section>
  );
}

/* ---------- Render Library showcase (I-0012 · one sample per registered component) ---------- */

function RenderLibraryShowcase() {
  return (
    <section data-testid="render-library-showcase">
      <div className="mb-3">
        <h2 className="text-sm font-semibold mb-1">Render Library · 其余 render-tool 组件</h2>
        <p className="text-xs text-text-muted font-mono">
          MarkdownCard · PlanCard · PlanTimeline · Artifact.Preview — 对齐
          component-registry.ts 的全量清单(Viz.* 和 EmployeeCard 见前两节)。
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ShowcaseCard title="MarkdownCard · 富文本 / 代码块">
          <MarkdownCard
            props={{
              title: "研究笔记",
              content: [
                "# 日报 · 2026-04-20",
                "",
                "- 修掉 I-0002 / I-0003(gateway 数据健康)",
                "- **阶段 4.5** 自驱跑完,截图见验收包",
                "",
                "```python",
                "def budget(ctx: int, out: int) -> int:",
                "    return ctx - out  # ctx 必须 > 0(I-0002)",
                "```",
              ].join("\n"),
            }}
            interactions={[
              {
                kind: "button",
                label: "Copy",
                action: "copy_to_clipboard",
                payload: {},
              },
            ]}
          />
        </ShowcaseCard>

        <ShowcaseCard title="PlanCard · 等待人工审批(plan_id + steps)">
          <PlanCard
            props={{
              plan_id: "plan-demo-1",
              title: "迁移 provider.default_model",
              steps: [
                {
                  id: "s1",
                  title: "停用 glm-5 引用",
                  body: "把 Bailian.default_model 改成 qwen3.6-plus。",
                  status: "pending",
                },
                {
                  id: "s2",
                  title: "回归测试 set_default_model cross-check",
                  body: "新增 test_model_service_validation.py",
                  status: "pending",
                },
              ],
            }}
            interactions={[
              {
                kind: "button",
                label: "Approve",
                action: "invoke_tool",
                payload: { tool: "plan_approve", plan_id: "plan-demo-1" },
              },
              {
                kind: "button",
                label: "Reject",
                action: "invoke_tool",
                payload: { tool: "plan_reject", plan_id: "plan-demo-1" },
              },
            ]}
          />
        </ShowcaseCard>

        <ShowcaseCard title="PlanTimeline · 对话内进度备忘">
          <PlanTimeline
            props={{
              title: "发布 v0.4",
              steps: [
                { index: 1, title: "Round 1 · UI polish", status: "done" },
                { index: 2, title: "Round 2 · 多模态", status: "done" },
                {
                  index: 3,
                  title: "Round 3 · lifecycle",
                  status: "running",
                  note: "当前迭代",
                },
                { index: 4, title: "收尾 · 回归测试", status: "pending" },
                { index: 5, title: "热修 · I-0018", status: "skipped" },
              ],
            }}
            interactions={[]}
          />
        </ShowcaseCard>

        <ShowcaseCard title="Artifact.Preview · 真工件落地页">
          <div className="rounded-lg border border-border bg-surface p-4 text-xs text-text-muted font-mono">
            <p className="mb-2 text-text">Artifact.Preview</p>
            <p className="leading-relaxed">
              组件形如 <span className="font-mono text-text">{`{component: "Artifact.Preview", props: {artifact_id}}`}</span>
              · 实际内容需要已落库的 artifact,在 chat surface
              通过 render-tool 动态插入。活样本见
              <span className="font-mono text-text"> /chat</span> 中调用
              <span className="font-mono text-text"> render_artifact</span> 的轨迹。
            </p>
          </div>
        </ShowcaseCard>
      </div>
    </section>
  );
}

function ShowcaseCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-xs font-mono text-text-muted uppercase tracking-wide mb-2">
        {title}
      </div>
      {children}
    </div>
  );
}

/* ---------- Icon Gallery (ADR-0009 · Raycast-style) ---------- */

type IconEntry = { name: string; Icon: (p: IconProps) => JSX.Element };

const ICONS: IconEntry[] = [
  { name: "ChatIcon", Icon: ChatIcon },
  { name: "UserIcon", Icon: UserIcon },
  { name: "SkillIcon", Icon: SkillIcon },
  { name: "ModelIcon", Icon: ModelIcon },
  { name: "PluginIcon", Icon: PluginIcon },
  { name: "ProviderIcon", Icon: ProviderIcon },
  { name: "TriggerIcon", Icon: TriggerIcon },
  { name: "TaskIcon", Icon: TaskIcon },
  { name: "CockpitIcon", Icon: CockpitIcon },
  { name: "ObservatoryIcon", Icon: ObservatoryIcon },
  { name: "ChannelIcon", Icon: ChannelIcon },
  { name: "MarketIcon", Icon: MarketIcon },
  { name: "StockIcon", Icon: StockIcon },
  { name: "SettingsIcon", Icon: SettingsIcon },
  { name: "SearchIcon", Icon: SearchIcon },
  { name: "SendIcon", Icon: SendIcon },
  { name: "StopIcon", Icon: StopIcon },
  { name: "AttachIcon", Icon: AttachIcon },
  { name: "ThinkIcon", Icon: ThinkIcon },
  { name: "ExternalIcon", Icon: ExternalIcon },
  { name: "CopyIcon", Icon: CopyIcon },
  { name: "CheckIcon", Icon: CheckIcon },
];

function IconGallery() {
  const sizes = [16, 20, 24, 32];
  return (
    <section data-testid="icon-gallery">
      <div className="flex items-baseline gap-3 mb-3">
        <div className="text-3xl font-semibold tracking-tight">◢</div>
        <div>
          <h2 className="text-lg font-semibold">Icon Gallery</h2>
          <p className="text-xs text-text-muted font-mono">
            22 个自有 icon · 2px stroke · round caps · currentColor · web/components/icons/**
          </p>
        </div>
      </div>
      <ul className="mb-4 text-xs text-text-muted space-y-1 list-none pl-0">
        <li className="flex gap-2">
          <span className="text-text-subtle">·</span>
          <span>ADR-0009 允许自有 icon 系统;第三方 icon 库(lucide / heroicons / phosphor / tabler)仍禁。</span>
        </li>
        <li className="flex gap-2">
          <span className="text-text-subtle">·</span>
          <span>Default size 20px · strokeWidth 2 · fill none · 仅通过 stroke=&ldquo;currentColor&rdquo; 继承文字色。</span>
        </li>
      </ul>

      <div className="rounded-md border border-border bg-surface">
        <div className="px-4 py-2 border-b border-border flex items-center justify-between">
          <span className="text-[11px] font-mono text-text-muted uppercase tracking-wider">
            size 20 · default color
          </span>
          <span className="text-[11px] font-mono text-text-subtle">{ICONS.length} icons</span>
        </div>
        <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-px bg-border">
          {ICONS.map(({ name, Icon }) => (
            <div
              key={name}
              className="flex flex-col items-center justify-center gap-2 py-4 bg-surface text-text"
            >
              <Icon />
              <span className="text-[10px] font-mono text-text-subtle text-center px-1 break-all">
                {name}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 rounded-md border border-border bg-surface">
        <div className="px-4 py-2 border-b border-border">
          <span className="text-[11px] font-mono text-text-muted uppercase tracking-wider">
            size scale · 16 / 20 / 24 / 32
          </span>
        </div>
        <div className="flex items-center justify-around py-5 text-text">
          {sizes.map((s) => (
            <div key={s} className="flex flex-col items-center gap-2">
              <ChatIcon size={s} />
              <span className="text-[10px] font-mono text-text-subtle">{s}px</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 rounded-md border border-border bg-surface">
        <div className="px-4 py-2 border-b border-border">
          <span className="text-[11px] font-mono text-text-muted uppercase tracking-wider">
            color · currentColor 继承
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-border">
          <ColorSwatch label="text" className="text-text">
            <UserIcon />
          </ColorSwatch>
          <ColorSwatch label="muted" className="text-text-muted">
            <UserIcon />
          </ColorSwatch>
          <ColorSwatch label="primary" className="text-primary">
            <UserIcon />
          </ColorSwatch>
          <ColorSwatch label="danger" className="text-danger">
            <UserIcon />
          </ColorSwatch>
        </div>
      </div>
    </section>
  );
}

function ColorSwatch({
  label,
  className,
  children,
}: {
  label: string;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-5">
      <div className={className}>{children}</div>
      <span className="text-[10px] font-mono text-text-subtle">{label}</span>
    </div>
  );
}
