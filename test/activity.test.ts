import { describe, expect, it } from "vitest";
import {
  ACTIVITY_WEEKS,
  activityLevel,
  activityMonthStarts,
  activityRange,
  buildActivityGrid,
  weekStartKey,
} from "../shared/activity";

describe("activity range", () => {
  it("ends on today and starts on a Sunday a year back", () => {
    const range = activityRange("2028-09-18");
    expect(range.endKey).toBe("2028-09-18");
    expect(range.startKey).toBe("2027-09-19");
    expect(weekStartKey(range.startKey)).toBe(range.startKey);
  });

  it("never reaches back past the first week we hold data for", () => {
    const range = activityRange("2026-09-18");
    expect(range.startKey).toBe("2026-04-26");
    expect(activityRange("2026-05-06").startKey).toBe("2026-04-26");
  });

  it("keeps at most one column per week of the window", () => {
    const { weeks } = buildActivityGrid(activityRange("2028-09-18"), new Map());
    expect(weeks).toHaveLength(ACTIVITY_WEEKS);
  });
});

describe("activity grid", () => {
  it("lays days out in Sunday-first columns and pads both edges", () => {
    const { weeks, dayCount, totalCommits, maxCommitCount } = buildActivityGrid(
      { startKey: "2026-04-26", endKey: "2026-05-05" },
      new Map([
        ["2026-05-01", 4],
        ["2026-05-04", 1],
      ]),
    );

    expect(weeks).toHaveLength(2);
    // The window opens on the Sunday before the data cutoff, so the days
    // ahead of it have no square at all.
    expect(weeks[0]?.days.map((day) => day.date)).toEqual([
      null,
      null,
      null,
      null,
      null,
      "2026-05-01",
      "2026-05-02",
    ]);
    // The last column stops at today rather than running to Saturday.
    expect(weeks[1]?.days.map((day) => day.date)).toEqual([
      "2026-05-03",
      "2026-05-04",
      "2026-05-05",
      null,
      null,
      null,
      null,
    ]);
    expect(dayCount).toBe(5);
    expect(totalCommits).toBe(5);
    expect(maxCommitCount).toBe(4);
    expect(weeks[0]?.days[5]?.level).toBe(4);
    expect(weeks[1]?.days[1]?.level).toBe(1);
    expect(weeks[1]?.days[2]?.level).toBe(0);
  });

  it("labels a column only where its first day opens a new month", () => {
    const { weeks } = buildActivityGrid(
      { startKey: "2026-05-24", endKey: "2026-06-13" },
      new Map(),
    );
    // The middle column starts on May 31, so June is labelled one column
    // later, where the week itself starts in June.
    expect(activityMonthStarts(weeks)).toEqual([
      "2026-05-24",
      null,
      "2026-06-07",
    ]);
  });
});

describe("activity levels", () => {
  it("keeps a quiet range in its lightest shades", () => {
    expect(activityLevel(0, 1)).toBe(0);
    expect(activityLevel(1, 1)).toBe(1);
    expect(activityLevel(2, 2)).toBe(2);
  });

  it("spreads a busy range across every shade", () => {
    expect(activityLevel(1, 20)).toBe(1);
    expect(activityLevel(5, 20)).toBe(1);
    expect(activityLevel(6, 20)).toBe(2);
    expect(activityLevel(11, 20)).toBe(3);
    expect(activityLevel(20, 20)).toBe(4);
    // A day busier than the one the scale was built on still stops at 4.
    expect(activityLevel(40, 20)).toBe(4);
  });
});
