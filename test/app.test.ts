import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { BootstrapData, PeriodResponse } from "../src/types";
import { app } from "../worker/app";
import { serializeBootstrap } from "../worker/bootstrap";
import { hmacSha256 } from "../worker/lib/crypto";

const shell = `<!doctype html><html><head><title>changes</title></head><body><div id="root"></div><script type="module" src="/assets/index.js"></script></body></html>`;

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
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Content-Security-Policy":
                "default-src 'self'; script-src 'self'",
            },
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

async function insertPublicRepository(): Promise<void> {
  const now = "2026-08-20T12:00:00.000Z";
  await env.DB.prepare(
    `INSERT INTO repositories (
       id, owner_login, name, full_name, visibility, html_url, default_branch,
       is_archived, is_fork, github_updated_at, last_synced_at, deleted_at,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'public', ?, 'main', 0, 0, ?, NULL, NULL, ?, ?)`,
  )
    .bind(
      "repo_public",
      "onishi",
      "kinki-zoo",
      "onishi/kinki-zoo",
      "https://github.com/onishi/kinki-zoo",
      now,
      now,
      now,
    )
    .run();
}

async function insertRepository(options: {
  id: string;
  name: string;
  githubUpdatedAt: string;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO repositories (
       id, owner_login, name, full_name, visibility, html_url, default_branch,
       is_archived, is_fork, github_updated_at, last_synced_at, deleted_at,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'public', ?, 'main', 0, 0, ?, NULL, NULL, ?, ?)`,
  )
    .bind(
      options.id,
      "onishi",
      options.name,
      `onishi/${options.name}`,
      `https://github.com/onishi/${options.name}`,
      options.githubUpdatedAt,
      options.githubUpdatedAt,
      options.githubUpdatedAt,
    )
    .run();
}

