"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";
import type { LocalAttachment } from "@/lib/attachments";

type Props = {
  attachments: LocalAttachment[];
  modelSupportsImages: boolean | null;
  modelDisplayName?: string;
};

/** Show an orange warning when the user has attached image(s) but the
 * current employee's model doesn't support vision. Click-through link to
 * the model gateway so they can switch / register a vision-capable one. */
export function CapabilityBanner({
  attachments,
  modelSupportsImages,
  modelDisplayName,
}: Props) {
  const t = useTranslations("chat.attachments");
  const hasImage = attachments.some((a) => a.file.type.startsWith("image/"));
  if (!hasImage) return null;
  if (modelSupportsImages === null || modelSupportsImages) return null;

  return (
    <div
      data-testid="vision-fallback-banner"
      className="mb-2 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[12px] text-warning"
    >
      <Icon name="alert-triangle" size={14} className="mt-0.5 shrink-0" />
      <div className="flex-1">
        {modelDisplayName
          ? t("visionFallbackBannerNamed", { model: modelDisplayName })
          : t("visionFallbackBanner")}
      </div>
      <Link
        href="/gateway/models"
        className="shrink-0 underline-offset-2 hover:underline"
      >
        {t("switchModel")}
      </Link>
    </div>
  );
}
