import { z } from "zod";
import { assertGitHubConfig } from "./config";
import { bytesToBase64Url, stringToBase64Url } from "./lib/crypto";

const repositorySchema = z.object({
  node_id: z.string().min(1),
  name: z.string().min(1),
  full_name: z.string().min(1),
  visibility: z.enum(["public", "private", "internal"]),
  html_url: z.url(),
  default_branch: z.string().min(1),
  archived: z.boolean(),
  fork: z.boolean(),
  updated_at: z.string().nullable(),
  owner: z.object({ login: z.string().min(1) }),
});

const repositoryListSchema = z.object({
  repositories: z.array(repositorySchema),
});

const commitSchema = z.object({
  sha: z.string().min(1),
  html_url: z.url(),
  commit: z.object({
    message: z.string(),
    author: z.object({ date: z.iso.datetime() }).nullable(),
    committer: z.object({ date: z.iso.datetime() }).nullable(),
  }),
  author: z
    .object({
      id: z.number().int().nonnegative(),
      login: z.string().min(1),
    })
    .nullable(),
  parents: z.array(z.object({ sha: z.string() })),
});

const commitListSchema = z.array(commitSchema);
const installationTokenSchema = z.object({ token: z.string().min(1) });

export type GitHubRepository = z.infer<typeof repositorySchema>;
export type GitHubCommit = z.infer<typeof commitSchema>;

export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    private readonly retryableOverride = false,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }

  get retryable(): boolean {
    return this.retryableOverride || this.status === 429 || this.status >= 500;
  }
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const normalized = pem.replaceAll("\\n", "\n");
  const base64 = normalized
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replaceAll(/\s/gu, "");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
}

async function createAppJwt(env: Env): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000) - 60;
  const header = stringToBase64Url(
    JSON.stringify({ alg: "RS256", typ: "JWT" }),
  );
  const payload = stringToBase64Url(
    JSON.stringify({
      iat: issuedAt,
      exp: issuedAt + 9 * 60,
      iss: env.GITHUB_APP_ID,
    }),
  );
  const unsigned = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(env.GITHUB_APP_PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

async function githubRequest(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<Response> {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "changes.wagaya.org",
      "X-GitHub-Api-Version": "2026-03-10",
      ...init.headers,
    },
  });

  if (!response.ok) {
    const rateLimited =
      response.status === 403 &&
      (response.headers.get("X-RateLimit-Remaining") === "0" ||
        response.headers.has("Retry-After"));
    throw new GitHubApiError(
      `GitHub API request failed with ${String(response.status)}`,
      response.status,
      rateLimited,
    );
  }

  return response;
}

export async function getInstallationToken(env: Env): Promise<string> {
  assertGitHubConfig(env);
  const jwt = await createAppJwt(env);
  const response = await githubRequest(
    `/app/installations/${encodeURIComponent(env.GITHUB_INSTALLATION_ID)}/access_tokens`,
    jwt,
    { method: "POST" },
  );
  const parsed = installationTokenSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("GitHub installation token response was invalid.");
  }
  return parsed.data.token;
}

export async function listInstalledRepositories(
  env: Env,
): Promise<GitHubRepository[]> {
  const token = await getInstallationToken(env);
  const repositories: GitHubRepository[] = [];

  for (let page = 1; ; page += 1) {
    const response = await githubRequest(
      `/installation/repositories?per_page=100&page=${String(page)}`,
      token,
    );
    const parsed = repositoryListSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error("GitHub repository response was invalid.");
    }

    repositories.push(
      ...parsed.data.repositories.filter(
        (repository) =>
          repository.owner.login.toLowerCase() ===
          env.GITHUB_OWNER.toLowerCase(),
      ),
    );

    if (!response.headers.get("Link")?.includes('rel="next"')) {
      break;
    }
  }

  return repositories;
}

export async function listRepositoryCommitsPage(
  env: Env,
  repository: { name: string; defaultBranch: string },
  since: string,
  page: number,
): Promise<{ commits: GitHubCommit[]; hasNextPage: boolean }> {
  const token = await getInstallationToken(env);
  const query = new URLSearchParams({
    sha: repository.defaultBranch,
    author: env.GITHUB_OWNER,
    since,
    per_page: "100",
    page: String(page),
  });
  const response = await githubRequest(
    `/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(repository.name)}/commits?${query.toString()}`,
    token,
  );
  const parsed = commitListSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("GitHub commit response was invalid.");
  }

  return {
    commits: parsed.data,
    hasNextPage: response.headers.get("Link")?.includes('rel="next"') ?? false,
  };
}

export function splitCommitMessage(message: string): {
  headline: string;
  body: string | null;
} {
  const [headline = "", ...bodyParts] = message.split("\n");
  const body = bodyParts.join("\n").trim();
  return { headline: headline.trim(), body: body.length > 0 ? body : null };
}
