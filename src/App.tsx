import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildPath,
  currentPeriodKey,
  isBeforeDataCutoffPeriod,
  isFuturePeriod,
  parseRoute,
  periodKeyForDate,
} from "./routes";
import { dataCutoffPeriodKey } from "../shared/data-cutoff";
import type {
  BootstrapData,
  ChangeRecord,
  LatestDailyResponse,
  PeriodResponse,
  PeriodType,
  RouteState,
  SessionResponse,
} from "./types";

const periodLabels: Record<PeriodType, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "short",
  day: "numeric",
  weekday: "short",
});

const headingDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "short",
  day: "numeric",
});

const headingMonthFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "short",
});

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Tokyo",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal,
  });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(
      body.error ?? `Request failed (${String(response.status)})`,
    );
  }
  return body;
}

function apiPath(route: RouteState): string {
  const scope = route.scope === "all" ? "all" : "public";
  const repository = route.repository
    ? `/repositories/${encodeURIComponent(route.repository)}`
    : "";
  const path = `/api/${scope}${repository}/periods/${route.period}/${route.key}`;
  return route.cursor
    ? `${path}?cursor=${encodeURIComponent(route.cursor)}`
    : path;
}

function latestDailyApiPath(route: RouteState): string {
  return route.repository
    ? `/api/public/repositories/${encodeURIComponent(route.repository)}/latest-daily`
    : "/api/public/latest-daily";
}

function repositoryOverviewPath(repository: string): string {
  return `/repo/${encodeURIComponent(repository)}/`;
}

function formatPeriod(data: PeriodResponse): string {
  const start = new Date(data.period.start);
  const end = new Date(new Date(data.period.endExclusive).getTime() - 1000);
  if (data.period.type === "daily") return headingDateFormatter.format(start);
  if (data.period.type === "monthly") {
    return headingMonthFormatter.format(start);
  }
  return headingDateFormatter.formatRange(start, end);
}

function Summary({ record }: { record: ChangeRecord }) {
  if (record.summary.status === "ready" && record.summary.text) {
    return <p className="record-summary">{record.summary.text}</p>;
  }
  const messages = {
    pending: "AI summary pending. The commit list is available.",
    generating: "Generating AI summary…",
    failed:
      "Could not generate the AI summary. It will retry on the next sync.",
    ready: "No summary yet.",
  };
  return (
    <p className={`summary-state summary-${record.summary.status}`}>
      {messages[record.summary.status]}
    </p>
  );
}

function summaryPreview(record: ChangeRecord): string {
  if (record.summary.status === "ready" && record.summary.text) {
    return record.summary.text;
  }
  if (record.summary.status === "failed") {
    return "Could not generate the AI summary.";
  }
  return "Generating AI summary…";
}

function SyncNote({ data }: { data: PeriodResponse }) {
  return (
    <p className={`sync-note sync-${data.sync.status}`}>
      <span aria-hidden="true" />
      {data.sync.status === "running"
        ? "Syncing changes from GitHub"
        : data.sync.status === "failed"
          ? "Latest sync failed. Showing data from the last successful sync"
          : data.sync.lastSyncedAt
            ? `Last synced ${timeFormatter.format(new Date(data.sync.lastSyncedAt))}`
            : "Waiting for the first GitHub sync"}
    </p>
  );
}

