import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { checkHealth } from "../worker/monitor-health";

function testEnv(): Env {
  return { DB: env.DB } as Env;
}

describe("monitor health", () => {
  it("downgrades a long-running batch check", async () => {
    const now = Date.now();
    const succeededStartedAt = new Date(now - 3 * 60 * 60 * 1000).toISOString();
    const succeededCompletedAt = new Date(
      now - 2.5 * 60 * 60 * 1000,
    ).toISOString();
    const runningStartedAt = new Date(now - 60 * 60 * 1000).toISOString();

    await env.DB.prepare(
      `INSERT INTO sync_runs (
         id, job_type, status, repositories_seen, commits_seen, started_at, completed_at, error_message
       ) VALUES ('run_1', 'sync-owner', 'succeeded', 1, 1, ?, ?, NULL)`,
    )
      .bind(succeededStartedAt, succeededCompletedAt)
      .run();
    await env.DB.prepare(
      `INSERT INTO sync_runs (
         id, job_type, status, repositories_seen, commits_seen, started_at, completed_at, error_message
       ) VALUES ('run_2', 'sync-owner', 'running', 0, 0, ?, NULL, NULL)`,
    )
      .bind(runningStartedAt)
      .run();
    await env.DB.prepare(
      `INSERT INTO sync_runs (
         id, job_type, status, repositories_seen, commits_seen, started_at, completed_at, error_message
       ) VALUES ('run_3', 'generate-summary', 'succeeded', 0, 0, ?, ?, NULL)`,
    )
      .bind(new Date(now - 5 * 60 * 1000).toISOString(), new Date(now).toISOString())
      .run();

    const response = await checkHealth(testEnv());
    const body = (await response.json()) as {
      status: string;
      checks: Array<{ id: string; status: string; message: string }>;
    };

    const batch = body.checks.find((check) => check.id === "sync-batch");
    expect(batch).toMatchObject({
      status: "warning",
      message: expect.stringContaining("30分以上経過"),
    });
    expect(body.status).toBe("warning");
  });
});
