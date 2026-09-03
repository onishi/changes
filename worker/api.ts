import { z } from "zod";
import {
  DATA_CUTOFF_INSTANT,
  DATA_CUTOFF_LOCAL_DATE,
} from "../shared/data-cutoff";
import type {
  ChangeRecordRow,
  CommitRow,
  PeriodType,
  RepositoryRow,
  Scope,
} from "./domain";
import { decodeCursor, encodeCursor } from "./lib/crypto";
import {
  currentPeriodKey,
  periodBoundsForRoute,
  shiftPeriodKey,
} from "./lib/time";
import { createCommitLogUrl } from "./records";
import type {
  ChangeRecord,
  CommitsResponse,
  LatestDailyResponse,
  PeriodResponse,
} from "../src/types";

const PAGE_SIZE = 50;
const cursorSchema = z.object({
  lastCommittedAt: z.iso.datetime(),
  repositoryId: z.string().min(1),
});

export async function getRecordCommits(options: {
  env: Env;
  scope: Scope;
  recordId: string;
}): Promise<CommitsResponse | null> {
  const record = await options.env.DB.prepare(
    `SELECT cr.id
       FROM change_records cr
       JOIN repositories r ON r.id = cr.repository_id
      WHERE cr.id = ? AND cr.scope = ? AND r.deleted_at IS NULL
        ${options.scope === "public" ? "AND r.visibility = 'public'" : ""}`,
  )
    .bind(options.recordId, options.scope)
    .first<{ id: string }>();
  if (!record) return null;

  const result = await options.env.DB.prepare(
    `SELECT c.repository_id, c.oid, c.message_headline, c.message_body,
            c.committed_at, c.author_github_user_id, c.author_login,
            c.html_url, c.is_merge
       FROM change_record_commits crc
       JOIN commits c
         ON c.repository_id = crc.repository_id AND c.oid = crc.commit_oid
      WHERE crc.change_record_id = ? AND c.committed_at >= ?
      ORDER BY c.committed_at DESC, c.oid ASC`,
  )
    .bind(options.recordId, DATA_CUTOFF_INSTANT)
    .all<CommitRow>();
  return { commits: result.results };
}

type RecordWithRepository = ChangeRecordRow;

interface CommitWithRecord extends CommitRow {
  change_record_id: string;
}

function parseCursor(
  value: string | null,
): z.infer<typeof cursorSchema> | null {
  if (!value) return null;
  const parsed = cursorSchema.safeParse(decodeCursor(value));
  if (!parsed.success) {
    throw new Error("Invalid cursor.");
  }
  return parsed.data;
}

async function findRepository(
  db: D1Database,
  scope: Scope,
  owner: string,
  name: string,
): Promise<RepositoryRow | null> {
  const visibility = scope === "public" ? "AND visibility = 'public'" : "";
  return db
    .prepare(
      `SELECT id, owner_login, name, full_name, visibility, html_url, default_branch,
              is_archived, is_fork, github_updated_at, last_synced_at, deleted_at
       FROM repositories
       WHERE id = COALESCE(
         (SELECT id FROM repositories
          WHERE owner_login = ? AND name = ? COLLATE NOCASE AND deleted_at IS NULL),
         (SELECT repository_id FROM repository_aliases
          WHERE owner_login = ? AND name = ? COLLATE NOCASE)
       )
       AND deleted_at IS NULL ${visibility}`,
    )
    .bind(owner, name, owner, name)
    .first<RepositoryRow>();
}

export async function listRepositories(
  db: D1Database,
  scope: Scope,
): Promise<RepositoryRow[]> {
  const visibility = scope === "public" ? "AND visibility = 'public'" : "";
  const result = await db
    .prepare(
      `SELECT id, owner_login, name, full_name, visibility, html_url, default_branch,
              is_archived, is_fork, github_updated_at, last_synced_at, deleted_at,
              created_at
       FROM repositories
       WHERE deleted_at IS NULL
         AND github_updated_at >= ?
         ${visibility}
       ORDER BY github_updated_at DESC`,
    )
    .bind(DATA_CUTOFF_INSTANT)
    .all<RepositoryRow>();
  return result.results;
}

function changeRecordFromRow(
  record: RecordWithRepository,
  commits: CommitRow[] = [],
): ChangeRecord {
  const bounds = periodBoundsForRoute(record.period_type, record.period_key);
  return {
    id: record.id,
    repository: {
      name: record.repository_name,
      fullName: record.repository_full_name,
      url: record.repository_url,
      visibility: record.repository_visibility,
    },
    periodType: record.period_type,
    periodKey: record.period_key,
    commitCount: record.commit_count,
    firstCommittedAt: record.first_committed_at,
    lastCommittedAt: record.last_committed_at,
    summary: {
      text: record.summary_text,
      status: record.summary_status,
      model: record.summary_model,
      generatedAt: record.generated_at,
    },
    commitLogUrl: createCommitLogUrl(
      { html_url: record.repository_url },
      bounds,
    ),
    commits,
  };
}