function LatestDaily({
  data,
  route,
}: {
  data: LatestDailyResponse;
  route: RouteState;
}) {
  const latestKey = data.records[0]?.periodKey ?? currentPeriodKey("daily");
  const recordsByDay = Array.from(
    data.records.reduce((groups, record) => {
      const records = groups.get(record.periodKey) ?? [];
      records.push(record);
      groups.set(record.periodKey, records);
      return groups;
    }, new Map<string, ChangeRecord[]>()),
  );
  return (
    <section className="daily-feed" aria-labelledby="daily-feed-title">
      <header className="daily-feed-header">
        <h1 id="daily-feed-title">{route.repository ?? "Recent changes"}</h1>
      </header>

      <div className="daily-feed-list">
        {data.records.length === 0 ? (
          <p className="daily-feed-empty">No changes yet.</p>
        ) : (
          recordsByDay.map(([periodKey, records]) => (
            <section
              className="daily-feed-day"
              aria-labelledby={`daily-feed-day-${periodKey}`}
              key={periodKey}
            >
              <h2 id={`daily-feed-day-${periodKey}`}>
                <a
                  href={buildPath(route, {
                    period: "daily",
                    key: periodKey,
                    repository: route.repository,
                    cursor: null,
                  })}
                >
                  <time dateTime={periodKey}>
                    {dateFormatter.format(
                      new Date(`${periodKey}T00:00:00+09:00`),
                    )}
                  </time>
                </a>
              </h2>
              {records.map((record) => (
                <a
                  className="daily-feed-item"
                  href={buildPath(route, {
                    period: "daily",
                    key: record.periodKey,
                    repository: record.repository.name,
                    cursor: null,
                  })}
                  key={record.id}
                >
                  <h3>{record.repository.name}</h3>
                  <p>{summaryPreview(record)}</p>
                  <div className="daily-feed-meta">
                    <span>{record.commitCount} commits</span>
                  </div>
                  <span className="daily-feed-arrow" aria-hidden="true">
                    →
                  </span>
                </a>
              ))}
            </section>
          ))
        )}
      </div>

      <a
        className="daily-feed-more"
        href={buildPath(route, {
          period: "daily",
          key: latestKey,
          repository: route.repository,
          cursor: null,
        })}
      >
        View Daily changelog
        <span aria-hidden="true"> →</span>
      </a>
    </section>
  );
}

function ChangeCard({
  record,
  route,
}: {
  record: ChangeRecord;
  route: RouteState;
}) {
  return (
    <article className="change-card">
      <header className="card-header">
        <div>
          <div className="eyebrow-row">
            <span
              className={`visibility visibility-${record.repository.visibility}`}
            >
              {record.repository.visibility}
            </span>
            <span>{record.commitCount} commits</span>
          </div>
          <h2>
            <a
              href={
                route.scope === "public"
                  ? repositoryOverviewPath(record.repository.name)
                  : buildPath(route, {
                      repository: record.repository.name,
                      cursor: null,
                    })
              }
            >
              {record.repository.name}
            </a>
          </h2>
        </div>
        <a
          className="github-link"
          href={record.commitLogUrl}
          target="_blank"
          rel="noreferrer noopener"
        >
          View period on GitHub <span aria-hidden="true">↗</span>
        </a>
      </header>

      <Summary record={record} />

      <details className="commit-details">
        <summary>
          <span>Commit list</span>
          <span className="commit-range">
            {timeFormatter.format(new Date(record.firstCommittedAt))} —{" "}
            {timeFormatter.format(new Date(record.lastCommittedAt))}
          </span>
        </summary>
        <ol className="commit-list">
          {record.commits.map((commit) => (
            <li key={commit.oid}>
              <a
                href={commit.html_url}
                target="_blank"
                rel="noreferrer noopener"
              >
                <code>{commit.oid.slice(0, 7)}</code>
                <span>{commit.message_headline}</span>
              </a>
              <time dateTime={commit.committed_at}>
                {timeFormatter.format(new Date(commit.committed_at))}
              </time>
            </li>
          ))}
        </ol>
      </details>
    </article>
  );
}

