"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { AgentMarkdown } from "@/components/chat/AgentMarkdown";
import { cn } from "@/lib/cn";

/**
 * Skill 「AI 解读」chip + streaming Markdown panel.
 *
 * Single fetch() to POST /api/skills/{id}/explain — body is a plain text
 * stream we read chunk-by-chunk and append to local state. Backend caches
 * per-skill so a second click is instant.
 */
export function SkillExplainer({ skillId }: { skillId: string }) {
  const [text, setText] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);
  // Tri-state: idle (no fetch yet) · loading (streaming chunks) · done · error.
  // P04 三态:loading 走 streaming 分支 · empty 不适用(单次解读不是列表) ·
  // error 显式渲染 errorMessage。
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  // Auto-scroll the panel to the latest content while streaming. Without
  // this the new lines render below the fold and the user has to scroll
  // by hand — a paper cut that makes the streaming feel inert. We only
  // pin to the bottom while loading; once done, the user scrolls freely.
  useEffect(() => {
    if (state !== "loading" || !bodyRef.current) return;
    bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [text, state]);

  const start = useCallback(async () => {
    setState("loading");
    setText("");
    setError(null);
    try {
      const res = await fetch(
        `/api/skills/${encodeURIComponent(skillId)}/explain`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`${res.status} ${body || res.statusText}`);
      }
      if (!res.body) {
        throw new Error("解读失败:响应没有 body");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let acc = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setText(acc);
      }
      acc += decoder.decode(); // flush
      setText(acc);
      setState("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  }, [skillId]);

  if (state === "idle") {
    return (
      <button
        type="button"
        onClick={() => void start()}
        data-testid="skill-explain-trigger"
        className={cn(
          "group inline-flex items-center gap-2 h-9 px-3.5 rounded-lg",
          "border border-primary/30 bg-primary/5 text-[12px] font-medium text-primary",
          "hover:bg-primary/10 hover:border-primary/50 transition-colors duration-fast",
        )}
        title="用 AI 解读这个技能在干什么、什么时候用"
      >
        <Icon name="sparkles" size={13} className="shrink-0" />
        <span>AI 解读</span>
      </button>
    );
  }

  return (
    <section
      data-testid="skill-explain-panel"
      className="rounded-xl border border-primary/30 bg-primary/[0.04] shadow-soft-sm"
    >
      <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-primary/20">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary text-primary-fg">
            <Icon
              name={state === "loading" ? "loader" : "sparkles"}
              size={14}
              className={state === "loading" ? "animate-spin-slow" : ""}
            />
          </span>
          <h3 className="text-sm font-semibold text-text">AI 解读</h3>
          {state === "loading" && (
            <span className="text-[11px] text-text-muted font-mono">生成中…</span>
          )}
          {state === "done" && (
            <span className="text-[11px] text-success font-mono">已完成</span>
          )}
        </div>
        {(state === "done" || state === "error") && (
          <button
            type="button"
            onClick={() => void start()}
            data-testid="skill-explain-regen"
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-border bg-surface text-[11px] text-text-muted hover:border-primary/40 hover:text-primary transition-colors duration-fast"
          >
            <Icon name="refresh" size={11} />
            重新解读
          </button>
        )}
      </header>
      <div
        ref={bodyRef}
        className="px-4 py-4 max-h-[480px] overflow-y-auto scroll-smooth"
      >
        {state === "error" ? (
          <p
            data-testid="skill-explain-error"
            className="text-[13px] text-danger"
          >
            {error}
          </p>
        ) : text ? (
          <AgentMarkdown content={text} />
        ) : (
          <p className="text-[13px] text-text-muted">等待第一段输出…</p>
        )}
      </div>
    </section>
  );
}
