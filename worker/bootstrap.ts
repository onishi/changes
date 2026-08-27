import type { SessionRow } from "./domain";
import {
  getLatestDailyRecords,
  getPeriodRecords,
  listRepositories,
} from "./api";
import { parseRoute } from "../src/routes";
import type { BootstrapData, RouteState } from "../src/types";

function requestPath(request: Request): string {
  const url = new URL(request.url);
  return `${url.pathname}${url.search}`;
}

export function serializeBootstrap(data: BootstrapData): string {
  return JSON.stringify(data)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function emptyBootstrap(request: Request): BootstrapData {
  return {
    path: requestPath(request),
    periodData: null,
    latestDailyData: null,
    repositories: [],
    session: null,
    error: null,
  };
}

async function loadBootstrapData(
  request: Request,
  env: Env,
  route: RouteState,
  session: SessionRow | null,
): Promise<BootstrapData> {
  const bootstrap = emptyBootstrap(request);
  bootstrap.session = session
    ? {
        authenticated: true,
        user: {
          id: session.github_user_id,
          login: session.github_login,
        },
      }
    : null;
  try {
    if (route.isOverview) {
      bootstrap.latestDailyData = await getLatestDailyRecords({
        env,
        scope: "public",
        limit: 5,
      });
      return bootstrap;
    }

    const [periodData, repositories] = await Promise.all([
      getPeriodRecords({
        env,
        scope: route.scope,
        periodType: route.period,
        periodKey: route.key,
        repositoryName: route.repository ?? undefined,
        cursor: route.cursor,
      }),
      listRepositories(env.DB, route.scope),
    ]);
    bootstrap.periodData = periodData;
    bootstrap.repositories = repositories;
  } catch (error) {
    bootstrap.error =
      error instanceof Error ? error.message : "読み込みに失敗しました。";
  }
  return bootstrap;
}

function injectBootstrap(
  response: Response,
  bootstrap: BootstrapData,
): Response {
  const script = `<script>window.__CHANGES_BOOTSTRAP__=${serializeBootstrap(bootstrap)};</script>`;
  return new HTMLRewriter()
    .on("head", {
      element(element) {
        element.append(script, { html: true });
      },
    })
    .transform(response);
}

export async function serveBootstrappedShell(options: {
  request: Request;
  env: Env;
  session?: SessionRow | null;
}): Promise<Response> {
  const url = new URL(options.request.url);
  let canonicalPath: string | null = null;
  const route = parseRoute(
    { pathname: url.pathname, search: url.search },
    (path) => {
      canonicalPath = path;
    },
  );
  if (canonicalPath) {
    return Response.redirect(
      new URL(canonicalPath, url.origin).toString(),
      302,
    );
  }

  const [assetResponse, bootstrap] = await Promise.all([
    options.env.ASSETS.fetch(options.request),
    loadBootstrapData(
      options.request,
      options.env,
      route,
      options.session ?? null,
    ),
  ]);
  const headers = new Headers(assetResponse.headers);
  headers.delete("Content-Length");
  headers.delete("ETag");
  if (route.scope === "all") {
    headers.set("Cache-Control", "private, no-store");
    headers.set("X-Robots-Tag", "noindex, nofollow");
  } else {
    headers.set("Cache-Control", "public, max-age=60, s-maxage=300");
  }
  return injectBootstrap(
    new Response(assetResponse.body, {
      status: assetResponse.status,
      statusText: assetResponse.statusText,
      headers,
    }),
    bootstrap,
  );
}
