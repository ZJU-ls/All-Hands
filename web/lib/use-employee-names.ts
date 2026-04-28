"use client";

import { useEffect, useState } from "react";
import { listEmployees, type EmployeeDto } from "@/lib/api";

let cache: Map<string, string> | null = null;
let inflight: Promise<Map<string, string>> | null = null;

async function fetchEmployeeNameMap(): Promise<Map<string, string>> {
  if (cache) return cache;
  if (!inflight) {
    inflight = listEmployees()
      .then((employees: EmployeeDto[]) => {
        cache = new Map(employees.map((e) => [e.id, e.name]));
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
 * 客户端 hook · 把 employee_id (UUID) 翻译成员工名。返回 `(id) => name | short`
 * 形态的 lookup;员工列表还没拉到时退回前 8 字符,而不是空串,避免出现
 * 闪烁/视觉跳动。带 tooltip 时建议把原 id 作为 title 暴露给开发者。
 *
 * 缓存进 module-level — 一个会话里所有组件共享一份,/api/employees 只调一次。
 */
export function useEmployeeNames(): (id: string) => string {
  const [map, setMap] = useState<Map<string, string> | null>(cache);
  useEffect(() => {
    if (cache) return;
    let cancelled = false;
    void fetchEmployeeNameMap().then((m) => {
      if (!cancelled) setMap(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return (id: string) => map?.get(id) ?? shortenId(id);
}

/** Fallback when the employee map hasn't loaded yet — UUIDs become useless
 * after their first 8 hex chars, so we cut there. Non-UUID strings (test
 * fixtures, slugs) just pass through. */
export function shortenId(id: string): string {
  if (!id) return "";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id)) return id.slice(0, 8);
  return id;
}
