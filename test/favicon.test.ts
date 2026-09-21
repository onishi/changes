import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  ACTIVITY_SQUARE_SIZE,
  activitySquareRange,
  buildActivitySquare,
} from "../shared/activity";
import { FAVICON_SIZE, renderActivityFavicon } from "../worker/favicon";
import { decodePng, faviconCellCenter } from "./png";

describe("activity square", () => {
  it("covers the last 49 days with today in the bottom right corner", () => {
    const range = activitySquareRange("2026-09-20");
    expect(range.startKey).toBe("2026-08-03");
    expect(range.endKey).toBe("2026-09-20");

    const columns = buildActivitySquare(range, new Map());
    expect(columns).toHaveLength(ACTIVITY_SQUARE_SIZE);
    expect(columns.every((column) => column.length === 7)).toBe(true);
    expect(columns[0]?.[0]?.date).toBe("2026-08-03");
    // Columns run oldest to newest, and so does each column.
    expect(columns[0]?.[6]?.date).toBe("2026-08-09");
    expect(columns[1]?.[0]?.date).toBe("2026-08-10");
    expect(columns[6]?.[6]?.date).toBe("2026-09-20");
  });

  it("shades the square against its own busiest day", () => {
    const columns = buildActivitySquare(
      activitySquareRange("2026-09-20"),
      new Map([
        ["2026-09-20", 20],
        ["2026-09-19", 5],
      ]),
    );
    expect(columns[6]?.[6]?.level).toBe(4);
    expect(columns[6]?.[5]?.level).toBe(1);
    expect(columns[0]?.[0]?.level).toBe(0);
  });
});

describe("favicon rendering", () => {
  it("draws one square per day at full resolution", async () => {
    const levels = [
      [4, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 2],
    ];
    const image = await decodePng(await renderActivityFavicon(levels));

    expect(image.width).toBe(FAVICON_SIZE);
    expect(image.height).toBe(FAVICON_SIZE);
    expect(image.pixel(...faviconCellCenter(0, 0))).toEqual([39, 93, 71]);
    expect(image.pixel(...faviconCellCenter(6, 6))).toEqual([152, 174, 159]);
    expect(image.pixel(...faviconCellCenter(3, 3))).toEqual([230, 224, 211]);
    // The gap between two cells keeps the page background, and so does the
    // outside of a rounded corner.
    expect(image.pixel(16 + 65, 16 + 30)).toEqual([244, 240, 231]);
    expect(image.pixel(16, 16)).toEqual([244, 240, 231]);
  });

  it("rejects a square that is not seven columns wide", async () => {
    await expect(renderActivityFavicon([[0], [0]])).rejects.toThrow(
      "one column per day",
    );
  });

  it("rejects a square whose columns are not seven rows tall", async () => {
    await expect(
      renderActivityFavicon([
        [0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0],
      ]),
    ).rejects.toThrow("one row per day");
  });

  it("keeps its shades in step with the stylesheet", () => {
    const { TEST_STYLES: styles } = env as typeof env & { TEST_STYLES: string };
    // The renderer cannot read CSS custom properties, so the two lists are
    // written out separately; they must still describe the same shades.
    for (const [level, rgb] of [
      [0, "230, 224, 211"],
      [1, "199, 208, 196"],
      [2, "152, 174, 159"],
      [3, "96, 134, 116"],
      [4, "39, 93, 71"],
    ] as const) {
      expect(styles).toContain(
        `--activity-level-${String(level)}: rgb(${rgb})`,
      );
    }
  });
});
