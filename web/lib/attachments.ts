/**
 * Attachment upload client — POST /api/attachments + dedup awareness.
 *
 * Returns a typed AttachmentDto on success or a structured error. The chat
 * surface holds AttachmentInProgress state per file (queued / uploading /
 * uploaded / failed); when uploaded the server's Attachment id is stored
 * and forwarded to POST /messages as `attachment_ids`.
 */

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

export type AttachmentDto = {
  id: string;
  sha256: string;
  mime: string;
  filename: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  conversation_id: string | null;
  kind: "image" | "file";
  created_at: string;
};

export type AttachmentUploadProgress = {
  loaded: number;
  total: number;
};

export type AttachmentUploadStatus =
  | { state: "queued" }
  | { state: "uploading"; progress: AttachmentUploadProgress }
  | { state: "uploaded"; dto: AttachmentDto }
  | { state: "failed"; error: string };

export type LocalAttachment = {
  /** Stable client-side id for React keying. */
  localId: string;
  /** Original File object (held until upload finishes — for previews). */
  file: File;
  /** Object URL for client-side preview (revoked on remove). */
  previewUrl: string | null;
  status: AttachmentUploadStatus;
};

const MAX_BYTES = 20 * 1024 * 1024;

const ALLOWED_MIME_PREFIXES = ["image/", "text/"];
const ALLOWED_MIMES = new Set([
  "application/pdf",
  "application/json",
  "application/xml",
  "application/x-yaml",
  "application/zip",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

export function isAllowedMime(mime: string): boolean {
  if (!mime) return false;
  if (ALLOWED_MIME_PREFIXES.some((p) => mime.startsWith(p))) return true;
  return ALLOWED_MIMES.has(mime);
}

export function preflight(file: File): { ok: true } | { ok: false; reason: string } {
  if (file.size === 0) return { ok: false, reason: "empty" };
  if (file.size > MAX_BYTES) return { ok: false, reason: "too_large" };
  if (file.type && !isAllowedMime(file.type)) {
    // file.type can be empty for some platforms; allow through and let the
    // server make the final decision via extension lookup.
    return { ok: false, reason: "bad_mime" };
  }
  return { ok: true };
}

export async function uploadAttachment(
  file: File,
  options: {
    conversationId?: string | null;
    onProgress?: (p: AttachmentUploadProgress) => void;
    signal?: AbortSignal;
  } = {},
): Promise<AttachmentDto> {
  const form = new FormData();
  form.append("file", file, file.name);
  if (options.conversationId) {
    form.append("conversation_id", options.conversationId);
  }
  // We use XHR for upload progress since fetch doesn't expose it portably yet.
  return await new Promise<AttachmentDto>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}/api/attachments`);
    if (options.onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          options.onProgress?.({ loaded: e.loaded, total: e.total });
        }
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as AttachmentDto);
        } catch (e) {
          reject(new Error(`Failed to parse response: ${String(e)}`));
        }
      } else {
        let detail = `HTTP ${xhr.status}`;
        try {
          const body = JSON.parse(xhr.responseText);
          if (body && typeof body.detail === "string") detail = body.detail;
        } catch {
          // ignore
        }
        reject(new Error(detail));
      }
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.onabort = () => reject(new Error("aborted"));
    if (options.signal) {
      options.signal.addEventListener("abort", () => xhr.abort());
    }
    xhr.send(form);
  });
}

export function makeLocalId(): string {
  return `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function fileIcon(mime: string): "image" | "file-text" | "file" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("text/")) return "file-text";
  if (mime === "application/pdf") return "file-text";
  return "file";
}

export function attachmentThumbnailUrl(id: string): string {
  return `${BASE}/api/attachments/${id}/thumbnail`;
}

export function attachmentContentUrl(id: string): string {
  return `${BASE}/api/attachments/${id}/content`;
}
