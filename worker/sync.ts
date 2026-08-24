import type { QueueMessage, RepositoryRow } from "./domain";
import {
  GitHubApiError,
  listInstalledRepositories,
  listRepositoryCommitsPage,
  splitCommitMessage,
} from "./github";
import { rebuildAffectedRecords } from "./records";

const INITIAL_SYNC_DAYS = 365;
const OVERLAP_MS = 2 * 24 * 60 * 60 * 1000;

function log(level: "info" | "error", details: Record<string, unknown>): void {
  const entry = JSON.stringify(details);
  if (level === "error") {
    console.error(entry);
  } else {
    console.log(entry);
  }
}

async function startSyncRun(db: D1Database, jobType: string): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO sync_runs (id, job_type, status, started_at)
       VALUES (?, ?, 'running', ?)`,
    )
    .bind(id, jobType, new Date().toISOString())
    .run();
  return id;
}

async function finishSyncRun(
  db: D1Database,
  id: string,
  result: { repositoriesSeen?: number; commitsSeen?: number; error?: string },
): Promise<void> {
  await db
    .prepare(
      `UPDATE sync_runs
       SET status = ?, repositories_seen = ?, commits_seen = ?, completed_at = ?, error_message = ?
       WHERE id = ?`,
    )
    .bind(
      result.error ? "failed" : "succeeded",
      result.repositoriesSeen ?? 0,
      result.commitsSeen ?? 0,
      new Date().toISOString(),
      result.error ?? null,
      id,
    )
    .run();
}

export async function syncOwner(env: Env): Promise<void> {
  const runId = await startSyncRun(env.DB, "sync-owner");
  try {
    const repositories = await listInstalledRepositories(env);
    const now = new Date().toISOString();
    const statements = [
      env.DB.prepare(
        "UPDATE repositories SET deleted_at = ?, updated_at = ? WHERE owner_login = ?",
      ).bind(now, now, env.GITHUB_OWNER),
      ...repositories.flatMap((repository) => [
        env.DB.prepare(
          `INSERT INTO repository_aliases (owner_login, name, repository_id, created_at)
           SELECT owner_login, name, id, ? FROM repositories
           WHERE id = ? AND name <> ? COLLATE NOCASE
           ON CONFLICT(owner_login, name) DO NOTHING`,
        ).bind(now, repository.node_id, repository.name),
        env.DB.prepare(
          `INSERT INTO repositories (
               id, owner_login, name, full_name, visibility, html_url, default_branch,
               is_archived, is_fork, github_updated_at, deleted_at, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               owner_login = excluded.owner_login,
               name = excluded.name,
               full_name = excluded.full_name,
               visibility = excluded.visibility,
               html_url = excluded.html_url,
               default_branch = excluded.default_branch,
               is_archived = excluded.is_archived,
               is_fork = excluded.is_fork,
               github_updated_at = excluded.github_updated_at,
               deleted_at = NULL,
               updated_at = excluded.updated_at`,
        ).bind(
          repository.node_id,
          repository.owner.login,
          repository.name,
          repository.full_name,
          repository.visibility,
          repository.html_url,
          repository.default_branch,
          repository.archived ? 1 : 0,
          repository.fork ? 1 : 0,
          repository.updated_at,
          now,
          now,
        ),
      ]),
    ];
    await env.DB.batch(statements);

    for (let index = 0; index < repositories.length; index += 100) {
      const batch = repositories
        .slice(index, index + 100)
        .map((repository) => ({
          body: {
            type: "sync-repository",
            repositoryId: repository.node_id,
            requestedAt: now,
          } satisfies QueueMessage,
          contentType: "json" as const,
        }));
      if (batch.length > 0) {
        await env.JOBS.sendBatch(batch);
      }
    }

    await finishSyncRun(env.DB, runId, {
      repositoriesSeen: repositories.length,
    });
    log("info", {
      event: "sync_owner_succeeded",
      repositories: repositories.length,
      runId,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown sync error";
    await finishSyncRun(env.DB, runId, { error: message });
    throw error;
  }
}

async function getRepository(
  db: D1Database,
  id: string,
): Promise<RepositoryRow | null> {
  return db
    .prepare(
      `SELECT id, owner_login, name, full_name, visibility, html_url, default_branch,
              is_archived, is_fork, github_updated_at, last_synced_at, deleted_at
       FROM repositories WHERE id = ? AND deleted_at IS NULL`,
    )
    .bind(id)
    .first<RepositoryRow>();
}

function initialSince(repository: RepositoryRow, requestedAt: string): string {
  const end = new Date(requestedAt).getTime();
  if (!repository.last_synced_at) {
    return new Date(
      end - INITIAL_SYNC_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
  }
  return new Date(
    new Date(repository.last_synced_at).getTime() - OVERLAP_MS,
  ).toISOString();
}

export async function syncRepository(
  env: Env,
  message: Extract<QueueMessage, { type: "sync-repository" }>,
): Promise<void> {
  const repository = await getRepository(env.DB, message.repositoryId);
  if (!repository || repository.is_archived === 1) {
    return;
  }

  const since = message.since ?? initialSince(repository, message.requestedAt);
  const pageNumber = message.page ?? 1;
  const page = await listRepositoryCommitsPage(
    env,
    { name: repository.name, defaultBranch: repository.default_branch },
    since,
    pageNumber,
  );
  const now = new Date().toISOString();
  const statements = page.commits.map((commit) => {
    const { headline, body } = splitCommitMessage(commit.commit.message);
    const committedAt =
      commit.commit.committer?.date ?? commit.commit.author?.date;
    if (!committedAt) {
      throw new Error(`Commit ${commit.sha} has no timestamp.`);
    }
    return env.DB.prepare(
      `INSERT INTO commits (
           repository_id, oid, message_headline, message_body, committed_at,
           author_github_user_id, author_login, html_url, is_merge, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(repository_id, oid) DO UPDATE SET
           message_headline = excluded.message_headline,
           message_body = excluded.message_body,
           committed_at = excluded.committed_at,
           author_github_user_id = excluded.author_github_user_id,
           author_login = excluded.author_login,
           html_url = excluded.html_url,
           is_merge = excluded.is_merge,
           updated_at = excluded.updated_at`,
    ).bind(
      repository.id,
      commit.sha,
      headline,
      body,
      committedAt,
      commit.author ? String(commit.author.id) : null,
      commit.author?.login ?? null,
      commit.html_url,
      commit.parents.length > 1 ? 1 : 0,
      now,
      now,
    );
  });

  if (statements.length > 0) {
    await env.DB.batch(statements);
  }

  const timestamps = page.commits.flatMap((commit) => {
    const timestamp =
      commit.commit.committer?.date ?? commit.commit.author?.date;
    return timestamp ? [timestamp] : [];
  });
  const summaryIds = await rebuildAffectedRecords(env, repository, timestamps);
  if (summaryIds.length > 0) {
    await env.JOBS.sendBatch(
      summaryIds.map((changeRecordId) => ({
        body: {
          type: "generate-summary",
          changeRecordId,
          requestedAt: now,
        } satisfies QueueMessage,
        contentType: "json" as const,
      })),
    );
  }

  if (page.hasNextPage) {
    await env.JOBS.send(
      {
        type: "sync-repository",
        repositoryId: repository.id,
        requestedAt: message.requestedAt,
        since,
        page: pageNumber + 1,
      } satisfies QueueMessage,
      { contentType: "json" },
    );
  } else {
    await env.DB.prepare(
      "UPDATE repositories SET last_synced_at = ?, updated_at = ? WHERE id = ?",
    )
      .bind(now, now, repository.id)
      .run();
  }
  log("info", {
    event: "sync_repository_succeeded",
    repositoryId: repository.id,
    commits: page.commits.length,
    page: pageNumber,
    hasNextPage: page.hasNextPage,
  });
}

export function isRetryableSyncError(error: unknown): boolean {
  return error instanceof GitHubApiError ? error.retryable : true;
}
