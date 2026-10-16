export interface AnchorBox {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface PanelSize {
  width: number;
  height: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface PopoverPlacement {
  top: number;
  left: number;
  /** Set only when the panel is taller than the room left on screen; the panel then scrolls. */
  maxHeight: number | null;
}

/** The gap kept between a popover and the viewport's edges, and between it and its anchor. */
export const POPOVER_EDGE_GAP_PX = 8;
export const POPOVER_ANCHOR_GAP_PX = 4;

/**
 * Where a popover panel goes, in viewport coordinates: under its anchor,
 * its inline-start edge on the anchor's (the right edge in a right-to-left
 * page), flipped above the anchor when it fits there and not below, and
 * always slid back inside the viewport with an 8px gap — so no ancestor's
 * overflow and no screen edge can cut any part of it off. A panel taller
 * than the viewport is capped to it and scrolls.
 */
export function placePopover(
  anchor: AnchorBox,
  panel: PanelSize,
  viewport: ViewportSize,
  direction: "rtl" | "ltr",
): PopoverPlacement {
  const gap = POPOVER_EDGE_GAP_PX;
  const preferredLeft = direction === "rtl" ? anchor.right - panel.width : anchor.left;
  const maxLeft = Math.max(gap, viewport.width - gap - panel.width);
  const left = Math.min(Math.max(preferredLeft, gap), maxLeft);

  const usableHeight = viewport.height - 2 * gap;
  if (panel.height > usableHeight) {
    return { top: gap, left, maxHeight: usableHeight };
  }
  const below = anchor.bottom + POPOVER_ANCHOR_GAP_PX;
  const above = anchor.top - POPOVER_ANCHOR_GAP_PX - panel.height;
  const fitsBelow = below + panel.height <= viewport.height - gap;
  const fitsAbove = above >= gap;
  const preferredTop = fitsBelow || !fitsAbove ? below : above;
  const top = Math.min(Math.max(preferredTop, gap), viewport.height - gap - panel.height);
  return { top, left, maxHeight: null };
}
