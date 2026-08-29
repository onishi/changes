import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import type { RepositoryRow } from "../worker/domain";
import { rebuildAffectedRecords } from "../worker/records";
import {
  enqueueStaleSummaryRefreshes,
  generateSummary,
  SUMMARY_PROMPT_VERSION,
} from "../worker/summary";

const TEST_NOW = "2026-08-20T01:00:00.000Z";
const VALID_SUMMARY =
  "日・週・月の期間ナビゲーションを追加し、選択中の期間がURLへ反映されるようにした。前後期間への移動と再読み込み後の状態維持にも対応し、変更履歴を期間単位で追いやすくした。直接URLを開いた場合も同じ期間を復元でき、共有時の表示ずれを防ぐ構成。";

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
       repository_id, oid, message_headline, message_body, committed_at, author_login,
       html_url, is_merge, created_at, updated_at
     ) VALUES (?, 'abc123', 'Add period navigation', ?, ?, 'onishi', ?, 0, ?, ?)`,
  )
    .bind(
      repository.id,
      "選択した期間をURLへ反映し、前後期間への移動と再読み込み後の状態維持に対応した。",
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
        response: { summary: VALID_SUMMARY },
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
    const input = run.mock.calls[0]?.[1];
    if (!input || typeof input !== "object") {
      throw new Error("Expected an object AI input.");
    }
    const messages = (input as Record<string, unknown>).messages;
    if (!Array.isArray(messages)) {
      throw new Error("Expected AI input messages.");
    }
    const contents = messages.map((message: unknown) => {
      if (!message || typeof message !== "object") return "";
      const content = (message as Record<string, unknown>).content;
      return typeof content === "string" ? content : "";
    });
    expect(contents[0]).toContain("要約は100文字程度");
    expect(contents[1]).toContain(
      "body: 選択した期間をURLへ反映し、前後期間への移動と再読み込み後の状態維持に対応した。",
    );
    expect(contents[1]).toContain("repository: changes");
    expect(contents[1]).not.toContain("period:");
    expect(contents[1]).not.toContain("commits:");
    expect(input).toMatchObject({
      max_tokens: 1024,
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: {
          properties: { summary: { minLength: 40, maxLength: 300 } },
        },
      },
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
      summary_text: VALID_SUMMARY,
      summary_status: "ready",
      summary_model: "@cf/meta/llama-3.1-8b-instruct-fast",
    });
  });

  it.each([
    ["shorter than 40 characters", "あ".repeat(39)],
    ["longer than 300 characters", "あ".repeat(301)],
  ])("rejects summaries %s", async (_case, summary) => {
    const changeRecordId = await seedSummaryRecord();
    const run = vi.fn(() =>
      Promise.resolve({
        response: { summary },
      }),
    );

    await expect(
      generateSummary(
        {
          DB: env.DB,
          AI: { run },
        },
        changeRecordId,
      ),
    ).rejects.toThrow("expected schema");

    const row = await env.DB.prepare(
      "SELECT summary_status, prompt_version FROM change_records WHERE id = ?",
    )
      .bind(changeRecordId)
      .first<{ summary_status: string; prompt_version: string }>();
    expect(row).toEqual({
      summary_status: "failed",
      prompt_version: SUMMARY_PROMPT_VERSION,
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

  it("requeues a ready summary once when the prompt version changes", async () => {
    const changeRecordId = await seedSummaryRecord();
    await env.DB.prepare(
      `UPDATE change_records
       SET summary_text = ?, summary_status = 'ready',
           prompt_version = 'change-record-ja-v2'
       WHERE id = ?`,
    )
      .bind(VALID_SUMMARY, changeRecordId)
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
      enqueueStaleSummaryRefreshes({ DB: env.DB, JOBS: jobs }, TEST_NOW),
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
      enqueueStaleSummaryRefreshes({ DB: env.DB, JOBS: jobs }, TEST_NOW),
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
      enqueueStaleSummaryRefreshes({ DB: env.DB, JOBS: jobs }, TEST_NOW),
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