export async function getLatestDailyRecords(options: {
  env: Env;
  scope: Scope;
  repositoryName?: string;
  days?: number;
  now?: Date;
}): Promise<LatestDailyResponse> {
  const days = Math.min(Math.max(options.days ?? 5, 1), 31);
  const today = periodBoundsForRoute(
    "daily",
    currentPeriodKey("daily", options.now),
  );
  const recentStart = new Date(
    new Date(today.start).getTime() - (days - 1) * 24 * 60 * 60 * 1000,
  ).toISOString();
  const repository = options.repositoryName
    ? await findRepository(
        options.env.DB,
        options.scope,
        options.env.GITHUB_OWNER,
        options.repositoryName,
      )
    : null;
  if (options.repositoryName && !repository) {
    throw new Error("Repository not found.");
  }
  const conditions = [
    "cr.scope = ?",
    "cr.period_type = 'daily'",
    "cr.period_start >= ?",
    "cr.period_start < ?",
    "cr.period_start >= ?",
    "r.deleted_at IS NULL",
  ];
  const bindings = [
    options.scope,
    recentStart,
    today.endExclusive,
    DATA_CUTOFF_INSTANT,
  ];
  if (options.scope === "public") {
    conditions.push("r.visibility = 'public'");
  }
  if (repository) {
    conditions.push("cr.repository_id = ?");
    bindings.push(repository.id);
  }
  const result = await options.env.DB.prepare(
    `SELECT cr.*, r.name AS repository_name, r.full_name AS repository_full_name,
            r.html_url AS repository_url, r.visibility AS repository_visibility,
            r.default_branch
     FROM change_records cr
     JOIN repositories r ON r.id = cr.repository_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY cr.period_start DESC, cr.last_committed_at DESC,
              r.name COLLATE NOCASE ASC`,
  )
    .bind(...bindings)
    .all<RecordWithRepository>();

  return {
    records: result.results.map((record) => changeRecordFromRow(record)),
  };
}

