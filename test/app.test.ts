import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { app } from "../worker/app";

function testEnv(): Env {
  return {
    DB: env.DB,
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
  } as Env;
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
});
