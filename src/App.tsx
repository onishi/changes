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
  Repository,
  RouteState,
  SessionResponse,
} from "./types";

const periodLabels: Record<PeriodType, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short",
});

const timeFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
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

function formatPeriod(data: PeriodResponse): string {
  const start = new Date(data.period.start);
  const end = new Date(new Date(data.period.endExclusive).getTime() - 1000);
  if (data.period.type === "daily") return dateFormatter.format(start);
  if (data.period.type === "monthly") {
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "long",
    }).format(start);
  }
  return `${dateFormatter.format(start)} — ${dateFormatter.format(end)}`;
}

function Summary({ record }: { record: ChangeRecord }) {
  if (record.summary.status === "ready" && record.summary.text) {
    return <p className="record-summary">{record.summary.text}</p>;
  }
  const messages = {
    pending: "AI サマリを生成待ちです。コミット一覧は閲覧できます。",
    generating: "AI サマリを生成しています…",
    failed: "AI サマリを生成できませんでした。次回の同期で再試行します。",
    ready: "サマリはまだありません。",
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
    return "AI サマリを生成できませんでした。";
  }
  return "AI サマリを生成中です。";
}

function SyncNote({ data }: { data: PeriodResponse }) {
  return (
    <p className={`sync-note sync-${data.sync.status}`}>
      <span aria-hidden="true" />
      {data.sync.status === "running"
        ? "GitHub の変更を同期しています"
        : data.sync.status === "failed"
          ? "直近の同期に失敗しました。前回成功時のデータを表示しています"
          : data.sync.lastSyncedAt
            ? `最終同期 ${timeFormatter.format(new Date(data.sync.lastSyncedAt))}`
            : "初回の GitHub 同期待ちです"}
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
  return (
    <section className="daily-feed" aria-labelledby="daily-feed-title">
      <header className="daily-feed-header">
        <div>
          <p className="section-label">Daily</p>
          <h1 id="daily-feed-title">最新の変更</h1>
        </div>
        <p>リポジトリごとの日次ログから、新しい5件を表示</p>
      </header>

      <div className="daily-feed-list">
        {data.records.length === 0 ? (
          <p className="daily-feed-empty">変更履歴はまだありません。</p>
        ) : (
          data.records.map((record) => (
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
              <div className="daily-feed-meta">
                <time dateTime={record.periodKey}>
                  {dateFormatter.format(
                    new Date(`${record.periodKey}T00:00:00+09:00`),
                  )}
                </time>
                <span>{record.commitCount} commits</span>
              </div>
              <h2>{record.repository.name}</h2>
              <p>{summaryPreview(record)}</p>
              <span className="daily-feed-arrow" aria-hidden="true">
                →
              </span>
            </a>
          ))
        )}
      </div>

      <a
        className="daily-feed-more"
        href={buildPath(route, {
          period: "daily",
          key: latestKey,
          repository: null,
          cursor: null,
        })}
      >
        Daily の一覧を見る
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
              href={buildPath(route, {
                repository: record.repository.name,
                cursor: null,
              })}
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
          GitHub で期間ログを見る <span aria-hidden="true">↗</span>
        </a>
      </header>

      <Summary record={record} />

      <details className="commit-details">
        <summary>
          <span>コミット一覧</span>
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
  repositories,
  session,
  syncing,
  onSync,
}: {
  route: RouteState;
  repositories: Repository[];
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
  const onRepositoryChange = (value: string) => {
    window.location.href = buildPath(route, {
      repository: value || null,
      cursor: null,
    });
  };
  const allPath = buildPath(route, { scope: "all", cursor: null });
  const publicPath = route.isOverview
    ? "/"
    : buildPath(route, { scope: "public", cursor: null });

  return (
    <>
      <header className="site-header">
        <a className="brand" href="/">
          changes<span>.</span>
        </a>
        <nav className="scope-nav" aria-label="公開範囲">
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
            <span className="lock" aria-label="認証が必要">
              ⌁
            </span>
          </a>
        </nav>
        <div className="account">
          {route.scope === "all" && session?.authenticated ? (
            <>
              <span>@{session.user?.login}</span>
              <button
                className="text-button"
                type="button"
                disabled={syncing}
                onClick={onSync}
              >
                {syncing ? "同期を依頼中…" : "今すぐ同期"}
              </button>
              <form action="/api/auth/logout" method="post">
                <button className="text-button" type="submit">
                  サインアウト
                </button>
              </form>
            </>
          ) : (
            <a href={`/api/auth/login?returnTo=${encodeURIComponent(allPath)}`}>
              All にサインイン
            </a>
          )}
        </div>
      </header>

      {!route.isOverview && (
        <section className="controls" aria-label="表示条件">
          <nav className="period-nav" aria-label="期間単位">
            {(Object.keys(periodLabels) as PeriodType[]).map((period) => (
              <a
                key={period}
                href={buildPath(route, { period, cursor: null })}
                aria-current={route.period === period ? "page" : undefined}
              >
                {periodLabels[period]}
              </a>
            ))}
          </nav>
          <label className="field">
            <span>
              {route.period === "monthly"
                ? "月"
                : route.period === "weekly"
                  ? "週の日曜日"
                  : "日付"}
            </span>
            <input
              type={route.period === "monthly" ? "month" : "date"}
              min={dataCutoffPeriodKey(route.period)}
              value={route.key}
              onChange={(event) => onDateChange(event.currentTarget.value)}
            />
          </label>
          <label className="field repository-field">
            <span>リポジトリ</span>
            <select
              value={route.repository ?? ""}
              onChange={(event) =>
                onRepositoryChange(event.currentTarget.value)
              }
            >
              <option value="">すべてのリポジトリ</option>
              {repositories.map((repository) => (
                <option key={repository.id} value={repository.name}>
                  {repository.name}
                  {repository.visibility !== "public" ? " · private" : ""}
                </option>
              ))}
            </select>
          </label>
        </section>
      )}
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
    <nav className="period-pager" aria-label="前後の期間">
      {previousDisabled ? (
        <span aria-disabled="true">
          <span aria-hidden="true">←</span> 前の{periodLabels[route.period]}
        </span>
      ) : (
        <a
          href={buildPath(route, {
            key: data.period.previousKey,
            cursor: null,
          })}
        >
          <span aria-hidden="true">←</span> 前の{periodLabels[route.period]}
        </a>
      )}
      {nextDisabled ? (
        <span aria-disabled="true">
          次の{periodLabels[route.period]} <span aria-hidden="true">→</span>
        </span>
      ) : (
        <a href={buildPath(route, { key: data.period.nextKey, cursor: null })}>
          次の{periodLabels[route.period]} <span aria-hidden="true">→</span>
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
      <p>変更履歴を読み込んでいます</p>
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
  const [repositories, setRepositories] = useState<Repository[]>(
    bootstrap?.repositories ?? [],
  );
  const [session, setSession] = useState<SessionResponse | null>(
    bootstrap?.session ?? null,
  );
  const [error, setError] = useState<string | null>(bootstrap?.error ?? null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setError(null);
      const scope = route.scope === "all" ? "all" : "public";
      try {
        if (route.isOverview) {
          setLatestDailyData(
            await fetchJson<LatestDailyResponse>(
              "/api/public/latest-daily",
              signal,
            ),
          );
          return;
        }

        const requests: [
          Promise<PeriodResponse>,
          Promise<{ repositories: Repository[] }>,
        ] = [
          fetchJson<PeriodResponse>(apiPath(route), signal),
          fetchJson<{ repositories: Repository[] }>(
            `/api/${scope}/repositories`,
            signal,
          ),
        ];
        const [periodData, repositoryData] = await Promise.all(requests);
        setData(periodData);
        setRepositories(repositoryData.repositories);
        if (route.scope === "all") {
          setSession(
            await fetchJson<SessionResponse>("/api/auth/session", signal),
          );
        }
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError")
          return;
        setError(
          caught instanceof Error ? caught.message : "読み込みに失敗しました。",
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
        if (!response.ok) throw new Error("同期を依頼できませんでした。");
      })
      .catch((caught: unknown) => {
        setError(
          caught instanceof Error
            ? caught.message
            : "同期を依頼できませんでした。",
        );
      })
      .finally(() => setSyncing(false));
  };

  return (
    <div className="app-shell">
      <Header
        route={route}
        repositories={repositories}
        session={session}
        syncing={syncing}
        onSync={requestSync}
      />

      <main>
        {error ? (
          <section className="error-state" role="alert">
            <p className="section-label">Could not load</p>
            <h1>変更履歴を読み込めませんでした</h1>
            <p>{error}</p>
            <button type="button" onClick={() => void load()}>
              もう一度試す
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

            <section className="records" aria-label="変更レコード">
              {data.records.length === 0 ? (
                <div className="empty-state">
                  <span aria-hidden="true">○</span>
                  <h2>この期間の変更はありません</h2>
                  <p>
                    前後の期間を見るか、リポジトリの選択を解除してみてください。
                  </p>
                </div>
              ) : (
                data.records.map((record) => (
                  <ChangeCard key={record.id} record={record} route={route} />
                ))
              )}
            </section>

            {(route.cursor || data.nextCursor) && (
              <nav className="record-pager" aria-label="変更レコードのページ">
                {route.cursor && (
                  <a href={buildPath(route, { cursor: null })}>最初の50件へ</a>
                )}
                {data.nextCursor && (
                  <a href={buildPath(route, { cursor: data.nextCursor })}>
                    次の50件を見る →
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
