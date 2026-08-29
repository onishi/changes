import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { RepositoryRow } from "../worker/domain";
import type { GitHubCommit } from "../worker/github";
import { initialSince, isStorableCommit } from "../worker/sync";

const NOW = "2026-08-20T01:00:00.000Z";

function repository(lastSyncedAt: string | null): RepositoryRow {
  return {
    id: "repo",
    owner_login: "onishi",
    name: "changes",
    full_name: "onishi/changes",
    visibility: "public",
    html_url: "https://github.com/onishi/changes",
    default_branch: "main",
    is_archived: 0,
    is_fork: 0,
    github_updated_at: null,
    last_synced_at: lastSyncedAt,
    deleted_at: null,
  };
}

describe("repository sync cutoff", () => {
  it("starts an initial sync at 2026-05-01 Tokyo time", () => {
    expect(initialSince(repository(null))).toBe("2026-04-30T15:00:00.000Z");
  });

  it("clamps the overlap window but retains later incremental syncs", () => {
    expect(initialSince(repository("2026-05-01T12:00:00.000Z"))).toBe(
      "2026-04-30T15:00:00.000Z",
    );
    expect(initialSince(repository("2026-08-26T00:00:00.000Z"))).toBe(
      "2026-08-24T00:00:00.000Z",
    );
  });
});

function commitFixture(options: {
  parents: number;
  committedAt: string;
}): GitHubCommit {
  return {
    sha: "abc123",
    html_url: "https://github.com/onishi/changes/commit/abc123",
    commit: {
      message: "Add period navigation",
      author: { date: options.committedAt },
      committer: { date: options.committedAt },
    },
    author: { id: 14186, login: "onishi" },
    parents: Array.from({ length: options.parents }, (_, index) => ({
      sha: `parent${String(index)}`,
    })),
  };
}

describe("which commits are stored", () => {
  it("keeps commits regardless of who wrote them", () => {
    const byCoMaintainer = commitFixture({
      parents: 1,
      committedAt: "2026-08-20T01:00:00.000Z",
    });
    expect(
      isStorableCommit({
        ...byCoMaintainer,
        author: { id: 99999, login: "someone-else" },
      }),
    ).toBe(true);
    expect(isStorableCommit({ ...byCoMaintainer, author: null })).toBe(true);
  });

  it("drops merge commits", () => {
    expect(
      isStorableCommit(
        commitFixture({ parents: 2, committedAt: "2026-08-20T01:00:00.000Z" }),
      ),
    ).toBe(false);
    expect(
      isStorableCommit(
        commitFixture({ parents: 1, committedAt: "2026-08-20T01:00:00.000Z" }),
      ),
    ).toBe(true);
  });

  it("still drops commits from before the data cutoff", () => {
    expect(
      isStorableCommit(
        commitFixture({ parents: 1, committedAt: "2026-04-30T01:00:00.000Z" }),
      ),
    ).toBe(false);
  });

  it("rejects a merge commit at the database level", async () => {
    await env.DB.prepare(
      `INSERT INTO repositories (
         id, owner_login, name, full_name, visibility, html_url, default_branch,
         is_archived, is_fork, github_updated_at, created_at, updated_at
       ) VALUES ('repo_merge', 'onishi', 'changes', 'onishi/changes', 'public',
                 'https://github.com/onishi/changes', 'main', 0, 0, ?, ?, ?)`,
    )
      .bind(NOW, NOW, NOW)
      .run();

    const insertMerge = (isMerge: number): Promise<unknown> =>
      env.DB.prepare(
        `INSERT INTO commits (
           repository_id, oid, message_headline, message_body, committed_at,
           html_url, is_merge, created_at, updated_at
         ) VALUES ('repo_merge', ?, 'Merge pull request #1', NULL, ?,
                   'https://github.com/onishi/changes/commit/m', ?, ?, ?)`,
      )
        .bind(`oid${String(isMerge)}`, NOW, isMerge, NOW, NOW)
        .run();

    await expect(insertMerge(1)).rejects.toThrow();
    await expect(insertMerge(0)).resolves.toBeDefined();
  });
});
