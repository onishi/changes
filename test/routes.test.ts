import { describe, expect, it } from "vitest";
import { isOverviewPath, parseRoute } from "../src/routes";

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

  it("treats dated and authenticated routes as period pages", () => {
    expect(isOverviewPath("/daily/2026-08-24")).toBe(false);
    expect(isOverviewPath("/all")).toBe(false);
    expect(isOverviewPath("/public/daily/2026-08-24")).toBe(false);
  });

  it("canonicalizes the authenticated root to its current daily page", () => {
    const canonicalPaths: string[] = [];
    const route = parseRoute({ pathname: "/all", search: "" }, (path) =>
      canonicalPaths.push(path),
    );

    expect(route.isOverview).toBe(false);
    expect(canonicalPaths).toEqual([`/all/daily/${route.key}`]);
  });
});
