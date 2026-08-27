import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { getLatestDailyRecords, getPeriodRecords } from "../worker/api";
import type { RepositoryRow } from "../worker/domain";
import { rebuildAffectedRecords } from "../worker/records";

const publicRepository: RepositoryRow = {
  id: "repo_public",
  owner_login: "onishi",
  name: "changes",
  full_name: "onishi/changes",
  visibility: "public",
  html_url: "https://github.com/onishi/changes",
  default_branch: "main",
  is_archived: 0,
  is_fork: 0,
  github_updated_at: "2026-08-20T12:00:00.000Z",
  last_synced_at: null,
  deleted_at: null,
};

const privateRepository: RepositoryRow = {
  ...publicRepository,
  id: "repo_private",
  name: "secret-project",
  full_name: "onishi/secret-project",
  visibility: "private",
  html_url: "https://github.com/onishi/secret-project",
};

async function insertRepository(repository: RepositoryRow): Promise<void> {
  const now = "2026-08-20T12:00:00.000Z";
  await env.DB.prepare(
    `INSERT INTO repositories (
       id, owner_login, name, full_name, visibility, html_url, default_branch,
       is_archived, is_fork, github_updated_at, last_synced_at, deleted_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      repository.id,
      repository.owner_login,
      repository.name,
      repository.full_name,
      repository.visibility,
      repository.html_url,
      repository.default_branch,
      repository.is_archived,
      repository.is_fork,
      repository.github_updated_at,
      repository.last_synced_at,
      repository.deleted_at,
      now,
      now,
    )
    .run();
}

async function insertCommit(
  repository: RepositoryRow,
  oid: string,
  committedAt: string,
  headline: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO commits (
       repository_id, oid, message_headline, message_body, committed_at,
       author_github_user_id, author_login, html_url, is_merge, created_at, updated_at
     ) VALUES (?, ?, ?, NULL, ?, '1', 'onishi', ?, 0, ?, ?)`,
  )
    .bind(
      repository.id,
      oid,
      headline,
      committedAt,
      `${repository.html_url}/commit/${oid}`,
      committedAt,
      committedAt,
    )
    .run();
}

function testEnv(): Env {
  return {
    DB: env.DB,
    GITHUB_OWNER: "onishi",
  } as Env;
}

