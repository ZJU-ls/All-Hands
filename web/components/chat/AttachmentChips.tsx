"use client";

import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";
import {
  attachmentThumbnailUrl,
  type LocalAttachment,
} from "@/lib/attachments";

type Props = {
  attachments: LocalAttachment[];
  onRemove: (localId: string) => void;
};

export function AttachmentChips({ attachments, onRemove }: Props) {
  const t = useTranslations("chat.attachments");
  if (attachments.length === 0) return null;
  return (
    <div
      data-testid="attachment-chips"
      className="flex flex-wrap items-start gap-2 px-3 pb-2 pt-2.5 border-b border-border"
    >
      {attachments.map((a) => (
        <Chip key={a.localId} att={a} onRemove={() => onRemove(a.localId)} t={t} />
      ))}
    </div>
  );
}

function Chip({
  att,
  onRemove,
  t,
}: {
  att: LocalAttachment;
  onRemove: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const isImage = att.file.type.startsWith("image/");
  const status = att.status.state;
  const failed = status === "failed";
  const uploading = status === "uploading" || status === "queued";
  const uploaded = status === "uploaded";
  const dto = uploaded && att.status.state === "uploaded" ? att.status.dto : null;
  const sizeKb = Math.max(1, Math.round(att.file.size / 1024));

  // Image thumbnail src: prefer client-side blob URL for instant preview;
  // once uploaded, switch to server-side thumbnail (cached / smaller).
  const thumbSrc = isImage
    ? dto
      ? attachmentThumbnailUrl(dto.id)
      : att.previewUrl
    : null;

  return (
    <div
      data-testid="attachment-chip"
      className="group relative flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-2 py-1.5 max-w-[260px]"
    >
      {isImage && thumbSrc ? (
        // eslint-disable-next-line @next/next/no-img-element -- blob/local URL · next/image not applicable
        <img
          src={thumbSrc}
          alt={att.file.name}
          className="h-10 w-10 rounded object-cover"
        />
      ) : (
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded bg-surface text-text-muted">
          <Icon name="file" size={18} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] text-text" title={att.file.name}>
          {att.file.name}
        </div>
        <div className="truncate text-[10px] text-text-subtle">
          {sizeKb} KB
          {uploading && (
            <span className="ml-1 text-primary">
              {att.status.state === "uploading"
                ? `${Math.round((att.status.progress.loaded / att.status.progress.total) * 100)}%`
                : t("queued")}
            </span>
          )}
          {failed && (
            <span className="ml-1 text-danger" title={(att.status as { error: string }).error}>
              {t("failed")}
            </span>
          )}
          {uploaded && <span className="ml-1 text-success">✓</span>}
        </div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        title={t("remove")}
        className="rounded p-1 text-text-subtle opacity-60 hover:bg-surface hover:text-danger group-hover:opacity-100"
      >
        <Icon name="x" size={12} />
      </button>
    </div>
  );
}
