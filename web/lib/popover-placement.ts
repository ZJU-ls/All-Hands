/**
 * Popover placement · pick `top` or `bottom` based on viewport room.
 *
 * Why it exists: we have several trigger+panel pairs (Select, ConversationSwitcher,
 * ModelOverrideChip) that all need the same "prefer bottom, flip up when the
 * preferred side doesn't fit" decision. Hard-coding the direction breaks in
 * two predictable ways — see product/03-visual-design.md § 3.8.1:
 *
 *   - Hard-coded `bottom-full` (always opens upward): near the top of the
 *     viewport (e.g. chat header chips) the panel overlaps AppShell's menu
 *     bar. This is the L09 bug the user flagged on ModelOverrideChip.
 *   - Hard-coded `top-full` (always opens downward): near the bottom of the
 *     viewport or a scroll container the panel goes off-screen, so options
 *     become unreachable.
 *
 * `computePopoverSide` centralises the rule so every consumer behaves the
 * same. The preferred side wins unless it doesn't fit AND the opposite side
 * has strictly more space. When cramped on both sides we stick with the
 * preferred side — flipping to save 10px isn't worth the UX jitter.
 */

export type PopoverSide = "top" | "bottom";

export type TriggerRectLike = Pick<DOMRect, "top" | "bottom">;

export function computePopoverSide(
  triggerRect: TriggerRectLike,
  estimatedPanelHeight: number,
  viewportHeight: number,
  preferredSide: PopoverSide = "bottom",
): PopoverSide {
  const spaceBelow = viewportHeight - triggerRect.bottom;
  const spaceAbove = triggerRect.top;
  if (preferredSide === "bottom") {
    if (spaceBelow >= estimatedPanelHeight) return "bottom";
    if (spaceAbove > spaceBelow) return "top";
    return "bottom";
  }
  if (spaceAbove >= estimatedPanelHeight) return "top";
  if (spaceBelow > spaceAbove) return "bottom";
  return "top";
}
