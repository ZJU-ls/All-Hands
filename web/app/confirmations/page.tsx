"use client";
import { useTranslations } from "next-intl";
import { PlaceholderPage } from "@/components/shell/PlaceholderPage";
export default function Page() {
  const t = useTranslations("pages.confirmations");
  return (
    <PlaceholderPage
      title={t("title")}
      description={t("description")}
    />
  );
}
