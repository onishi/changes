import { describe, expect, it } from "vitest";
import {
  buildPath,
  isOverviewPath,
  keyboardShortcutPath,
  parseRoute,
} from "../src/routes";

describe("frontend routes", () => {
  it("keeps the public roots on the overview", () => {
    expect(isOverviewPath("/")).toBe(true);
    expect(isOverviewPath("/public")).toBe(true);
    expect(isOverviewPath("/public/")).toBe(true);

    const canonicalPaths: string[] = [];
    const route = parseRoute({ pathname: "/", search: "" }, (path) =>
      canonicalPaths.push(path),
    );
    expect(route.isOverview).toBe(true);
    expect(canonicalPaths).toEqual([]);
  });

  it("treats public repository roots as overview pages", () => {
    expect(isOverviewPath("/repo/kinki-zoo/")).toBe(true);
    expect(isOverviewPath("/public/repo/kinki-zoo")).toBe(true);

    const canonicalPaths: string[] = [];
    const route = parseRoute(
      { pathname: "/repo/kinki-zoo/", search: "" },
      (path) => canonicalPaths.push(path),
    );
    expect(route.isOverview).toBe(true);
    expect(route.scope).toBe("public");
    expect(route.repository).toBe("kinki-zoo");
    expect(canonicalPaths).toEqual([]);
  });

  it("treats dated routes as period pages", () => {
    expect(isOverviewPath("/daily/2026-08-24")).toBe(false);
    expect(isOverviewPath("/public/daily/2026-08-24")).toBe(false);
    expect(isOverviewPath("/repo/kinki-zoo/daily/2026-08-24")).toBe(false);
  });

  it("keeps authenticated roots on overview pages", () => {
    const canonicalPaths: string[] = [];
    const route = parseRoute({ pathname: "/all", search: "" }, (path) =>
      canonicalPaths.push(path),
    );

    expect(isOverviewPath("/all")).toBe(true);
    expect(isOverviewPath("/all/")).toBe(true);
    expect(isOverviewPath("/all/repo/kinki-zoo/")).toBe(true);
    expect(route.scope).toBe("all");
    expect(route.isOverview).toBe(true);
    expect(canonicalPaths).toEqual([]);
  });

  it("clamps routes and period switches to the data cutoff", () => {
    const canonicalPaths: string[] = [];
    const route = parseRoute(
      { pathname: "/daily/2026-04-30", search: "" },
      (path) => canonicalPaths.push(path),
    );

    expect(route.key).toBe("2026-05-01");
    expect(canonicalPaths).toEqual(["/daily/2026-05-01"]);
    expect(
      buildPath(
        {
          ...route,
          period: "weekly",
          key: "2026-04-26",
        },
        { period: "monthly" },
      ),
    ).toBe("/monthly/2026-05");
  });

  it("builds period and previous/next keyboard shortcut paths", () => {
    const route = parseRoute({ pathname: "/daily/2026-08-20", search: "" });
    const navigation = {
      previousKey: "2026-08-19",
      nextKey: "2026-08-21",
    };
    expect(keyboardShortcutPath(route, "p", navigation)).toBe(
      "/daily/2026-08-19",
    );
    expect(keyboardShortcutPath(route, "N", navigation)).toBe(
      "/daily/2026-08-21",
    );
    expect(keyboardShortcutPath(route, "w", navigation)).toBe(
      "/weekly/2026-08-16",
    );
    expect(keyboardShortcutPath(route, "m", navigation)).toBe(
      "/monthly/2026-08",
    );
    expect(keyboardShortcutPath(route, "d", navigation)).toBeNull();
  });

  it("supports period shortcuts but not navigation shortcuts on overviews", () => {
    const route = parseRoute({ pathname: "/all/", search: "" });
    expect(keyboardShortcutPath(route, "d")).toBe(`/all/daily/${route.key}`);
    expect(keyboardShortcutPath(route, "n")).toBeNull();
    expect(keyboardShortcutPath(route, "p")).toBeNull();
  });
});
