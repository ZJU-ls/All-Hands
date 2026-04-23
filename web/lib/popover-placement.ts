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
/**
 * "start" = panel left edge aligns with trigger's left edge (extends rightward).
 * "end"   = panel right edge aligns with trigger's right edge (extends leftward).
 * Names are LTR-neutral so RTL rework is a prop rename, not a rule flip.
 */
export type PopoverAlign = "start" | "end";

export type VerticalRectLike = Pick<DOMRect, "top" | "bottom">;
export type HorizontalRectLike = Pick<DOMRect, "left" | "right">;

export function computePopoverSide(
  triggerRect: VerticalRectLike,
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

/**
 * Horizontal analog of `computePopoverSide`. Prevents the "panel is wider
 * than trigger and overflows into the sidebar / off the other edge" bug —
 * fresh example: the ModelOverrideChip in the chat composer row sat in the
 * left-packed control strip, so `end`-align (right-0) extended the 240px
 * panel leftward across the AppShell sidebar. Flip to `start` when the
 * preferred align overflows the viewport AND the opposite align fits.
 */
export function computePopoverAlign(
  triggerRect: HorizontalRectLike,
  panelWidth: number,
  viewportWidth: number,
  preferredAlign: PopoverAlign = "start",
): PopoverAlign {
  // start: panel covers [trigger.left, trigger.left + panelWidth]
  // end:   panel covers [trigger.right - panelWidth, trigger.right]
  const overflowsRightIfStart = triggerRect.left + panelWidth > viewportWidth;
  const overflowsLeftIfEnd = triggerRect.right - panelWidth < 0;
  if (preferredAlign === "start") {
    if (!overflowsRightIfStart) return "start";
    if (!overflowsLeftIfEnd) return "end";
    return "start";
  }
  if (!overflowsLeftIfEnd) return "end";
  if (!overflowsRightIfStart) return "start";
  return "end";
}