export async function getPeriodRecords(options: {
  env: Env;
  scope: Scope;
  periodType: PeriodType;
  periodKey: string;
  repositoryName?: string;
  cursor?: string | null;
  pageSize?: number;
  includeCommits?: boolean;
}): Promise<PeriodResponse> {
  const pageSize = Math.min(
    Math.max(options.pageSize ?? PAGE_SIZE, 1),
    PAGE_SIZE,
  );
  const bounds = periodBoundsForRoute(options.periodType, options.periodKey);
  if (bounds.endExclusive <= DATA_CUTOFF_INSTANT) {
    throw new Error(
      `Periods before ${DATA_CUTOFF_LOCAL_DATE} are not available.`,
    );
  }
  if (options.periodKey > currentPeriodKey(options.periodType)) {
    throw new Error("Future periods are not available.");
  }
  const cursor = parseCursor(options.cursor ?? null);

  // Independent of the repository lookup below, so kick it off now instead
  // of waiting for that round trip to finish first.
  const latestRunPromise = options.env.DB.prepare(
    `SELECT status, started_at, completed_at
     FROM sync_runs WHERE job_type = 'sync-owner'
     ORDER BY started_at DESC LIMIT 1`,
  ).first<{
    status: "running" | "succeeded" | "failed";
    started_at: string;
    completed_at: string | null;
  }>();

  const repository = options.repositoryName
    ? await findRepository(
        options.env.DB,
        options.scope,
        options.env.GITHUB_OWNER,
        options.repositoryName,
      )
    : null;
  if (options.repositoryName && !repository) {
    throw new Error("Repository not found.");
  }

  const conditions = [
    "cr.scope = ?",
    "cr.period_type = ?",
    "cr.period_start = ?",
    "r.deleted_at IS NULL",
  ];
  const bindings: (string | number)[] = [
    options.scope,
    options.periodType,
    bounds.start,
  ];
  if (options.scope === "public") {
    conditions.push("r.visibility = 'public'");
  }
  if (repository) {
    conditions.push("cr.repository_id = ?");
    bindings.push(repository.id);
  }
  if (cursor) {
    conditions.push(
      "(cr.last_committed_at < ? OR (cr.last_committed_at = ? AND cr.repository_id > ?))",
    );
    bindings.push(
      cursor.lastCommittedAt,
      cursor.lastCommittedAt,
      cursor.repositoryId,
    );
  }

  const statsConditions = [
    "cr.scope = ?",
    "cr.period_type = ?",
    "cr.period_start = ?",
    "r.deleted_at IS NULL",
  ];
  const statsBindings: string[] = [
    options.scope,
    options.periodType,
    bounds.start,
  ];
  if (options.scope === "public") {
    statsConditions.push("r.visibility = 'public'");
  }
  if (repository) {
    statsConditions.push("cr.repository_id = ?");
    statsBindings.push(repository.id);
  }

  const syncConditions = ["deleted_at IS NULL"];
  const syncBindings: string[] = [];
  if (options.scope === "public") syncConditions.push("visibility = 'public'");
  if (repository) {
    syncConditions.push("id = ?");
    syncBindings.push(repository.id);
  }

  // These three only depend on the repository lookup above, not on each
  // other, so run them concurrently instead of one after another.
  const [recordsResult, stats, sync] = await Promise.all([
    options.env.DB.prepare(
      `SELECT cr.*, r.name AS repository_name, r.full_name AS repository_full_name,
              r.html_url AS repository_url, r.visibility AS repository_visibility,
              r.default_branch
         FROM change_records cr
         JOIN repositories r ON r.id = cr.repository_id
         WHERE ${conditions.join(" AND ")}
         ORDER BY cr.last_committed_at DESC, cr.repository_id ASC
         LIMIT ?`,
    )
      .bind(...bindings, pageSize + 1)
      .all<RecordWithRepository>(),
    options.env.DB.prepare(
      `SELECT COUNT(*) AS repository_count, COALESCE(SUM(cr.commit_count), 0) AS commit_count
         FROM change_records cr
         JOIN repositories r ON r.id = cr.repository_id
         WHERE ${statsConditions.join(" AND ")}`,
    )
      .bind(...statsBindings)
      .first<{ repository_count: number; commit_count: number }>(),
    options.env.DB.prepare(
      `SELECT MAX(last_synced_at) AS last_synced_at
       FROM repositories WHERE ${syncConditions.join(" AND ")}`,
    )
      .bind(...syncBindings)
      .first<{ last_synced_at: string | null }>(),
  ]);

  const hasNextPage = recordsResult.results.length > pageSize;
  const records = recordsResult.results.slice(0, pageSize);
  const commitsByRecord = new Map<string, CommitRow[]>();
  if (options.includeCommits !== false && records.length > 0) {
    const placeholders = records.map(() => "?").join(", ");
    const commitsResult = await options.env.DB.prepare(
      `SELECT crc.change_record_id, c.repository_id, c.oid, c.message_headline,
                c.message_body, c.committed_at, c.author_github_user_id, c.author_login,
                c.html_url, c.is_merge
         FROM change_record_commits crc
         JOIN commits c
           ON c.repository_id = crc.repository_id AND c.oid = crc.commit_oid
         WHERE crc.change_record_id IN (${placeholders})
           AND c.committed_at >= ?
         ORDER BY c.committed_at DESC, c.oid ASC`,
    )
      .bind(...records.map((record) => record.id), DATA_CUTOFF_INSTANT)
      .all<CommitWithRecord>();

    for (const commit of commitsResult.results) {
      const current = commitsByRecord.get(commit.change_record_id) ?? [];
      current.push(commit);
      commitsByRecord.set(commit.change_record_id, current);
    }
  }

  const latestRun = await latestRunPromise;

  const last = records.at(-1);
  const nextCursor =
    hasNextPage && last
      ? encodeCursor({
          lastCommittedAt: last.last_committed_at,
          repositoryId: last.repository_id,
        })
      : null;

  return {
    scope: options.scope,
    repository: repository
      ? {
          requestedName: options.repositoryName ?? repository.name,
          canonicalName: repository.name,
        }
      : null,
    period: {
      type: options.periodType,
      key: options.periodKey,
      start: bounds.start,
      endExclusive: bounds.endExclusive,
      previousKey: shiftPeriodKey(options.periodType, options.periodKey, -1),
      nextKey: shiftPeriodKey(options.periodType, options.periodKey, 1),
    },
    stats: stats ?? { repository_count: 0, commit_count: 0 },
    sync: {
      lastSyncedAt: sync?.last_synced_at ?? null,
      status: latestRun?.status ?? "idle",
      startedAt: latestRun?.started_at ?? null,
      completedAt: latestRun?.completed_at ?? null,
    },
    records: records.map((record) =>
      changeRecordFromRow(record, commitsByRecord.get(record.id) ?? []),
    ),
    nextCursor,
  };
}
