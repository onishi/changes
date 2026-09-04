export interface LinkClickInfo {
  button: number;
  defaultPrevented: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  href: string | null;
  target: string | null;
  download: boolean;
  sameOrigin: boolean;
}

// Mirrors the checks browsers themselves use to decide whether a link click
// should be handled specially (new tab, download, ...) rather than navigated
// in place, so client-side routing only takes over plain same-page clicks.
export function isNavigableLinkClick(info: LinkClickInfo): boolean {
  if (info.defaultPrevented) return false;
  if (info.button !== 0) return false;
  if (info.metaKey || info.ctrlKey || info.shiftKey || info.altKey) {
    return false;
  }
  if (!info.href) return false;
  if (info.download) return false;
  if (info.target && info.target !== "_self") return false;
  if (!info.sameOrigin) return false;
  return true;
}

export type SwipeDirection = "previous" | "next";

export interface SwipeGesture {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  viewportWidth: number;
}

// Require a deliberate, predominantly horizontal gesture. The proportional
// threshold keeps short movements from paging on both narrow and wide phones.
export function horizontalSwipeDirection({
  startX,
  startY,
  endX,
  endY,
  viewportWidth,
}: SwipeGesture): SwipeDirection | null {
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const threshold = Math.max(50, Math.min(90, viewportWidth * 0.15));

  if (Math.abs(deltaX) < threshold) return null;
  if (Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return null;
  return deltaX > 0 ? "previous" : "next";
}
