const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

export type SystemPathEntry = {
  key: string;
  label: string;
  description: string;
  path: string;
  env_var: string | null;
  configurable: boolean;
  builtin: boolean;
};

export async function listSystemPaths(): Promise<SystemPathEntry[]> {
  const res = await fetch(`${BASE}/api/system/paths`);
  if (!res.ok) throw new Error(`listSystemPaths failed: ${res.status}`);
  const body = (await res.json()) as { paths: SystemPathEntry[] };
  return body.paths;
}

/** Best-effort 「在文件管理器打开」. Today this is a no-op stub on the web —
 * desktop shells (Electron / Tauri) inject ``window.allhands.openPath`` and
 * we delegate. Returns a status the caller can render to the user. */
export type OpenPathResult =
  | { status: "ok" }
  | { status: "unsupported"; reason: "no-bridge" | "blocked" }
  | { status: "error"; message: string };

declare global {
  interface Window {
    allhands?: {
      openPath?: (path: string) => Promise<{ ok: boolean; error?: string }>;
    };
  }
}

export async function openSystemPath(path: string): Promise<OpenPathResult> {
  if (typeof window === "undefined") return { status: "unsupported", reason: "no-bridge" };
  const bridge = window.allhands?.openPath;
  if (!bridge) return { status: "unsupported", reason: "no-bridge" };
  try {
    const res = await bridge(path);
    if (res.ok) return { status: "ok" };
    return { status: "error", message: res.error ?? "open failed" };
  } catch (e) {
    return { status: "error", message: String(e) };
  }
}
