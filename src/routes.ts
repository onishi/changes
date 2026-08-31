import type { PeriodType, RouteState, Scope } from "./types";
import {
  clampPeriodKeyToDataCutoff,
  isPeriodKeyBeforeDataCutoff,
} from "../shared/data-cutoff";

const periods = new Set<PeriodType>(["daily", "weekly", "monthly"]);

function datePartsInTokyo(now: Date): {
  year: number;
  month: number;
  day: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function dateKey(year: number, month: number, day: number): string {
  return `${String(year)}-${pad(month)}-${pad(day)}`;
}

export function periodKeyForDate(type: PeriodType, value: string): string {
  const normalized = /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : value;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) return currentPeriodKey(type);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (type === "monthly") return `${String(year)}-${pad(month)}`;
  if (type === "daily") return dateKey(year, month, day);

  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return dateKey(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
  );
}

export function currentPeriodKey(type: PeriodType, now = new Date()): string {
  const { year, month, day } = datePartsInTokyo(now);
  return periodKeyForDate(type, dateKey(year, month, day));
}

function baseDate(route: RouteState): string {
  return route.period === "monthly" ? `${route.key}-01` : route.key;
}

export function buildPath(
  route: RouteState,
  overrides: Partial<
    Pick<RouteState, "scope" | "period" | "key" | "repository" | "cursor">
  > = {},
): string {
  const scope = overrides.scope ?? route.scope;
  const period = overrides.period ?? route.period;
  const repository =
    overrides.repository === undefined
      ? route.repository
      : overrides.repository;
  const candidate =
    overrides.key ??
    (period === route.period
      ? route.key
      : periodKeyForDate(period, baseDate(route)));
  const key = clampPeriodKeyToDataCutoff(period, candidate);
  const prefix = scope === "all" ? "/all" : "";
  const repositoryPart = repository
    ? `/repo/${encodeURIComponent(repository)}`
    : "";
  const path = `${prefix}${repositoryPart}/${period}/${key}`;
  const cursor = overrides.cursor === undefined ? null : overrides.cursor;
  return cursor ? `${path}?cursor=${encodeURIComponent(cursor)}` : path;
}

export function isOverviewPath(pathname: string): boolean {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "public" || parts[0] === "all") parts.shift();
  return (
    parts.length === 0 ||
    (parts.length === 2 && parts[0] === "repo" && Boolean(parts[1]))
  );
}

function decodeRepository(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function parseRoute(
  location: { pathname: string; search: string },
  onCanonicalPath?: (path: string) => void,
): RouteState {
  const parts = location.pathname.split("/").filter(Boolean);
  const isOverview = isOverviewPath(location.pathname);
  let index = 0;
  const scope: Scope = parts[0] === "all" ? "all" : "public";
  if (scope === "all") index += 1;
  if (parts[index] === "public") index += 1;

  let repository: string | null = null;
  if (parts[index] === "repo" && parts[index + 1]) {
    repository = decodeRepository(parts[index + 1] ?? "");
    index += 2;
  }

  const candidatePeriod = parts[index] as PeriodType | undefined;
  const period =
    candidatePeriod && periods.has(candidatePeriod) ? candidatePeriod : "daily";
  const candidateKey = parts[index + 1];
  const validKey =
    period === "monthly"
      ? /^\d{4}-\d{2}$/.test(candidateKey ?? "")
      : /^\d{4}-\d{2}-\d{2}$/.test(candidateKey ?? "");
  const key = validKey
    ? (candidateKey ?? currentPeriodKey(period))
    : currentPeriodKey(period);
  const normalizedKey = clampPeriodKeyToDataCutoff(
    period,
    periodKeyForDate(period, key),
  );
  const route = {
    scope,
    isOverview,
    period,
    key: normalizedKey,
    repository,
    cursor: new URLSearchParams(location.search).get("cursor"),
  } satisfies RouteState;

  if (
    !isOverview &&
    (!candidatePeriod ||
      !candidateKey ||
      !validKey ||
      normalizedKey !== candidateKey)
  ) {
    onCanonicalPath?.(buildPath(route));
  }
  return route;
}

export function isFuturePeriod(type: PeriodType, key: string): boolean {
  return key >= currentPeriodKey(type);
}

export function isBeforeDataCutoffPeriod(
  type: PeriodType,
  key: string,
): boolean {
  return isPeriodKeyBeforeDataCutoff(type, key);
}

export function keyboardShortcutPath(
  route: RouteState,
  key: string,
  periodNavigation?: { previousKey: string; nextKey: string },
  now = new Date(),
): string | null {
  if (key.toLowerCase() === "t") {
    const latestKey = currentPeriodKey(route.period, now);
    if (!route.isOverview && route.key === latestKey) return null;
    return buildPath(route, { key: latestKey, cursor: null });
  }
  const periodByKey: Partial<Record<string, PeriodType>> = {
    d: "daily",
    w: "weekly",
    m: "monthly",
  };
  const period = periodByKey[key.toLowerCase()];
  if (period) {
    if (!route.isOverview && route.period === period) return null;
    return buildPath(route, { period, cursor: null });
  }
  if (route.isOverview || !periodNavigation) return null;
  if (key.toLowerCase() === "p") {
    return isBeforeDataCutoffPeriod(route.period, periodNavigation.previousKey)
      ? null
      : buildPath(route, { key: periodNavigation.previousKey, cursor: null });
  }
  if (key.toLowerCase() === "n") {
    return isFuturePeriod(route.period, route.key)
      ? null
      : buildPath(route, { key: periodNavigation.nextKey, cursor: null });
  }
  return null;
}