function Header({
  route,
  session,
  syncing,
  onSync,
}: {
  route: RouteState;
  session: SessionResponse | null;
  syncing: boolean;
  onSync: () => void;
}) {
  const onDateChange = (value: string) => {
    window.location.href = buildPath(route, {
      key: periodKeyForDate(route.period, value),
      cursor: null,
    });
  };
  const allPath = buildPath(route, { scope: "all", cursor: null });
  const publicPath = route.isOverview
    ? route.repository
      ? repositoryOverviewPath(route.repository)
      : "/"
    : buildPath(route, { scope: "public", cursor: null });

  return (
    <>
      <header className="site-header">
        <a className="brand" href="/">
          changes<span>.</span>
        </a>
        <nav className="scope-nav" aria-label="Visibility">
          <a
            aria-current={route.scope === "public" ? "page" : undefined}
            href={publicPath}
          >
            Public
          </a>
          <a
            aria-current={route.scope === "all" ? "page" : undefined}
            href={allPath}
          >
            All{" "}
            <span className="lock" aria-label="Authentication required">
              ⌁
            </span>
          </a>
        </nav>
        <div className="account">
          {route.scope === "all" && session?.authenticated && (
            <>
              <span>@{session.user?.login}</span>
              <button
                className="text-button"
                type="button"
                disabled={syncing}
                onClick={onSync}
              >
                {syncing ? "Requesting sync…" : "Sync now"}
              </button>
              <form action="/api/auth/logout" method="post">
                <button className="text-button" type="submit">
                  Sign out
                </button>
              </form>
            </>
          )}
        </div>
      </header>

      <section
        className={`controls${route.isOverview ? " controls-overview" : ""}`}
        aria-label="View options"
      >
        <nav className="period-nav" aria-label="Period">
          {(Object.keys(periodLabels) as PeriodType[]).map((period) => (
            <a
              key={period}
              href={buildPath(route, { period, cursor: null })}
              aria-current={
                !route.isOverview && route.period === period
                  ? "page"
                  : undefined
              }
            >
              {periodLabels[period]}
            </a>
          ))}
        </nav>
        {!route.isOverview && (
          <>
            <label className="field">
              <span>
                {route.period === "monthly"
                  ? "Month"
                  : route.period === "weekly"
                    ? "Week starting Sunday"
                    : "Date"}
              </span>
              <input
                type={route.period === "monthly" ? "month" : "date"}
                min={dataCutoffPeriodKey(route.period)}
                value={route.key}
                onChange={(event) => onDateChange(event.currentTarget.value)}
              />
            </label>
          </>
        )}
      </section>
    </>
  );
}

function PeriodPager({
  route,
  data,
}: {
  route: RouteState;
  data: PeriodResponse;
}) {
  const previousDisabled = isBeforeDataCutoffPeriod(
    route.period,
    data.period.previousKey,
  );
  const nextDisabled = isFuturePeriod(route.period, data.period.key);
  return (
    <nav className="period-pager" aria-label="Previous and next periods">
      {previousDisabled ? (
        <span aria-disabled="true">
          <span aria-hidden="true">←</span> Previous{" "}
          {periodLabels[route.period]}
        </span>
      ) : (
        <a
          href={buildPath(route, {
            key: data.period.previousKey,
            cursor: null,
          })}
        >
          <span aria-hidden="true">←</span> Previous{" "}
          {periodLabels[route.period]}
        </a>
      )}
      {nextDisabled ? (
        <span aria-disabled="true">
          Next {periodLabels[route.period]} <span aria-hidden="true">→</span>
        </span>
      ) : (
        <a href={buildPath(route, { key: data.period.nextKey, cursor: null })}>
          Next {periodLabels[route.period]} <span aria-hidden="true">→</span>
        </a>
      )}
    </nav>
  );
}

function Loading() {
  return (
    <div className="loading" role="status">
      <span />
      <span />
      <span />
      <p>Loading changes</p>
    </div>
  );
}

