"use client";

/**
 * ModelGenTestDialog · capability-aware test surface for image / video /
 * audio generation models.
 *
 * Sibling to the larger ModelTestDialog (chat). When the user clicks "测试"
 * on a model row whose capabilities include image_gen / video_gen / speech,
 * this compact dialog opens with a Mode tab strip that defaults to the
 * first non-chat capability the model declares.
 *
 * Each tab has its own form + result preview:
 *   image  → prompt + size + n          → <img> grid
 *   video  → prompt + resolution + dur  → <video controls>
 *   audio  → text + voice + format      → <audio controls>
 *
 * The backend dispatches through the unified ModelGateway · responses are
 * base64-inline so the preview renders without follow-up downloads.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";
import { useDismissOnEscape } from "@/lib/use-dismiss-on-escape";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

type Mode = "image" | "video" | "audio";
type ModelCapability = "chat" | "image_gen" | "video_gen" | "speech" | "embedding";

const CAP_TO_MODE: Record<string, Mode | undefined> = {
  image_gen: "image",
  video_gen: "video",
  speech: "audio",
};

export type GenModel = {
  id: string;
  name: string;
  display_name: string;
  capabilities?: ModelCapability[];
};

export type ModelGenTestDialogProps = {
  model: GenModel;
  onClose: () => void;
};

type GenStatus =
  | { state: "idle" }
  | { state: "running"; startedAt: number }
  | { state: "ok"; payload: unknown; durationMs: number }
  | { state: "error"; message: string };

export function ModelGenTestDialog({ model, onClose }: ModelGenTestDialogProps) {
  const t = useTranslations("gateway.modelGenTest");
  const caps = (model.capabilities ?? []) as ModelCapability[];
  const supportedModes: Mode[] = caps
    .map((c) => CAP_TO_MODE[c])
    .filter((m): m is Mode => Boolean(m));
  const fallback: Mode = supportedModes[0] ?? "image";
  const [mode, setMode] = useState<Mode>(fallback);
  useDismissOnEscape(true, onClose);

  return (
    <div
      data-testid="model-gen-test-dialog"
      className="fixed inset-0 z-50 grid place-items-center bg-bg/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl overflow-hidden rounded-2xl border border-border bg-surface shadow-soft-md"
      >
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary-muted text-primary">
              <Icon name="sparkles" size={16} />
            </span>
            <div className="min-w-0">
              <div className="truncate text-[14px] font-semibold text-text">
                {t("title", { model: model.display_name || model.name })}
              </div>
              <div className="truncate font-mono text-[11px] text-text-subtle">
                {model.name}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-text-muted hover:bg-surface-2 hover:text-text"
          >
            <Icon name="x" size={16} />
          </button>
        </header>

        <div className="flex gap-1 border-b border-border px-5 pt-3">
          {(["image", "video", "audio"] as Mode[]).map((m) => {
            const enabled = supportedModes.includes(m);
            const active = mode === m;
            return (
              <button
                key={m}
                type="button"
                disabled={!enabled}
                onClick={() => enabled && setMode(m)}
                title={
                  enabled
                    ? t(`tab.${m}`)
                    : t("tab.disabled", { mode: t(`tab.${m}`) })
                }
                className={`rounded-t-md px-3 py-1.5 text-[13px] transition-colors ${
                  active
                    ? "border-b-2 border-primary bg-surface text-primary"
                    : enabled
                      ? "text-text-muted hover:text-text"
                      : "text-text-subtle opacity-40"
                }`}
              >
                <Icon name={iconFor(m)} size={12} className="mr-1 inline-block" />
                {t(`tab.${m}`)}
              </button>
            );
          })}
        </div>

        <div className="px-5 py-4">
          {mode === "image" && <ImagePanel modelId={model.id} t={t} />}
          {mode === "video" && <VideoPanel modelId={model.id} t={t} />}
          {mode === "audio" && <AudioPanel modelId={model.id} t={t} />}
        </div>
      </div>
    </div>
  );
}

function iconFor(m: Mode): "image" | "video" | "audio" {
  if (m === "image") return "image";
  if (m === "video") return "video";
  return "audio";
}

// ============================================================================
// Image
// ============================================================================

function ImagePanel({
  modelId,
  t,
}: {
  modelId: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const [prompt, setPrompt] = useState(t("image.defaultPrompt"));
  const [size, setSize] = useState("1024x1024");
  const [n, setN] = useState(1);
  const [status, setStatus] = useState<GenStatus>({ state: "idle" });

  const submit = async () => {
    setStatus({ state: "running", startedAt: Date.now() });
    try {
      const res = await fetch(`${BASE}/api/models/${modelId}/test/image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, size, n }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(detail(body));
      }
      const data = await res.json();
      setStatus({
        state: "ok",
        payload: data,
        durationMs: data.duration_ms ?? 0,
      });
    } catch (e) {
      setStatus({ state: "error", message: String(e instanceof Error ? e.message : e) });
    }
  };

  const result = status.state === "ok" ? (status.payload as ImageResult) : null;

  return (
    <div className="space-y-3">
      <FormRow label={t("image.prompt")}>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-[13px] text-text outline-none focus:border-primary"
        />
      </FormRow>
      <div className="grid grid-cols-2 gap-3">
        <FormRow label={t("image.size")}>
          <select
            value={size}
            onChange={(e) => setSize(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-[13px] text-text outline-none"
          >
            <option value="1024x1024">1024×1024</option>
            <option value="1024x1440">1024×1440</option>
            <option value="1440x1024">1440×1024</option>
            <option value="auto">auto</option>
          </select>
        </FormRow>
        <FormRow label={t("image.n")}>
          <input
            type="number"
            min={1}
            max={4}
            value={n}
            onChange={(e) => setN(Math.max(1, Math.min(4, Number(e.target.value) || 1)))}
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-[13px] text-text outline-none"
          />
        </FormRow>
      </div>
      <RunButton status={status} onClick={submit} t={t} />
      <ErrorOrEmpty status={status} t={t} />
      {result && (
        <div>
          <div className="mb-2 text-[11px] text-text-muted">
            {t("metrics.duration")}: {fmtMs(result.duration_ms)} ·{" "}
            {t("metrics.modelUsed")}: <code>{result.model_used}</code>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {result.images.map((img, i) => (
              // eslint-disable-next-line @next/next/no-img-element -- base64 inline
              <img
                key={i}
                src={`data:${img.mime_type};base64,${img.data_b64}`}
                alt=""
                className="w-full rounded-lg border border-border"
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Video
// ============================================================================

function VideoPanel({
  modelId,
  t,
}: {
  modelId: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const [prompt, setPrompt] = useState(t("video.defaultPrompt"));
  const [resolution, setResolution] = useState("1280x720");
  const [duration, setDuration] = useState(5);
  const [status, setStatus] = useState<GenStatus>({ state: "idle" });

  const submit = async () => {
    setStatus({ state: "running", startedAt: Date.now() });
    try {
      const res = await fetch(`${BASE}/api/models/${modelId}/test/video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, resolution, duration_seconds: duration }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(detail(body));
      }
      const data = await res.json();
      setStatus({ state: "ok", payload: data, durationMs: data.duration_ms ?? 0 });
    } catch (e) {
      setStatus({ state: "error", message: String(e instanceof Error ? e.message : e) });
    }
  };

  const result = status.state === "ok" ? (status.payload as VideoResult) : null;

  return (
    <div className="space-y-3">
      <FormRow label={t("video.prompt")}>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-[13px] text-text outline-none focus:border-primary"
        />
      </FormRow>
      <div className="grid grid-cols-2 gap-3">
        <FormRow label={t("video.resolution")}>
          <select
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-[13px] text-text outline-none"
          >
            <option value="1280x720">1280×720 (HD)</option>
            <option value="1920x1080">1920×1080 (FHD)</option>
            <option value="720x1280">720×1280 (vertical)</option>
            <option value="1024x1024">1024×1024 (square)</option>
          </select>
        </FormRow>
        <FormRow label={t("video.duration")}>
          <input
            type="number"
            min={1}
            max={10}
            value={duration}
            onChange={(e) => setDuration(Math.max(1, Math.min(10, Number(e.target.value) || 5)))}
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-[13px] text-text outline-none"
          />
        </FormRow>
      </div>
      <RunButton status={status} onClick={submit} t={t} hint={t("video.slowHint")} />
      <ErrorOrEmpty status={status} t={t} />
      {result && (
        <div>
          <div className="mb-2 text-[11px] text-text-muted">
            {t("metrics.duration")}: {fmtMs(result.duration_ms)} ·{" "}
            {t("metrics.modelUsed")}: <code>{result.model_used}</code> ·{" "}
            {Math.round(result.video.size_bytes / 1024)} KB
          </div>
          <video
            controls
            src={`data:${result.video.mime_type};base64,${result.video.data_b64}`}
            className="w-full rounded-lg border border-border"
          />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Audio (TTS)
// ============================================================================

function AudioPanel({
  modelId,
  t,
}: {
  modelId: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const [text, setText] = useState(t("audio.defaultText"));
  const [voice, setVoice] = useState("longxiaochun");
  const [format, setFormat] = useState("mp3");
  const [speed, setSpeed] = useState(1.0);
  const [status, setStatus] = useState<GenStatus>({ state: "idle" });

  const submit = async () => {
    setStatus({ state: "running", startedAt: Date.now() });
    try {
      const res = await fetch(`${BASE}/api/models/${modelId}/test/audio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice, format, speed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(detail(body));
      }
      const data = await res.json();
      setStatus({ state: "ok", payload: data, durationMs: data.duration_ms ?? 0 });
    } catch (e) {
      setStatus({ state: "error", message: String(e instanceof Error ? e.message : e) });
    }
  };

  const result = status.state === "ok" ? (status.payload as AudioResult) : null;

  return (
    <div className="space-y-3">
      <FormRow label={t("audio.text")}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-[13px] text-text outline-none focus:border-primary"
        />
      </FormRow>
      <div className="grid grid-cols-3 gap-3">
        <FormRow label={t("audio.voice")}>
          <input
            value={voice}
            onChange={(e) => setVoice(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-[13px] text-text outline-none"
          />
        </FormRow>
        <FormRow label={t("audio.format")}>
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-[13px] text-text outline-none"
          >
            <option value="mp3">mp3</option>
            <option value="wav">wav</option>
            <option value="ogg">ogg</option>
          </select>
        </FormRow>
        <FormRow label={t("audio.speed")}>
          <input
            type="number"
            min={0.5}
            max={2.0}
            step={0.1}
            value={speed}
            onChange={(e) => setSpeed(Math.max(0.5, Math.min(2.0, Number(e.target.value) || 1)))}
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-[13px] text-text outline-none"
          />
        </FormRow>
      </div>
      <RunButton status={status} onClick={submit} t={t} />
      <ErrorOrEmpty status={status} t={t} />
      {result && (
        <div>
          <div className="mb-2 text-[11px] text-text-muted">
            {t("metrics.duration")}: {fmtMs(result.duration_ms)} ·{" "}
            {t("metrics.modelUsed")}: <code>{result.model_used}</code> ·{" "}
            {Math.round(result.audio.size_bytes / 1024)} KB
          </div>
          <audio
            controls
            src={`data:${result.audio.mime_type};base64,${result.audio.data_b64}`}
            className="w-full"
          />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Shared
// ============================================================================

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-wide text-text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

function RunButton({
  status,
  onClick,
  t,
  hint,
}: {
  status: GenStatus;
  onClick: () => void;
  t: ReturnType<typeof useTranslations>;
  hint?: string;
}) {
  const running = status.state === "running";
  const elapsed = useElapsed(status);
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onClick}
        disabled={running}
        className="rounded-lg bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
      >
        {running ? t("running", { elapsed }) : t("run")}
      </button>
      {hint && !running && <span className="text-[11px] text-text-subtle">{hint}</span>}
      {running && hint && <span className="text-[11px] text-warning">{hint}</span>}
    </div>
  );
}

function ErrorOrEmpty({
  status,
  t,
}: {
  status: GenStatus;
  t: ReturnType<typeof useTranslations>;
}) {
  if (status.state !== "error") return null;
  return (
    <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-[12px] text-danger">
      <div className="font-medium">{t("error")}</div>
      <div className="mt-1 break-words">{status.message}</div>
    </div>
  );
}

function useElapsed(status: GenStatus): string {
  const [, force] = useState(0);
  const ref = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (status.state !== "running") {
      if (ref.current) clearInterval(ref.current);
      return;
    }
    ref.current = setInterval(() => force((x) => x + 1), 250);
    return () => {
      if (ref.current) clearInterval(ref.current);
    };
  }, [status.state]);
  if (status.state !== "running") return "";
  return fmtMs(Date.now() - status.startedAt);
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function detail(body: unknown): string {
  if (typeof body !== "object" || !body) return "request failed";
  const d = (body as { detail?: unknown }).detail;
  if (typeof d === "string") return d;
  if (typeof d === "object" && d) {
    const e = d as Record<string, unknown>;
    return [
      typeof e.error === "string" ? e.error : "",
      typeof e.hint === "string" ? `· ${e.hint}` : "",
    ]
      .join(" ")
      .trim();
  }
  return "request failed";
}

// ----- Result types --------------------------------------------------------

type ImageResult = {
  duration_ms: number;
  model_used: string;
  cost_usd: number | null;
  images: Array<{
    mime_type: string;
    data_b64: string;
    size: string;
    revised_prompt: string | null;
  }>;
};

type VideoResult = {
  duration_ms: number;
  model_used: string;
  video: {
    mime_type: string;
    data_b64: string;
    resolution: string;
    duration_seconds: number;
    fps: number | null;
    size_bytes: number;
  };
};

type AudioResult = {
  duration_ms: number;
  model_used: string;
  audio: {
    mime_type: string;
    data_b64: string;
    format: string;
    size_bytes: number;
  };
};
