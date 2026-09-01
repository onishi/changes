import { describe, expect, it } from "vitest";
import { isNavigableLinkClick, type LinkClickInfo } from "../src/navigation";

function clickInfo(overrides: Partial<LinkClickInfo> = {}): LinkClickInfo {
  return {
    button: 0,
    defaultPrevented: false,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    href: "/daily/2026-08-20",
    target: null,
    download: false,
    sameOrigin: true,
    ...overrides,
  };
}

describe("isNavigableLinkClick", () => {
  it("intercepts a plain left click on a same-origin link", () => {
    expect(isNavigableLinkClick(clickInfo())).toBe(true);
  });

  it("lets the browser handle modified clicks", () => {
    expect(isNavigableLinkClick(clickInfo({ metaKey: true }))).toBe(false);
    expect(isNavigableLinkClick(clickInfo({ ctrlKey: true }))).toBe(false);
    expect(isNavigableLinkClick(clickInfo({ shiftKey: true }))).toBe(false);
    expect(isNavigableLinkClick(clickInfo({ altKey: true }))).toBe(false);
  });

  it("lets the browser handle non-primary buttons", () => {
    expect(isNavigableLinkClick(clickInfo({ button: 1 }))).toBe(false);
  });

  it("lets the browser handle links without an href", () => {
    expect(isNavigableLinkClick(clickInfo({ href: null }))).toBe(false);
  });

  it("lets the browser handle downloads", () => {
    expect(isNavigableLinkClick(clickInfo({ download: true }))).toBe(false);
  });

  it("lets the browser open a new tab or window", () => {
    expect(isNavigableLinkClick(clickInfo({ target: "_blank" }))).toBe(false);
  });

  it("treats an explicit _self target like no target", () => {
    expect(isNavigableLinkClick(clickInfo({ target: "_self" }))).toBe(true);
  });

  it("lets the browser handle cross-origin links", () => {
    expect(isNavigableLinkClick(clickInfo({ sameOrigin: false }))).toBe(false);
  });

  it("respects a handler that already called preventDefault", () => {
    expect(isNavigableLinkClick(clickInfo({ defaultPrevented: true }))).toBe(
      false,
    );
  });
});