export function App() {
  const route = useMemo(
    () =>
      parseRoute(window.location, (path) =>
        window.history.replaceState(null, "", path),
      ),
    [],
  );
  const bootstrap = useMemo<BootstrapData | null>(() => {
    const initial = window.__CHANGES_BOOTSTRAP__;
    const path = `${window.location.pathname}${window.location.search}`;
    return initial?.path === path ? initial : null;
  }, []);
  const hasCompleteBootstrap = route.isOverview
    ? Boolean(bootstrap?.latestDailyData || bootstrap?.error)
    : Boolean(bootstrap?.periodData || bootstrap?.error);
  const [data, setData] = useState<PeriodResponse | null>(
    bootstrap?.periodData ?? null,
  );
  const [latestDailyData, setLatestDailyData] =
    useState<LatestDailyResponse | null>(bootstrap?.latestDailyData ?? null);
  const [session, setSession] = useState<SessionResponse | null>(
    bootstrap?.session ?? null,
  );
  const [error, setError] = useState<string | null>(bootstrap?.error ?? null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setError(null);
      try {
        if (route.isOverview) {
          setLatestDailyData(
            await fetchJson<LatestDailyResponse>(
              latestDailyApiPath(route),
              signal,
            ),
          );
          return;
        }

        const [periodData, sessionData] = await Promise.all([
          fetchJson<PeriodResponse>(apiPath(route), signal),
          route.scope === "all"
            ? fetchJson<SessionResponse>("/api/auth/session", signal)
            : Promise.resolve(null),
        ]);
        setData(periodData);
        if (sessionData) setSession(sessionData);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError")
          return;
        setError(
          caught instanceof Error ? caught.message : "Could not load changes.",
        );
      }
    },
    [route],
  );

  useEffect(() => {
    if (hasCompleteBootstrap) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [hasCompleteBootstrap, load]);

  useEffect(() => {
    if (
      route.repository &&
      data?.repository &&
      route.repository.toLowerCase() !==
        data.repository.canonicalName.toLowerCase()
    ) {
      window.history.replaceState(
        null,
        "",
        buildPath(route, {
          repository: data.repository.canonicalName,
          cursor: route.cursor,
        }),
      );
    }
  }, [data, route]);

  const requestSync = () => {
    setSyncing(true);
    void fetch("/api/all/sync", { method: "POST" })
      .then((response) => {
        if (!response.ok) throw new Error("Could not request a sync.");
      })
      .catch((caught: unknown) => {
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not request a sync.",
        );
      })
      .finally(() => setSyncing(false));
  };

  return (
    <div className="app-shell">
      <Header
        route={route}
        session={session}
        syncing={syncing}
        onSync={requestSync}
      />

      <main>
        {error ? (
          <section className="error-state" role="alert">
            <p className="section-label">Could not load</p>
            <h1>Could not load changes</h1>
            <p>{error}</p>
            <button type="button" onClick={() => void load()}>
              Try again
            </button>
          </section>
        ) : route.isOverview ? (
          latestDailyData ? (
            <LatestDaily data={latestDailyData} route={route} />
          ) : (
            <Loading />
          )
        ) : !data ? (
          <Loading />
        ) : (
          <>
            <section className="hero">
              <div>
                <p className="section-label">
                  {route.scope === "all"
                    ? "Public + private"
                    : "Public changelog"}
                  {route.repository ? ` · ${route.repository}` : ""}
                </p>
                <h1>{formatPeriod(data)}</h1>
              </div>
              <dl className="stats">
                <div>
                  <dt>Commits</dt>
                  <dd>{data.stats.commit_count}</dd>
                </div>
                <div>
                  <dt>Repositories</dt>
                  <dd>{data.stats.repository_count}</dd>
                </div>
              </dl>
            </section>

            <SyncNote data={data} />

            <PeriodPager route={route} data={data} />

            <section className="records" aria-label="Change records">
              {data.records.length === 0 ? (
                <div className="empty-state">
                  <span aria-hidden="true">○</span>
                  <h2>No changes in this period</h2>
                  <p>Try the previous or next period.</p>
                </div>
              ) : (
                data.records.map((record) => (
                  <ChangeCard key={record.id} record={record} route={route} />
                ))
              )}
            </section>

            {(route.cursor || data.nextCursor) && (
              <nav className="record-pager" aria-label="Change record pages">
                {route.cursor && (
                  <a href={buildPath(route, { cursor: null })}>First 50</a>
                )}
                {data.nextCursor && (
                  <a href={buildPath(route, { cursor: data.nextCursor })}>
                    View next 50 →
                  </a>
                )}
              </nav>
            )}

            <PeriodPager route={route} data={data} />
          </>
        )}
      </main>

      <footer>
        <span>changes.wagaya.org</span>
        <span>Times shown in Asia/Tokyo</span>
      </footer>
    </div>
  );
}
