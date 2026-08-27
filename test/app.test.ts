import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { BootstrapData } from "../src/types";
import { app } from "../worker/app";
import { serializeBootstrap } from "../worker/bootstrap";

const shell = `<!doctype html><html><head><title>changes</title></head><body><div id="root"></div></body></html>`;

function testEnv(): Env {
  return {
    DB: env.DB,
    JOBS: env.JOBS,
    AI: env.AI,
    APP_ORIGIN: "https://changes.wagaya.org",
    GITHUB_OWNER: "onishi",
    GITHUB_CLIENT_ID: "client-id",
    GITHUB_CLIENT_SECRET: "a-valid-client-secret-value",
    GITHUB_APP_ID: "123",
    GITHUB_INSTALLATION_ID: "456",
    GITHUB_APP_PRIVATE_KEY:
      "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----",
    ALLOWED_GITHUB_USER_ID: "14186",
    SESSION_SECRET: "a-session-secret-that-is-at-least-32-bytes-long",
    ASSETS: {
      fetch: () =>
        Promise.resolve(
          new Response(shell, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          }),
        ),
      connect: () => {
        throw new Error("Socket connections are not used in this test.");
      },
    },
  };
}

function extractBootstrap(html: string): BootstrapData {
  const prefix = "window.__CHANGES_BOOTSTRAP__=";
  const start = html.indexOf(prefix);
  const end = html.indexOf(";</script>", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return JSON.parse(html.slice(start + prefix.length, end)) as BootstrapData;
}

describe("HTTP access boundaries", () => {
  it("serves health and public period APIs without authentication", async () => {
    const health = await app.request("/api/health", {}, testEnv());
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ status: "ok" });

    const period = await app.request(
      "/api/public/periods/daily/2026-08-20",
      {},
      testEnv(),
    );
    expect(period.status).toBe(200);
    expect(period.headers.get("Cache-Control")).toContain("public");

    const latestDaily = await app.request(
      "/api/public/latest-daily",
      {},
      testEnv(),
    );
    expect(latestDaily.status).toBe(200);
    await expect(latestDaily.json()).resolves.toEqual({ records: [] });
  });

  it("rejects periods that end before the data cutoff", async () => {
    const daily = await app.request(
      "/api/public/periods/daily/2026-04-30",
      {},
      testEnv(),
    );
    expect(daily.status).toBe(400);

    const boundaryWeek = await app.request(
      "/api/public/periods/weekly/2026-04-26",
      {},
      testEnv(),
    );
    expect(boundaryWeek.status).toBe(200);
  });

  it("rejects unauthenticated all APIs and redirects all pages", async () => {
    const apiResponse = await app.request(
      "/api/all/repositories",
      {},
      testEnv(),
    );
    expect(apiResponse.status).toBe(401);
    expect(apiResponse.headers.get("Cache-Control")).toBe("private, no-store");

    const pageResponse = await app.request(
      "/all/daily/2026-08-20",
      {},
      testEnv(),
    );
    expect(pageResponse.status).toBe(302);
    expect(pageResponse.headers.get("Location")).toContain("/api/auth/login");
  });

  it("rejects a cross-origin sync request before queueing work", async () => {
    const response = await app.request(
      "/api/all/sync",
      { method: "POST", headers: { Origin: "https://attacker.example" } },
      testEnv(),
    );
    expect(response.status).toBe(401);
  });

  it("embeds overview data directly in the public HTML shell", async () => {
    const response = await app.request("/", {}, testEnv());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("public");

    const bootstrap = extractBootstrap(await response.text());
    expect(bootstrap.path).toBe("/");
    expect(bootstrap.latestDailyData).not.toBeNull();
    expect(bootstrap.periodData).toBeNull();
    expect(bootstrap.error).toBeNull();
  });

  it("embeds period data and canonicalizes old page routes", async () => {
    const response = await app.request("/daily/2026-08-20", {}, testEnv());
    const bootstrap = extractBootstrap(await response.text());
    expect(bootstrap.periodData?.period.key).toBe("2026-08-20");
    expect(bootstrap.repositories).toEqual([]);

    const oldRoute = await app.request(
      "https://changes.wagaya.org/daily/2026-04-30",
      {},
      testEnv(),
    );
    expect(oldRoute.status).toBe(302);
    expect(oldRoute.headers.get("Location")).toBe(
      "https://changes.wagaya.org/daily/2026-05-01",
    );
  });

  it("escapes script-closing content in bootstrap JSON", () => {
    const encoded = serializeBootstrap({
      path: "</script>",
      periodData: null,
      latestDailyData: null,
      repositories: [],
      session: null,
      error: "line\u2028separator",
    });
    expect(encoded).not.toContain("</script>");
    expect(encoded).toContain("\\u003c/script>");
    expect(encoded).toContain("\\u2028");
  });
});
