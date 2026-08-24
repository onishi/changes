import type { PeriodBounds, PeriodType } from "../domain";

const TOKYO_OFFSET_MS = 9 * 60 * 60 * 1000;
const SECOND_MS = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function toDateKey(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function parseDateKey(value: string): {
  year: number;
  month: number;
  day: number;
} {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error("Invalid date. Expected YYYY-MM-DD.");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error("Invalid calendar date.");
  }

  return { year, month, day };
}

function parseMonthKey(value: string): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error("Invalid month. Expected YYYY-MM.");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) {
    throw new Error("Invalid calendar month.");
  }

  return { year, month };
}

function tokyoMidnightUtc(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day) - TOKYO_OFFSET_MS;
}

function boundsFromLocalStart(
  type: PeriodType,
  key: string,
  year: number,
  month: number,
  day: number,
): PeriodBounds {
  const startMs = tokyoMidnightUtc(year, month, day);
  let endMs: number;

  if (type === "daily") {
    endMs = startMs + DAY_MS;
  } else if (type === "weekly") {
    endMs = startMs + 7 * DAY_MS;
  } else {
    endMs = tokyoMidnightUtc(year, month + 1, 1);
  }

  return {
    type,
    key,
    start: new Date(startMs).toISOString(),
    endExclusive: new Date(endMs).toISOString(),
    endInclusive: new Date(endMs - SECOND_MS).toISOString(),
  };
}

export function periodBoundsForRoute(
  type: PeriodType,
  key: string,
): PeriodBounds {
  if (type === "monthly") {
    const { year, month } = parseMonthKey(key);
    return boundsFromLocalStart(type, key, year, month, 1);
  }

  const { year, month, day } = parseDateKey(key);
  if (type === "weekly") {
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    if (weekday !== 0) {
      throw new Error("Weekly period keys must be Sundays.");
    }
  }

  return boundsFromLocalStart(type, key, year, month, day);
}

export function periodBoundsForInstant(
  type: PeriodType,
  isoTimestamp: string,
): PeriodBounds {
  const instant = new Date(isoTimestamp);
  if (Number.isNaN(instant.getTime())) {
    throw new Error("Invalid commit timestamp.");
  }

  const tokyo = new Date(instant.getTime() + TOKYO_OFFSET_MS);
  let year = tokyo.getUTCFullYear();
  let month = tokyo.getUTCMonth() + 1;
  let day = tokyo.getUTCDate();

  if (type === "monthly") {
    return boundsFromLocalStart(type, `${year}-${pad(month)}`, year, month, 1);
  }

  if (type === "weekly") {
    const sunday = new Date(
      Date.UTC(year, month - 1, day) - tokyo.getUTCDay() * DAY_MS,
    );
    year = sunday.getUTCFullYear();
    month = sunday.getUTCMonth() + 1;
    day = sunday.getUTCDate();
  }

  const key = toDateKey(year, month, day);
  return boundsFromLocalStart(type, key, year, month, day);
}

export function currentPeriodKey(type: PeriodType, now = new Date()): string {
  return periodBoundsForInstant(type, now.toISOString()).key;
}

export function shiftPeriodKey(
  type: PeriodType,
  key: string,
  amount: -1 | 1,
): string {
  const bounds = periodBoundsForRoute(type, key);
  const startTokyo = new Date(
    new Date(bounds.start).getTime() + TOKYO_OFFSET_MS,
  );

  if (type === "monthly") {
    const shifted = new Date(
      Date.UTC(
        startTokyo.getUTCFullYear(),
        startTokyo.getUTCMonth() + amount,
        1,
      ),
    );
    return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}`;
  }

  const days = type === "daily" ? amount : amount * 7;
  const shifted = new Date(startTokyo.getTime() + days * DAY_MS);
  return toDateKey(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}
