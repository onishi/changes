import { z } from "zod";

const githubConfigSchema = z.object({
  GITHUB_OWNER: z.string().regex(/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/iu),
  GITHUB_APP_ID: z.string().regex(/^\d+$/u),
  GITHUB_INSTALLATION_ID: z.string().regex(/^\d+$/u),
  GITHUB_APP_PRIVATE_KEY: z.string().includes("-----BEGIN PRIVATE KEY-----"),
});

const authConfigSchema = z.object({
  APP_ORIGIN: z.url(),
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(20),
  ALLOWED_GITHUB_USER_ID: z.string().regex(/^\d+$/u),
  SESSION_SECRET: z.string().min(32),
});

function formatConfigError(name: string, error: z.ZodError): Error {
  const fields = [
    ...new Set(error.issues.map((issue) => issue.path.join("."))),
  ].join(", ");
  return new Error(`Invalid ${name} configuration: ${fields}`);
}

export function assertGitHubConfig(env: Env): void {
  const parsed = githubConfigSchema.safeParse(env);
  if (!parsed.success) throw formatConfigError("GitHub App", parsed.error);
}

export function assertAuthConfig(env: Env): void {
  const parsed = authConfigSchema.safeParse(env);
  if (!parsed.success) throw formatConfigError("authentication", parsed.error);
}
