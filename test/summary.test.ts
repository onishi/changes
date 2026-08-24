import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import type { RepositoryRow } from "../worker/domain";
import { rebuildAffectedRecords } from "../worker/records";
import { generateSummary } from "../worker/summary";

describe("Workers AI summaries", () => {
  it("stores a structured JSON Mode response for a change record", async () => {
    const now = "2026-08-20T01:00:00.000Z";
    const repository: RepositoryRow = {
      id: "repo_summary",
      owner_login: "onishi",
      name: "changes",
      full_name: "onishi/changes",
      visibility: "public",
      html_url: "https://github.com/onishi/changes",
      default_branch: "main",
      is_archived: 0,
      is_fork: 0,
      github_updated_at: now,
      last_synced_at: null,
      deleted_at: null,
    };
    await env.DB.prepare(
      `INSERT INTO repositories (
         id, owner_login, name, full_name, visibility, html_url, default_branch,
         is_archived, is_fork, github_updated_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
    )
      .bind(
        repository.id,
        repository.owner_login,
        repository.name,
        repository.full_name,
        repository.visibility,
        repository.html_url,
        repository.default_branch,
        now,
        now,
        now,
      )
      .run();
    await env.DB.prepare(
      `INSERT INTO commits (
         repository_id, oid, message_headline, committed_at, author_login,
         html_url, is_merge, created_at, updated_at
       ) VALUES (?, 'abc123', 'Add period navigation', ?, 'onishi', ?, 0, ?, ?)`,
    )
      .bind(
        repository.id,
        now,
        `${repository.html_url}/commit/abc123`,
        now,
        now,
      )
      .run();

    const pendingIds = await rebuildAffectedRecords(
      { DB: env.DB } as Env,
      repository,
      [now],
    );
    const changeRecordId = pendingIds.find((id) =>
      id.startsWith("public:daily:"),
    );
    expect(changeRecordId).toBeDefined();

    const run = vi.fn(() =>
      Promise.resolve({
        response: { summary: "期間ナビゲーションを追加しました。" },
      }),
    );
    await generateSummary(
      {
        DB: env.DB,
        AI: { run } as unknown as Ai,
      } as Env,
      changeRecordId ?? "",
    );

    expect(run).toHaveBeenCalledOnce();
    const row = await env.DB.prepare(
      "SELECT summary_text, summary_status, summary_model FROM change_records WHERE id = ?",
    )
      .bind(changeRecordId)
      .first<{
        summary_text: string;
        summary_status: string;
        summary_model: string;
      }>();
    expect(row).toEqual({
      summary_text: "期間ナビゲーションを追加しました。",
      summary_status: "ready",
      summary_model: "@cf/meta/llama-3.1-8b-instruct-fast",
    });
  });
});
