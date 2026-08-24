import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import type { RepositoryRow } from "../worker/domain";
import { rebuildAffectedRecords } from "../worker/records";
import {
  enqueueStaleSummaryRetries,
  generateSummary,
  SUMMARY_PROMPT_VERSION,
} from "../worker/summary";

const TEST_NOW = "2026-08-20T01:00:00.000Z";

async function seedSummaryRecord(): Promise<string> {
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
    github_updated_at: TEST_NOW,
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
      TEST_NOW,
      TEST_NOW,
      TEST_NOW,
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
      TEST_NOW,
      `${repository.html_url}/commit/abc123`,
      TEST_NOW,
      TEST_NOW,
    )
    .run();

  const pendingIds = await rebuildAffectedRecords(
    { DB: env.DB } as Env,
    repository,
    [TEST_NOW],
  );
  const changeRecordId = pendingIds.find((id) =>
    id.startsWith("public:daily:"),
  );
  if (!changeRecordId) {
    throw new Error("Expected a daily summary record.");
  }
  return changeRecordId;
}

describe("Workers AI summaries", () => {
  it("stores a structured JSON Mode response for a change record", async () => {
    const changeRecordId = await seedSummaryRecord();

    const run = vi.fn((model: string, input: unknown) => {
      void model;
      void input;
      return Promise.resolve({
        response: { summary: "期間ナビゲーションを追加しました。" },
      });
    });
    await generateSummary(
      {
        DB: env.DB,
        AI: { run },
      },
      changeRecordId,
    );

    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]?.[0]).toBe("@cf/meta/llama-3.1-8b-instruct-fast");
    expect(run.mock.calls[0]?.[1]).toMatchObject({
      max_tokens: 1024,
      temperature: 0,
      response_format: { type: "json_schema" },
    });
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

  it("records malformed JSON against the current prompt version", async () => {
    const changeRecordId = await seedSummaryRecord();
    const run = vi.fn(() =>
      Promise.resolve({ response: '{"summary":"途中で切れた要約' }),
    );

    await expect(
      generateSummary(
        {
          DB: env.DB,
          AI: { run },
        },
        changeRecordId,
      ),
    ).rejects.toThrow("Unterminated string");

    const row = await env.DB.prepare(
      "SELECT summary_status, prompt_version, summary_error FROM change_records WHERE id = ?",
    )
      .bind(changeRecordId)
      .first<{
        summary_status: string;
        prompt_version: string;
        summary_error: string;
      }>();
    expect(row?.summary_status).toBe("failed");
    expect(row?.prompt_version).toBe(SUMMARY_PROMPT_VERSION);
    expect(row?.summary_error).toContain("Unterminated string");
  });

  it("requeues a failed summary once when the prompt version changes", async () => {
    const changeRecordId = await seedSummaryRecord();
    await env.DB.prepare(
      `UPDATE change_records
       SET summary_status = 'failed', prompt_version = 'change-record-ja-v1',
           summary_error = 'old failure'
       WHERE id = ?`,
    )
      .bind(changeRecordId)
      .run();
    const sendBatch = vi.fn(() =>
      Promise.resolve({
        metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
      }),
    );
    const jobs = {
      sendBatch,
    };

    await expect(
      enqueueStaleSummaryRetries({ DB: env.DB, JOBS: jobs }, TEST_NOW),
    ).resolves.toBe(1);
    expect(sendBatch).toHaveBeenCalledOnce();
    expect(sendBatch).toHaveBeenCalledWith([
      {
        body: {
          type: "generate-summary",
          changeRecordId,
          requestedAt: TEST_NOW,
        },
        contentType: "json",
      },
    ]);

    const row = await env.DB.prepare(
      "SELECT summary_status, prompt_version, summary_error FROM change_records WHERE id = ?",
    )
      .bind(changeRecordId)
      .first<{
        summary_status: string;
        prompt_version: string;
        summary_error: string | null;
      }>();
    expect(row).toEqual({
      summary_status: "pending",
      prompt_version: SUMMARY_PROMPT_VERSION,
      summary_error: null,
    });
    await expect(
      enqueueStaleSummaryRetries({ DB: env.DB, JOBS: jobs }, TEST_NOW),
    ).resolves.toBe(0);
    expect(sendBatch).toHaveBeenCalledOnce();
  });

  it("restores the failed state when retry enqueueing fails", async () => {
    const changeRecordId = await seedSummaryRecord();
    await env.DB.prepare(
      `UPDATE change_records
       SET summary_status = 'failed', prompt_version = 'change-record-ja-v1',
           summary_error = 'old failure'
       WHERE id = ?`,
    )
      .bind(changeRecordId)
      .run();
    const jobs = {
      sendBatch: vi.fn(() => Promise.reject(new Error("Queue unavailable"))),
    };

    await expect(
      enqueueStaleSummaryRetries({ DB: env.DB, JOBS: jobs }, TEST_NOW),
    ).rejects.toThrow("Queue unavailable");

    const row = await env.DB.prepare(
      "SELECT summary_status, prompt_version, summary_error FROM change_records WHERE id = ?",
    )
      .bind(changeRecordId)
      .first<{
        summary_status: string;
        prompt_version: string;
        summary_error: string;
      }>();
    expect(row).toEqual({
      summary_status: "failed",
      prompt_version: "change-record-ja-v1",
      summary_error: "old failure",
    });
  });
});
