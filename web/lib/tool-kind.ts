/**
 * Tool-kind classification for UI rendering (frontend-only, no backend shape
 * changes). See product/06-ux-principles.md P13.
 *
 * System tools — built-in capabilities the platform ships with (meta / render
 * / builtin / artifacts / etc.). They're tied to our own contract and carry
 * well-known shapes, so the UI surfaces them inline as a compact pill:
 * dot + short name + one-line summary of the result. No click-to-expand:
 * the user doesn't need to audit payloads for our own tools, and every extra
 * affordance makes the chat transcript noisier.
 *
 * External tools — anything registered by the user / installed from MCP
 * servers / loaded from skill packs. Payloads are unknown, the user may
 * genuinely want to inspect args + result, and "run a black-box tool" is a
 * trust surface in a way that "Lead called list_providers" is not. Keep the
 * expandable `ToolCallCard`.
 *
 * The classification is pure-prefix by `tool_id` — no new backend field.
 * `allhands.*` tools are ours; MCP tools come in as `mcp.<server>.<name>`;
 * everything else is treated as external for safety.
 */

const SYSTEM_PREFIXES = [
  "allhands.meta.",
  "allhands.builtin.",
  "allhands.render.",
  "allhands.artifacts.",
  "allhands.cockpit.",
  "allhands.stock.",
  "allhands.channel.",
  "allhands.market.",
  "allhands.review.",
  "allhands.observatory.",
  "allhands.task.",
  "allhands.trigger.",
  "allhands.plan.",
  "allhands.skill.", // resolve_skill, skill-level controls
  "allhands.subagent.", // spawn_subagent
];

export type ToolKindForUi = "system" | "external";

export function classifyToolId(toolId: string): ToolKindForUi {
  for (const p of SYSTEM_PREFIXES) {
    if (toolId.startsWith(p)) return "system";
  }
  // Any `allhands.*` that slips past the allowlist is still ours — treat
  // as system. Without this fallback a new Wave N tool prefix would render
  // as an expandable card by default, which is the wrong direction.
  if (toolId.startsWith("allhands.")) return "system";
  return "external";
}

export function shortToolName(toolId: string): string {
  // "allhands.meta.list_providers" → "list_providers"
  // "mcp.Filesystem.read_file"     → "read_file"
  const parts = toolId.split(".");
  return parts[parts.length - 1] ?? toolId;
}