async function authenticatedHeaders(): Promise<HeadersInit> {
  const token = "test-session-token";
  const now = "2026-08-20T12:00:00.000Z";
  await env.DB.prepare(
    `INSERT INTO sessions (
       token_hash, github_user_id, github_login, created_at, last_seen_at, expires_at
     ) VALUES (?, '14186', 'onishi', ?, ?, '2999-01-01T00:00:00.000Z')`,
  )
    .bind(await hmacSha256(testEnv().SESSION_SECRET, token), now, now)
    .run();
  return { Cookie: `changes_session=${token}` };
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
    const periodBody: PeriodResponse = await period.json();
    expect(
      periodBody.records.every((record) => record.commits.length === 0),
    ).toBe(true);

    const missingCommits = await app.request(
      "/api/public/records/missing/commits",
      {},
      testEnv(),
    );
    expect(missingCommits.status).toBe(404);

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

  it("serves the authenticated all overview and latest-daily API", async () => {
    const headers = await authenticatedHeaders();
    const response = await app.request("/all/", { headers }, testEnv());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const bootstrap = extractBootstrap(await response.text());
    expect(bootstrap.path).toBe("/all/");
    expect(bootstrap.latestDailyData).toEqual({ records: [] });
    expect(bootstrap.periodData).toBeNull();

    const apiResponse = await app.request(
      "/api/all/latest-daily",
      { headers },
      testEnv(),
    );
    expect(apiResponse.status).toBe(200);
    expect(apiResponse.headers.get("Cache-Control")).toBe("private, no-store");
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

  it("embeds repository overview data and exposes its latest-daily API", async () => {
    await insertPublicRepository();

    const response = await app.request("/repo/kinki-zoo/", {}, testEnv());
    expect(response.status).toBe(200);
    const bootstrap = extractBootstrap(await response.text());
    expect(bootstrap.path).toBe("/repo/kinki-zoo/");
    expect(bootstrap.latestDailyData).toEqual({ records: [] });
    expect(bootstrap.periodData).toBeNull();
    expect(bootstrap.error).toBeNull();

    const apiResponse = await app.request(
      "/api/public/repositories/kinki-zoo/latest-daily",
      {},
      testEnv(),
    );
    expect(apiResponse.status).toBe(200);
    await expect(apiResponse.json()).resolves.toEqual({ records: [] });
  });

  it("embeds a repository index listing and exposes its API", async () => {
    await insertPublicRepository();

    const response = await app.request("/repo/", {}, testEnv());
    expect(response.status).toBe(200);
    const bootstrap = extractBootstrap(await response.text());
    expect(bootstrap.path).toBe("/repo/");
    expect(bootstrap.repositoriesData?.repositories).toHaveLength(1);
    expect(bootstrap.repositoriesData?.repositories[0]?.name).toBe("kinki-zoo");
    expect(bootstrap.latestDailyData).toBeNull();
    expect(bootstrap.periodData).toBeNull();
    expect(bootstrap.error).toBeNull();

    const apiResponse = await app.request(
      "/api/public/repositories",
      {},
      testEnv(),
    );
    expect(apiResponse.status).toBe(200);
    const body: { repositories: { name: string }[] } = await apiResponse.json();
    expect(body.repositories).toHaveLength(1);
    expect(body.repositories[0]?.name).toBe("kinki-zoo");
  });

  it("sorts repositories by recency and drops those before the data cutoff", async () => {
    await insertPublicRepository();
    await insertRepository({
      id: "repo_recent",
      name: "aurora",
      githubUpdatedAt: "2026-08-25T00:00:00.000Z",
    });
    await insertRepository({
      id: "repo_stale",
      name: "old-project",
      githubUpdatedAt: "2026-01-01T00:00:00.000Z",
    });

    const apiResponse = await app.request(
      "/api/public/repositories",
      {},
      testEnv(),
    );
    const body: { repositories: { name: string }[] } = await apiResponse.json();
    expect(body.repositories.map((repository) => repository.name)).toEqual([
      "aurora",
      "kinki-zoo",
    ]);
  });

  it("requires authentication for the private repository index", async () => {
    const response = await app.request("/all/repo/", {}, testEnv());
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toContain("/api/auth/login");

    const apiResponse = await app.request(
      "/api/all/repositories",
      {},
      testEnv(),
    );
    expect(apiResponse.status).toBe(401);
  });

  it("returns not found for an unknown repository overview API", async () => {
    const response = await app.request(
      "/api/public/repositories/missing/latest-daily",
      {},
      testEnv(),
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Repository not found.",
    });
  });

  it("embeds period data and canonicalizes old page routes", async () => {
    const response = await app.request("/daily/2026-08-20", {}, testEnv());
    const bootstrap = extractBootstrap(await response.text());
    expect(bootstrap.periodData?.period.key).toBe("2026-08-20");

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

  it("sets a nonce-based CSP that authorizes the inline bootstrap script", async () => {
    const response = await app.request("/", {}, testEnv());
    const policy = response.headers.get("Content-Security-Policy") ?? "";
    const nonce = /script-src 'self' 'nonce-([\w-]+)'/u.exec(policy)?.[1];
    expect(nonce).toBeTruthy();

    const html = await response.text();
    expect(html).toContain(`<script nonce="${nonce}">`);
    // Both the bundle tag already in the shell and the injected bootstrap
    // script must carry the nonce, or the page will not run under the policy.
    expect(html.split(`nonce="${nonce}"`).length - 1).toBe(2);
    expect(html).toContain('src="/assets/index.js"');

    // The nonce-less policy from public/_headers must not survive next to it;
    // browsers enforce every Content-Security-Policy header they receive.
    expect(policy).not.toContain(",");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("style-src 'self'");
    expect(policy).toContain("font-src 'self'");
    // Nothing the app loads is cross-origin now that the fonts are self-hosted.
    expect(policy).not.toContain("https://");

    const api = await app.request("/api/health", {}, testEnv());
    expect(api.headers.get("Content-Security-Policy")).toContain(
      "default-src 'self'",
    );
  });

  it("issues a different nonce for every request", async () => {
    const readNonce = (response: Response): string | undefined =>
      /'nonce-([\w-]+)'/u.exec(
        response.headers.get("Content-Security-Policy") ?? "",
      )?.[1];
    const first = readNonce(await app.request("/", {}, testEnv()));
    const second = readNonce(await app.request("/", {}, testEnv()));
    expect(first).toBeTruthy();
    expect(first).not.toBe(second);
  });

  it("escapes script-closing content in bootstrap JSON", () => {
    const encoded = serializeBootstrap({
      path: "</script>",
      periodData: null,
      latestDailyData: null,
      repositoriesData: null,
      session: null,
      error: "line\u2028separator",
    });
    expect(encoded).not.toContain("</script>");
    expect(encoded).toContain("\\u003c/script>");
    expect(encoded).toContain("\\u2028");
  });
});
