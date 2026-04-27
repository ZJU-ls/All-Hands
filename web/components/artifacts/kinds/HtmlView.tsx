"use client";

import { useTranslations } from "next-intl";

/**
 * HtmlView · sandboxed preview for HTML artifacts.
 *
 * Sandbox policy:
 *   `allow-scripts` — required for p5.js / canvas demos / any kind of
 *      interactive JS the user asks the agent to produce. Without it
 *      the iframe was rendering a static black canvas because the
 *      artifact's <script> tags simply never executed.
 *
 *   We intentionally do NOT add `allow-same-origin` — combined with
 *   allow-scripts it lets the embedded HTML reach the parent's
 *   localStorage / cookies (auth tokens, conversation IDs, …).
 *   Without same-origin the iframe runs in a unique opaque origin so
 *   a malicious snippet can't read any of our state.
 *
 *   We also leave allow-popups / allow-forms / allow-modals OFF —
 *   they're not needed for canvas/animation artifacts and reducing the
 *   surface area is cheaper than auditing each one. Add them back per-
 *   kind if a future artifact format genuinely needs them.
 */
export function HtmlView({ content }: { content: string }) {
  const t = useTranslations("artifacts.html");
  return (
    <iframe
      className="h-[60vh] w-full border-0 bg-bg"
      sandbox="allow-scripts"
      srcDoc={content}
      title={t("iframeTitle")}
    />
  );
}