describe("change record aggregation and public boundary", () => {
  it("returns only the five newest daily records across dates", async () => {
    await insertRepository(publicRepository);
    const committedAt = Array.from(
      { length: 6 },
      (_, index) =>
        `2026-08-${String(15 + index).padStart(2, "0")}T01:00:00.000Z`,
    );
    await Promise.all(
      committedAt.map((timestamp, index) =>
        insertCommit(
          publicRepository,
          `daily-${String(index)}`,
          timestamp,
          `Daily change ${String(index)}`,
        ),
      ),
    );
    await rebuildAffectedRecords(testEnv(), publicRepository, committedAt);

    const result = await getLatestDailyRecords({
      env: testEnv(),
      scope: "public",
      limit: 5,
    });

    expect(result.records).toHaveLength(5);
    expect(result.records.map((record) => record.periodKey)).toEqual([
      "2026-08-20",
      "2026-08-19",
      "2026-08-18",
      "2026-08-17",
      "2026-08-16",
    ]);
    expect(
      result.records.every((record) => record.periodType === "daily"),
    ).toBe(true);
    expect(result.records.every((record) => record.commits.length === 0)).toBe(
      true,
    );
  });

  it("rejects future periods and malformed cursors", async () => {
    await expect(
      getPeriodRecords({
        env: testEnv(),
        scope: "public",
        periodType: "daily",
        periodKey: "2999-01-01",
      }),
    ).rejects.toThrow("Future periods");
    await expect(
      getPeriodRecords({
        env: testEnv(),
        scope: "public",
        periodType: "daily",
        periodKey: "2026-08-20",
        cursor: "not-a-cursor",
      }),
    ).rejects.toThrow();
  });

  it("aggregates multiple same-day commits into one repository record", async () => {
    await insertRepository(publicRepository);
    await insertCommit(
      publicRepository,
      "aaa111",
      "2026-08-20T01:00:00.000Z",
      "First",
    );
    await insertCommit(
      publicRepository,
      "bbb222",
      "2026-08-20T05:00:00.000Z",
      "Second",
    );

    const pending = await rebuildAffectedRecords(testEnv(), publicRepository, [
      "2026-08-20T01:00:00.000Z",
      "2026-08-20T05:00:00.000Z",
    ]);
    expect(pending).toHaveLength(6);

    const result = await getPeriodRecords({
      env: testEnv(),
      scope: "public",
      periodType: "daily",
      periodKey: "2026-08-20",
    });
    const records = result.records;
    expect(records).toHaveLength(1);
    expect(records[0]?.commitCount).toBe(2);
    expect(records[0]?.commits).toHaveLength(2);

    const commitLogUrl = new URL(records[0]?.commitLogUrl ?? "");
    expect(commitLogUrl.searchParams.get("author")).toBe("onishi");
    expect(commitLogUrl.searchParams.get("since")).toBe(
      "2026-08-19T15:00:00.000Z",
    );
    expect(commitLogUrl.searchParams.get("until")).toBe(
      "2026-08-20T14:59:59.000Z",
    );

    const preview = await getPeriodRecords({
      env: testEnv(),
      scope: "public",
      periodType: "daily",
      periodKey: "2026-08-20",
      pageSize: 3,
      includeCommits: false,
    });
    expect(preview.records[0]?.commits).toEqual([]);
  });

  it("keeps only cutoff-and-later commits in the boundary week", async () => {
    await insertRepository(publicRepository);
    await expect(
      insertCommit(
        publicRepository,
        "before-cutoff",
        "2026-04-30T14:59:59.000Z",
        "Before cutoff",
      ),
    ).rejects.toThrow("cutoff");
    await insertCommit(
      publicRepository,
      "at-cutoff",
      "2026-04-30T15:00:00.000Z",
      "At cutoff",
    );

    const pending = await rebuildAffectedRecords(testEnv(), publicRepository, [
      "2026-04-30T14:59:59.000Z",
      "2026-04-30T15:00:00.000Z",
    ]);
    expect(pending).toHaveLength(6);

    const result = await getPeriodRecords({
      env: testEnv(),
      scope: "public",
      periodType: "weekly",
      periodKey: "2026-04-26",
    });
    const records = result.records;
    expect(records).toHaveLength(1);
    expect(records[0]?.commitCount).toBe(1);
    expect(records[0]?.commits.map((commit) => commit.oid)).toEqual([
      "at-cutoff",
    ]);
    expect(
      new URL(records[0]?.commitLogUrl ?? "").searchParams.get("since"),
    ).toBe("2026-04-30T15:00:00.000Z");

    await expect(
      getPeriodRecords({
        env: testEnv(),
        scope: "public",
        periodType: "daily",
        periodKey: "2026-04-30",
      }),
    ).rejects.toThrow("before 2026-05-01");
  });

  it("paginates records with a stable timestamp and repository cursor", async () => {
    const now = "2026-08-20T01:00:00.000Z";
    const statements: D1PreparedStatement[] = [];
    for (let index = 0; index < 51; index += 1) {
      const id = `repo_${String(index).padStart(2, "0")}`;
      const name = `project-${String(index).padStart(2, "0")}`;
      statements.push(
        env.DB.prepare(
          `INSERT INTO repositories (
             id, owner_login, name, full_name, visibility, html_url, default_branch,
             is_archived, is_fork, created_at, updated_at
           ) VALUES (?, 'onishi', ?, ?, 'public', ?, 'main', 0, 0, ?, ?)`,
        ).bind(
          id,
          name,
          `onishi/${name}`,
          `https://github.com/onishi/${name}`,
          now,
          now,
        ),
        env.DB.prepare(
          `INSERT INTO change_records (
             id, scope, period_type, period_key, period_start, period_end,
             repository_id, commit_count, first_committed_at, last_committed_at,
             source_fingerprint, summary_status, created_at, updated_at
           ) VALUES (?, 'public', 'daily', '2026-08-20', ?, ?, ?, 1, ?, ?, ?, 'pending', ?, ?)`,
        ).bind(
          `public:daily:2026-08-20:${id}`,
          "2026-08-19T15:00:00.000Z",
          "2026-08-20T15:00:00.000Z",
          id,
          now,
          now,
          `fingerprint-${id}`,
          now,
          now,
        ),
      );
    }
    await env.DB.batch(statements.slice(0, 100));
    await env.DB.batch(statements.slice(100));

    const firstPage = await getPeriodRecords({
      env: testEnv(),
      scope: "public",
      periodType: "daily",
      periodKey: "2026-08-20",
    });
    expect(firstPage.records).toHaveLength(50);
    expect(firstPage.nextCursor).toEqual(expect.any(String));

    const secondPage = await getPeriodRecords({
      env: testEnv(),
      scope: "public",
      periodType: "daily",
      periodKey: "2026-08-20",
      cursor: firstPage.nextCursor,
    });
    expect(secondPage.records).toHaveLength(1);
    const firstIds = firstPage.records.map((record) => record.id);
    const secondIds = secondPage.records.map((record) => record.id);
    expect(new Set([...firstIds, ...secondIds]).size).toBe(51);
  });

  it("never returns private repository data from the public scope", async () => {
    await insertRepository(publicRepository);
    await insertRepository(privateRepository);
    await insertCommit(
      publicRepository,
      "public1",
      "2026-08-20T01:00:00.000Z",
      "Public change",
    );
    await insertCommit(
      privateRepository,
      "secret1",
      "2026-08-20T02:00:00.000Z",
      "Canary secret",
    );
    await rebuildAffectedRecords(testEnv(), publicRepository, [
      "2026-08-20T01:00:00.000Z",
    ]);
    await rebuildAffectedRecords(testEnv(), privateRepository, [
      "2026-08-20T02:00:00.000Z",
    ]);

    const publicResult = await getPeriodRecords({
      env: testEnv(),
      scope: "public",
      periodType: "daily",
      periodKey: "2026-08-20",
    });
    expect(JSON.stringify(publicResult)).not.toContain("secret-project");
    expect(JSON.stringify(publicResult)).not.toContain("Canary secret");
    expect(publicResult.stats).toEqual({
      repository_count: 1,
      commit_count: 1,
    });

    const allResult = await getPeriodRecords({
      env: testEnv(),
      scope: "all",
      periodType: "daily",
      periodKey: "2026-08-20",
    });
    expect(JSON.stringify(allResult)).toContain("secret-project");
    expect(allResult.stats).toEqual({ repository_count: 2, commit_count: 2 });
  });

  it("returns 404-equivalent behavior for a private repository in public scope", async () => {
    await insertRepository(privateRepository);
    await expect(
      getPeriodRecords({
        env: testEnv(),
        scope: "public",
        periodType: "daily",
        periodKey: "2026-08-20",
        repositoryName: privateRepository.name,
      }),
    ).rejects.toThrow("Repository not found.");
  });

  it("hides stale public records immediately after a visibility change", async () => {
    await insertRepository(publicRepository);
    await insertCommit(
      publicRepository,
      "waspublic",
      "2026-08-20T01:00:00.000Z",
      "Sensitive now",
    );
    await rebuildAffectedRecords(testEnv(), publicRepository, [
      "2026-08-20T01:00:00.000Z",
    ]);

    await env.DB.prepare(
      "UPDATE repositories SET visibility = 'private' WHERE id = ?",
    )
      .bind(publicRepository.id)
      .run();

    const result = await getPeriodRecords({
      env: testEnv(),
      scope: "public",
      periodType: "daily",
      periodKey: "2026-08-20",
    });
    expect(result.records).toEqual([]);
    expect(result.stats).toEqual({ repository_count: 0, commit_count: 0 });
    expect(JSON.stringify(result)).not.toContain("Sensitive now");
  });

  it("resolves a renamed repository through its historical alias", async () => {
    await insertRepository(publicRepository);
    await insertCommit(
      publicRepository,
      "rename1",
      "2026-08-20T01:00:00.000Z",
      "Rename test",
    );
    await rebuildAffectedRecords(testEnv(), publicRepository, [
      "2026-08-20T01:00:00.000Z",
    ]);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO repository_aliases (owner_login, name, repository_id, created_at)
         VALUES ('onishi', 'changes', ?, '2026-08-21T00:00:00.000Z')`,
      ).bind(publicRepository.id),
      env.DB.prepare(
        `UPDATE repositories SET name = 'changes-renamed', full_name = 'onishi/changes-renamed',
           html_url = 'https://github.com/onishi/changes-renamed' WHERE id = ?`,
      ).bind(publicRepository.id),
    ]);

    const result = await getPeriodRecords({
      env: testEnv(),
      scope: "public",
      periodType: "daily",
      periodKey: "2026-08-20",
      repositoryName: "changes",
    });
    expect(result.repository).toEqual({
      requestedName: "changes",
      canonicalName: "changes-renamed",
    });
    expect(JSON.stringify(result.records)).toContain("changes-renamed");
  });
});
