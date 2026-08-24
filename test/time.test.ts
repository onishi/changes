import { describe, expect, it } from "vitest";
import {
  currentPeriodKey,
  periodBoundsForInstant,
  periodBoundsForRoute,
  shiftPeriodKey,
} from "../worker/lib/time";

describe("period calculations in Asia/Tokyo", () => {
  it("uses Tokyo midnight for a daily record", () => {
    expect(periodBoundsForRoute("daily", "2026-08-20")).toEqual({
      type: "daily",
      key: "2026-08-20",
      start: "2026-08-19T15:00:00.000Z",
      endExclusive: "2026-08-20T15:00:00.000Z",
      endInclusive: "2026-08-20T14:59:59.000Z",
    });
  });

  it("fixes weekly periods to Sunday through Saturday", () => {
    expect(periodBoundsForRoute("weekly", "2026-08-16")).toEqual({
      type: "weekly",
      key: "2026-08-16",
      start: "2026-08-15T15:00:00.000Z",
      endExclusive: "2026-08-22T15:00:00.000Z",
      endInclusive: "2026-08-22T14:59:59.000Z",
    });
    expect(() => periodBoundsForRoute("weekly", "2026-08-17")).toThrow(
      /Sundays/u,
    );
  });

  it("groups both ends of a week under the same Sunday", () => {
    expect(
      periodBoundsForInstant("weekly", "2026-08-15T15:00:00.000Z").key,
    ).toBe("2026-08-16");
    expect(
      periodBoundsForInstant("weekly", "2026-08-22T14:59:59.000Z").key,
    ).toBe("2026-08-16");
    expect(
      periodBoundsForInstant("weekly", "2026-08-22T15:00:00.000Z").key,
    ).toBe("2026-08-23");
  });

  it("handles leap years and month/year transitions", () => {
    expect(periodBoundsForRoute("monthly", "2024-02").endExclusive).toBe(
      "2024-02-29T15:00:00.000Z",
    );
    expect(shiftPeriodKey("monthly", "2026-12", 1)).toBe("2027-01");
    expect(shiftPeriodKey("monthly", "2026-01", -1)).toBe("2025-12");
    expect(shiftPeriodKey("weekly", "2026-01-04", -1)).toBe("2025-12-28");
  });

  it("derives the current period from Tokyo time", () => {
    const beforeTokyoMidnight = new Date("2026-08-19T14:59:59.000Z");
    const atTokyoMidnight = new Date("2026-08-19T15:00:00.000Z");
    expect(currentPeriodKey("daily", beforeTokyoMidnight)).toBe("2026-08-19");
    expect(currentPeriodKey("daily", atTokyoMidnight)).toBe("2026-08-20");
  });

  it("rejects malformed and impossible route dates", () => {
    expect(() => periodBoundsForRoute("daily", "2026-02-30")).toThrow(
      /calendar/u,
    );
    expect(() => periodBoundsForRoute("monthly", "2026-13")).toThrow(
      /calendar/u,
    );
  });
});
