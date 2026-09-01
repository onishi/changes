import { renderToString } from "react-dom/server";
import { AppView } from "../src/App";
import type { BootstrapData, RouteState } from "../src/types";

function noop() {
  // The static markup is replaced by the hydrated client, so these
  // server-render-only handlers never actually run.
}

export function renderAppHtml(
  route: RouteState,
  bootstrap: BootstrapData,
): string {
  return renderToString(
    <AppView
      route={route}
      session={bootstrap.session}
      syncing={false}
      onSync={noop}
      navigate={noop}
      onLinkClick={noop}
      error={bootstrap.error}
      onRetry={noop}
      data={bootstrap.periodData}
      latestDailyData={bootstrap.latestDailyData}
      repositoriesData={bootstrap.repositoriesData}
    />,
  );
}
