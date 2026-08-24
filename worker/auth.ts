import { z } from "zod";
import { assertAuthConfig } from "./config";
import type { SessionRow } from "./domain";
import { hmacSha256, randomToken, timingSafeEqual } from "./lib/crypto";

const SESSION_COOKIE = "changes_session";
const STATE_COOKIE = "changes_oauth_state";
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const STATE_SECONDS = 10 * 60;

const tokenResponseSchema = z.object({ access_token: z.string().min(1) });
const userResponseSchema = z.object({
  id: z.number().int().nonnegative(),
  login: z.string().min(1),
});

function cookieValue(request: Request, name: string): string | null {
  const cookie = request.headers.get("Cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

function serializeCookie(
  name: string,
  value: string,
  options: { maxAge: number; path: string },
): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    `Max-Age=${String(options.maxAge)}`,
    `Path=${options.path}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith("/all") || value.startsWith("//")) {
    return "/all";
  }
  return value;
}

export async function beginGitHubLogin(
  request: Request,
  env: Env,
): Promise<Response> {
  assertAuthConfig(env);
  const url = new URL(request.url);
  const state = randomToken();
  const stateHash = await hmacSha256(env.SESSION_SECRET, state);
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + STATE_SECONDS * 1000,
  ).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM oauth_states WHERE expires_at <= ?").bind(
      now.toISOString(),
    ),
    env.DB.prepare(
      `INSERT INTO oauth_states (state_hash, return_to, created_at, expires_at)
         VALUES (?, ?, ?, ?)`,
    ).bind(
      stateHash,
      safeReturnTo(url.searchParams.get("returnTo")),
      now.toISOString(),
      expiresAt,
    ),
  ]);

  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  authorize.searchParams.set(
    "redirect_uri",
    `${env.APP_ORIGIN}/api/auth/callback`,
  );
  authorize.searchParams.set("state", state);

  return new Response(null, {
    status: 302,
    headers: {
      Location: authorize.toString(),
      "Set-Cookie": serializeCookie(STATE_COOKIE, state, {
        maxAge: STATE_SECONDS,
        path: "/api/auth",
      }),
      "Cache-Control": "no-store",
    },
  });
}

export async function completeGitHubLogin(
  request: Request,
  env: Env,
): Promise<Response> {
  assertAuthConfig(env);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = cookieValue(request, STATE_COOKIE);
  if (
    !code ||
    !state ||
    !cookieState ||
    !(await timingSafeEqual(state, cookieState))
  ) {
    return new Response("Invalid OAuth state", { status: 400 });
  }

  const stateHash = await hmacSha256(env.SESSION_SECRET, state);
  const stateRow = await env.DB.prepare(
    `DELETE FROM oauth_states
       WHERE state_hash = ? AND expires_at > ?
       RETURNING return_to`,
  )
    .bind(stateHash, new Date().toISOString())
    .first<{ return_to: string }>();
  if (!stateRow) {
    return new Response("OAuth state expired", { status: 400 });
  }

  const tokenResponse = await fetch(
    "https://github.com/login/oauth/access_token",
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${env.APP_ORIGIN}/api/auth/callback`,
      }),
    },
  );
  const token = tokenResponseSchema.safeParse(await tokenResponse.json());
  if (!tokenResponse.ok || !token.success) {
    return new Response("GitHub token exchange failed", { status: 502 });
  }

  const userResponse = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token.data.access_token}`,
      "User-Agent": "changes.wayaga.org",
      "X-GitHub-Api-Version": "2026-03-10",
    },
  });
  const user = userResponseSchema.safeParse(await userResponse.json());
  if (!userResponse.ok || !user.success) {
    return new Response("GitHub user lookup failed", { status: 502 });
  }

  if (
    !(await timingSafeEqual(String(user.data.id), env.ALLOWED_GITHUB_USER_ID))
  ) {
    return new Response("This GitHub account is not allowed", { status: 403 });
  }

  const sessionToken = randomToken();
  const sessionHash = await hmacSha256(env.SESSION_SECRET, sessionToken);
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + SESSION_SECONDS * 1000,
  ).toISOString();
  await env.DB.prepare(
    `INSERT INTO sessions (
         token_hash, github_user_id, github_login, created_at, last_seen_at, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      sessionHash,
      String(user.data.id),
      user.data.login,
      now.toISOString(),
      now.toISOString(),
      expiresAt,
    )
    .run();

  return new Response(null, {
    status: 302,
    headers: {
      Location: stateRow.return_to,
      "Set-Cookie": serializeCookie(SESSION_COOKIE, sessionToken, {
        maxAge: SESSION_SECONDS,
        path: "/",
      }),
      "Cache-Control": "no-store",
    },
  });
}

export async function getSession(
  request: Request,
  env: Env,
): Promise<SessionRow | null> {
  assertAuthConfig(env);
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await hmacSha256(env.SESSION_SECRET, token);
  return env.DB.prepare(
    `SELECT github_user_id, github_login, expires_at
       FROM sessions WHERE token_hash = ? AND expires_at > ?`,
  )
    .bind(tokenHash, new Date().toISOString())
    .first<SessionRow>();
}

export async function logout(request: Request, env: Env): Promise<Response> {
  assertAuthConfig(env);
  const token = cookieValue(request, SESSION_COOKIE);
  if (token) {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(await hmacSha256(env.SESSION_SECRET, token))
      .run();
  }
  return new Response(null, {
    status: 204,
    headers: {
      "Set-Cookie": serializeCookie(SESSION_COOKIE, "", {
        maxAge: 0,
        path: "/",
      }),
      "Cache-Control": "no-store",
    },
  });
}

export function isSameOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get("Origin");
  return origin === null || origin === env.APP_ORIGIN;
}
