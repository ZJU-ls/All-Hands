"use client";

import { useEffect, useState } from "react";
import { listSkills, type SkillDto } from "@/lib/api";

let cache: Map<string, string> | null = null;
let inflight: Promise<Map<string, string>> | null = null;

async function fetchSkillNameMap(): Promise<Map<string, string>> {
  if (cache) return cache;
  if (!inflight) {
    inflight = listSkills()
      .then((skills: SkillDto[]) => {
        cache = new Map(skills.map((s) => [s.id, s.name]));
        return cache;
      })
      .catch(() => new Map<string, string>())
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/**
 * 客户端 hook · 把 skill_id 翻译成用户可读的 name。返回 `(id) => name | id`
 * 形态的 lookup;skill 列表还没拉到时退回原 id,避免出现"undefined"闪烁。
 *
 * 缓存进 module-level — 一个会话里所有组件共享一份,/api/skills 只调一次。
 */
export function useSkillNames(): (id: string) => string {
  const [map, setMap] = useState<Map<string, string> | null>(cache);
  useEffect(() => {
    if (cache) return;
    let cancelled = false;
    void fetchSkillNameMap().then((m) => {
      if (!cancelled) setMap(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return (id: string) => map?.get(id) ?? humanizeSkillId(id);
}

/** Fallback when the skill list hasn't loaded yet (or the id isn't known) —
 * strip the `allhands.skills.` / `allhands.builtin.` prefix and titlecase the
 * slug, so the user sees something readable instead of a dotted path. */
export function humanizeSkillId(id: string): string {
  const slug = id.replace(/^allhands\.(skills|builtin)\./, "");
  return slug
    .split(/[-_.]/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}
