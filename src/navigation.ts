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
