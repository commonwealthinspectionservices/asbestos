"use client";

import { useEffect } from "react";

// Per Tim, 2026-08-31 — "anytime the project info tab, or any of those
// other tabs are open, the main screen behind it should totally lock...
// sometimes the screen behind it is scrolling when it shouldn't": a fixed
// inset-0 modal overlay doesn't stop the real page behind it from
// scrolling on its own (especially mobile Safari) unless the body itself
// is locked.
//
// Tried `position: fixed` on body first (the usual iOS-proof technique,
// which also re-anchors scroll to the saved offset on unlock) — dropped
// it after confirming live that it makes the modal itself stop compositing
// visibly in some rendering paths, even though it's genuinely mounted and
// interactive underneath (verified via elementFromPoint/computed styles
// while the screen showed nothing). Not worth that risk for this. Plain
// overflow: hidden is far less invasive — it doesn't touch body's
// positioning at all — and covers the actual reported case (background
// list scrolling behind an open dialog); it's not a full iOS rubber-band
// guarantee, but that tradeoff is safer than a modal that can silently
// fail to render.
let lockCount = 0;

function lockBodyScroll() {
  if (lockCount === 0) {
    document.body.style.overflow = "hidden";
  }
  lockCount++;
}

function unlockBodyScroll() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.body.style.overflow = "";
  }
}

/** Locks the real page's scroll while `active` is true — call unconditionally
    at the top of any modal/dialog component, passing whatever boolean (or
    just `true`, for a component that's only ever mounted while its own
    modal should be showing) already gates that modal's visibility. */
export function useLockBodyScroll(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    lockBodyScroll();
    return () => unlockBodyScroll();
  }, [active]);
}
