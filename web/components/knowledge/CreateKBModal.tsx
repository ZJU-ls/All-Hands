"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Select } from "@/components/ui/Select";
import { type EmbeddingModelOption, type KBDto, createKB } from "@/lib/kb-api";
import { Field } from "./Field";
import { ModalShell } from "./ModalShell";

/**
 * CreateKBModal — name + description + embedder picker. Action-triggered
 * overlay (per redesign §3.5), not a route. Returns the freshly created KB
 * so the caller can router.push into it.
 */
export function CreateKBModal({
  models,
  onClose,
  onCreated,
  onError,
}: {
  models: EmbeddingModelOption[];
  onClose: () => void;
  onCreated: (kb: KBDto) => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations("knowledge.create");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [modelRef, setModelRef] = useState(
    models.find((m) => m.is_default && m.available)?.ref ??
      models.find((m) => m.available)?.ref ??
      "",
  );
  const [submitting, setSubmitting] = useState(false);

  const modelOptions = models.map((m) => ({
    value: m.ref,
    label: m.label,
    hint: t("embeddingHintDim", { dim: m.dim }),
    disabled: !m.available,
  }));

  async function submit() {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const kb = await createKB({
        name: name.trim(),
        description: description.trim(),
        embedding_model_ref: modelRef || undefined,
      });
      onCreated(kb);
    } catch (e) {
      onError(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell
      title={t("title")}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 items-center rounded-lg border border-border bg-surface px-3 text-[12px] text-text-muted hover:border-border-strong hover:text-text"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!name.trim() || submitting}
            className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-[12px] font-medium text-primary-fg hover:bg-primary-hover disabled:opacity-40"
          >
            {submitting ? t("submitting") : t("submit")}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t("fieldName")}>
          <input
            type="text"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("namePlaceholder")}
            className="h-9 w-full rounded-xl border border-border bg-surface px-3 text-[13px] text-text placeholder:text-text-subtle focus:border-border-strong focus:outline-none"
          />
        </Field>
        <Field label={t("fieldDescription")}>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder={t("descriptionPlaceholder")}
            className="w-full resize-none rounded-xl border border-border bg-surface px-3 py-2 text-[13px] text-text placeholder:text-text-subtle focus:border-border-strong focus:outline-none"
          />
        </Field>
        <Field label={t("fieldEmbedding")}>
          <Select
            value={modelRef}
            onChange={setModelRef}
            options={modelOptions}
            placeholder={t("embeddingPlaceholder")}
            className="w-full"
            triggerClassName="h-9 rounded-xl"
            ariaLabel={t("embeddingAria")}
          />
          <p className="mt-1 font-mono text-[10px] text-text-subtle">
            {t("embeddingHelp")}
          </p>
        </Field>
      </div>
    </ModalShell>
  );
}
