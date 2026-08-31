import type { SessionRow } from "./domain";
import { getLatestDailyRecords, getPeriodRecords } from "./api";
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
        scope: route.scope,
        repositoryName: route.repository ?? undefined,
        days: 5,
      });
      return bootstrap;
    }

    bootstrap.periodData = await getPeriodRecords({
      env,
      scope: route.scope,
      periodType: route.period,
      periodKey: route.key,
      repositoryName: route.repository ?? undefined,
      cursor: route.cursor,
      includeCommits: false,
    });
  } catch (error) {
    bootstrap.error =
      error instanceof Error ? error.message : "Could not load changes.";
  }
  return bootstrap;
}

function injectBootstrap(
  response: Response,
  bootstrap: BootstrapData,
  nonce: string,
): Response {
  const script = `<script nonce="${nonce}">window.__CHANGES_BOOTSTRAP__=${serializeBootstrap(bootstrap)};</script>`;
  return new HTMLRewriter()
    .on("script", {
      element(element) {
        // The shell is our own build output, so every script it already carries
        // is trusted. Nonce them rather than widening the policy: in production
        // this is just the bundle tag, but in dev it also covers the inline
        // React Refresh preamble that @vitejs/plugin-react injects.
        element.setAttribute("nonce", nonce);
      },
    })
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
  nonce: string;
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
  headers.delete("Content-Security-Policy");
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
    options.nonce,
  );
}
