import { Hono, type Context } from "hono";
import {
  beginGitHubLogin,
  completeGitHubLogin,
  getSession,
  isSameOrigin,
  logout,
} from "./auth";
import { getPeriodRecords, listRepositories } from "./api";
import type { QueueMessage, Scope, SessionRow } from "./domain";
import { isPeriodType } from "./records";

type AppBindings = {
  Bindings: Env;
  Variables: { session: SessionRow };
};

export const app = new Hono<AppBindings>();

app.use("*", async (context, next) => {
  await next();
  context.header("X-Content-Type-Options", "nosniff");
  context.header("Referrer-Policy", "strict-origin-when-cross-origin");
  context.header(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
});

app.get("/api/health", (context) => context.json({ status: "ok" }));
app.get("/api/auth/login", (context) =>
  beginGitHubLogin(context.req.raw, context.env),
);
app.get("/api/auth/callback", (context) =>
  completeGitHubLogin(context.req.raw, context.env),
);
app.post("/api/auth/logout", async (context) => {
  if (!isSameOrigin(context.req.raw, context.env)) {
    return context.json({ error: "Invalid origin" }, 403);
  }
  return logout(context.req.raw, context.env);
});
app.get("/api/auth/session", async (context) => {
  const session = await getSession(context.req.raw, context.env);
  context.header("Cache-Control", "private, no-store");
  return context.json({
    authenticated: Boolean(session),
    user: session
      ? { id: session.github_user_id, login: session.github_login }
      : null,
  });
});

app.use("/api/all/*", async (context, next) => {
  context.header("Cache-Control", "private, no-store");
  context.header("X-Robots-Tag", "noindex, nofollow");
  const session = await getSession(context.req.raw, context.env);
  if (!session) {
    return context.json({ error: "Authentication required" }, 401);
  }
  context.set("session", session);
  await next();
});

async function periodResponse(
  context: Context<AppBindings>,
  scope: Scope,
  repositoryName?: string,
) {
  const period = context.req.param("period");
  const date = context.req.param("date");
  if (!period || !date || !isPeriodType(period)) {
    return context.json({ error: "Invalid period route" }, 400);
  }
  try {
    const result = await getPeriodRecords({
      env: context.env,
      scope,
      periodType: period,
      periodKey: date,
      repositoryName,
      cursor: context.req.query("cursor"),
    });
    context.header(
      "Cache-Control",
      scope === "public"
        ? "public, max-age=60, s-maxage=300"
        : "private, no-store",
    );
    return context.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request";
    const status = message === "Repository not found." ? 404 : 400;
    return context.json({ error: message }, status);
  }
}

app.get("/api/public/repositories", async (context) => {
  context.header("Cache-Control", "public, max-age=60, s-maxage=300");
  return context.json({
    repositories: await listRepositories(context.env.DB, "public"),
  });
});
app.get("/api/all/repositories", async (context) =>
  context.json({ repositories: await listRepositories(context.env.DB, "all") }),
);
app.get("/api/public/periods/:period/:date", (context) =>
  periodResponse(context, "public"),
);
app.get("/api/all/periods/:period/:date", (context) =>
  periodResponse(context, "all"),
);
app.get("/api/public/repositories/:repo/periods/:period/:date", (context) =>
  periodResponse(context, "public", context.req.param("repo")),
);
app.get("/api/all/repositories/:repo/periods/:period/:date", (context) =>
  periodResponse(context, "all", context.req.param("repo")),
);

app.post("/api/all/sync", async (context) => {
  if (!isSameOrigin(context.req.raw, context.env)) {
    return context.json({ error: "Invalid origin" }, 403);
  }
  await context.env.JOBS.send(
    {
      type: "sync-owner",
      requestedAt: new Date().toISOString(),
    } satisfies QueueMessage,
    { contentType: "json" },
  );
  return context.json({ status: "queued" }, 202);
});

async function servePrivateShell(
  request: Request,
  env: Env,
): Promise<Response> {
  const session = await getSession(request, env);
  if (!session) {
    const login = new URL("/api/auth/login", env.APP_ORIGIN);
    login.searchParams.set("returnTo", new URL(request.url).pathname);
    return Response.redirect(login.toString(), 302);
  }
  const response = await env.ASSETS.fetch(request);
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

app.get("/all", (context) => servePrivateShell(context.req.raw, context.env));
app.get("/all/*", (context) => servePrivateShell(context.req.raw, context.env));

app.all("/api/*", (context) => context.json({ error: "Not found" }, 404));
app.all("*", (context) => context.env.ASSETS.fetch(context.req.raw));
