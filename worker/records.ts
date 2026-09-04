import { periodTypes } from "./domain";
import {
  DATA_CUTOFF_MS,
  clampInstantToDataCutoff,
} from "../shared/data-cutoff";
import type {
  ChangeRecordRow,
  CommitRow,
  PeriodBounds,
  PeriodType,
  RepositoryRow,
  Scope,
} from "./domain";
import { sha256 } from "./lib/crypto";
import { periodBoundsForInstant } from "./lib/time";

function recordId(
  scope: Scope,
  bounds: PeriodBounds,
  repositoryId: string,
): string {
  return `${scope}:${bounds.type}:${bounds.key}:${repositoryId}`;
}

export function isSummaryGenerationDue(
  bounds: PeriodBounds,
  lastGeneratedOrAttemptedAt: string | null,
  now: string,
): boolean {
  if (bounds.type === "daily") return true;
  if (Date.parse(bounds.endExclusive) <= Date.parse(now)) return true;
  if (!lastGeneratedOrAttemptedAt) return true;

  const cadence = bounds.type === "weekly" ? "daily" : "weekly";
  return (
    periodBoundsForInstant(cadence, lastGeneratedOrAttemptedAt).key !==
    periodBoundsForInstant(cadence, now).key
  );
}

async function commitsForPeriod(
  db: D1Database,
  repositoryId: string,
  bounds: PeriodBounds,
): Promise<CommitRow[]> {
  const result = await db
    .prepare(
      `SELECT repository_id, oid, message_headline, message_body, committed_at,
              author_github_user_id, author_login, html_url, is_merge
       FROM commits
       WHERE repository_id = ? AND committed_at >= ? AND committed_at < ?
       ORDER BY committed_at ASC, oid ASC`,
    )
    .bind(
      repositoryId,
      clampInstantToDataCutoff(bounds.start),
      bounds.endExclusive,
    )
    .all<CommitRow>();
  return result.results;
}

async function rebuildScopedRecord(
  db: D1Database,
  repository: RepositoryRow,
  bounds: PeriodBounds,
  scope: Scope,
  now: string,
): Promise<string | null> {
  const id = recordId(scope, bounds, repository.id);
  const commits = await commitsForPeriod(db, repository.id, bounds);

  if (
    commits.length === 0 ||
    (scope === "public" && repository.visibility !== "public")
  ) {
    await db.prepare("DELETE FROM change_records WHERE id = ?").bind(id).run();
    return null;
  }

  const fingerprint = await sha256(
    commits.map((commit) => `${commit.oid}:${commit.committed_at}`).join("\n"),
  );
  const existing = await db
    .prepare(
      `SELECT source_fingerprint, summary_status, generated_at, updated_at
       FROM change_records WHERE id = ?`,
    )
    .bind(id)
    .first<{
      source_fingerprint: string;
      summary_status: ChangeRecordRow["summary_status"];
      generated_at: string | null;
      updated_at: string;
    }>();
  const first = commits[0];
  const last = commits.at(-1);
  if (!first || !last) {
    return null;
  }

  const statements = [
    db
      .prepare(
        `INSERT INTO change_records (
           id, scope, period_type, period_key, period_start, period_end,
           repository_id, commit_count, first_committed_at, last_committed_at,
           source_fingerprint, summary_status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           period_key = excluded.period_key,
           period_start = excluded.period_start,
           period_end = excluded.period_end,
           commit_count = excluded.commit_count,
           first_committed_at = excluded.first_committed_at,
           last_committed_at = excluded.last_committed_at,
           summary_text = CASE
             WHEN change_records.source_fingerprint = excluded.source_fingerprint
             THEN change_records.summary_text ELSE NULL END,
           summary_status = CASE
             WHEN change_records.source_fingerprint = excluded.source_fingerprint
             THEN change_records.summary_status ELSE 'pending' END,
           summary_model = CASE
             WHEN change_records.source_fingerprint = excluded.source_fingerprint
             THEN change_records.summary_model ELSE NULL END,
           prompt_version = CASE
             WHEN change_records.source_fingerprint = excluded.source_fingerprint
             THEN change_records.prompt_version ELSE NULL END,
           generated_at = change_records.generated_at,
           summary_error = NULL,
           source_fingerprint = excluded.source_fingerprint,
           updated_at = CASE
             WHEN change_records.source_fingerprint = excluded.source_fingerprint
             THEN change_records.updated_at ELSE excluded.updated_at END`,
      )
      .bind(
        id,
        scope,
        bounds.type,
        bounds.key,
        bounds.start,
        bounds.endExclusive,
        repository.id,
        commits.length,
        first.committed_at,
        last.committed_at,
        fingerprint,
        now,
        now,
      ),
    db
      .prepare("DELETE FROM change_record_commits WHERE change_record_id = ?")
      .bind(id),
    ...commits.map((commit) =>
      db
        .prepare(
          `INSERT INTO change_record_commits (change_record_id, repository_id, commit_oid)
           VALUES (?, ?, ?)`,
        )
        .bind(id, repository.id, commit.oid),
    ),
  ];
  await db.batch(statements);

  const needsSummary =
    !existing ||
    existing.source_fingerprint !== fingerprint ||
    existing.summary_status === "failed" ||
    existing.summary_status === "pending";
  if (!needsSummary) return null;

  const cadenceAnchor = existing
    ? (existing.generated_at ?? existing.updated_at)
    : null;
  return isSummaryGenerationDue(bounds, cadenceAnchor, now) ? id : null;
}

export async function rebuildAffectedRecords(
  env: Env,
  repository: RepositoryRow,
  commitTimestamps: string[],
  now = new Date().toISOString(),
): Promise<string[]> {
  const uniqueBounds = new Map<string, PeriodBounds>();
  for (const timestamp of commitTimestamps) {
    if (Date.parse(timestamp) < DATA_CUTOFF_MS) continue;
    for (const periodType of periodTypes) {
      const bounds = periodBoundsForInstant(periodType, timestamp);
      uniqueBounds.set(`${bounds.type}:${bounds.key}`, bounds);
    }
  }

  const pendingSummaries = new Set<string>();
  for (const bounds of uniqueBounds.values()) {
    const allId = await rebuildScopedRecord(
      env.DB,
      repository,
      bounds,
      "all",
      now,
    );
    if (allId) pendingSummaries.add(allId);

    const publicId = await rebuildScopedRecord(
      env.DB,
      repository,
      bounds,
      "public",
      now,
    );
    if (publicId) pendingSummaries.add(publicId);
  }

  return [...pendingSummaries];
}

export function createCommitLogUrl(
  repository: Pick<RepositoryRow, "html_url">,
  owner: string,
  bounds: PeriodBounds,
): string {
  const url = new URL(`${repository.html_url}/commits`);
  url.searchParams.set("author", owner);
  url.searchParams.set("since", clampInstantToDataCutoff(bounds.start));
  url.searchParams.set("until", bounds.endInclusive);
  return url.toString();
}

export function isPeriodType(value: string): value is PeriodType {
  return periodTypes.some((periodType) => periodType === value);
}
