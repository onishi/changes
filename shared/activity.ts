import {
  dataCutoffPeriodKey,
  isPeriodKeyBeforeDataCutoff,
} from "./data-cutoff";

// One column per week, Sunday first, like the GitHub contribution graph.
export const ACTIVITY_WEEKS = 53;
export const DAYS_PER_WEEK = 7;
export const ACTIVITY_LEVELS = 4;

export interface ActivityRange {
  startKey: string;
  endKey: string;
}

export interface ActivityCell {
  // null for the cells that pad the first and last columns: days before the
  // data cutoff or after today, which have no square in the graph.
  date: string | null;
  commitCount: number;
  level: number;
}

export interface ActivityWeek {
  startDate: string;
  days: ActivityCell[];
}

export interface ActivityGrid {
  weeks: ActivityWeek[];
  dayCount: number;
  totalCommits: number;
  maxCommitCount: number;
}

function parseDayKey(key: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) {
    throw new Error("Invalid date. Expected YYYY-MM-DD.");
  }
  return new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
}

function formatDayKey(date: Date): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${String(date.getUTCFullYear())}-${month}-${day}`;
}

// Day keys are Tokyo-local calendar dates, so shifting them as UTC dates
// keeps the arithmetic free of any offset handling.
export function shiftDayKey(key: string, days: number): string {
  const date = parseDayKey(key);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDayKey(date);
}

export function weekStartKey(key: string): string {
  const date = parseDayKey(key);
  return shiftDayKey(key, -date.getUTCDay());
}

// The graph ends with the week holding today and reaches back a year, or to
// the first week we hold data for while that is less than a year ago.
export function activityRange(
  todayKey: string,
  weeks = ACTIVITY_WEEKS,
): ActivityRange {
  const earliest = dataCutoffPeriodKey("weekly");
  const candidate = shiftDayKey(
    weekStartKey(todayKey),
    -(Math.max(weeks, 1) - 1) * DAYS_PER_WEEK,
  );
  return {
    startKey: candidate < earliest ? earliest : candidate,
    endKey: todayKey,
  };
}

export function activityLevel(
  commitCount: number,
  maxCommitCount: number,
): number {
  if (commitCount <= 0) return 0;
  // Scale against the busiest day, but never below the number of levels, so a
  // quiet range keeps its lightest shade instead of painting one commit black.
  const scale = Math.max(maxCommitCount, ACTIVITY_LEVELS);
  return Math.min(
    ACTIVITY_LEVELS,
    Math.ceil((commitCount / scale) * ACTIVITY_LEVELS),
  );
}

function isInRange(dayKey: string, range: ActivityRange): boolean {
  if (isPeriodKeyBeforeDataCutoff("daily", dayKey)) return false;
  return dayKey >= range.startKey && dayKey <= range.endKey;
}

export function buildActivityGrid(
  range: ActivityRange,
  commitCountsByDay: Map<string, number>,
): ActivityGrid {
  const weeks: ActivityWeek[] = [];
  let dayCount = 0;
  let totalCommits = 0;
  let maxCommitCount = 0;

  for (
    let weekStart = weekStartKey(range.startKey);
    weekStart <= range.endKey;
    weekStart = shiftDayKey(weekStart, DAYS_PER_WEEK)
  ) {
    const days: ActivityCell[] = [];
    for (let weekday = 0; weekday < DAYS_PER_WEEK; weekday += 1) {
      const dayKey = shiftDayKey(weekStart, weekday);
      if (!isInRange(dayKey, range)) {
        days.push({ date: null, commitCount: 0, level: 0 });
        continue;
      }
      const commitCount = commitCountsByDay.get(dayKey) ?? 0;
      dayCount += 1;
      totalCommits += commitCount;
      maxCommitCount = Math.max(maxCommitCount, commitCount);
      days.push({ date: dayKey, commitCount, level: 0 });
    }
    weeks.push({ startDate: weekStart, days });
  }

  for (const week of weeks) {
    for (const day of week.days) {
      day.level = activityLevel(day.commitCount, maxCommitCount);
    }
  }

  return { weeks, dayCount, totalCommits, maxCommitCount };
}

// The first in-range day of every week that opens a month, so the graph can
// label its columns the way a calendar would.
export function activityMonthStarts(weeks: ActivityWeek[]): (string | null)[] {
  let previousMonth: string | null = null;
  return weeks.map((week) => {
    const firstDay = week.days.find((day) => day.date)?.date;
    if (!firstDay) return null;
    const month = firstDay.slice(0, 7);
    if (month === previousMonth) return null;
    previousMonth = month;
    return firstDay;
  });
}
