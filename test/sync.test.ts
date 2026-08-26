import { describe, expect, it } from "vitest";
import type { RepositoryRow } from "../worker/domain";
import { initialSince } from "../worker/sync";

function repository(lastSyncedAt: string | null): RepositoryRow {
  return {
    id: "repo",
    owner_login: "onishi",
    name: "changes",
    full_name: "onishi/changes",
    visibility: "public",
    html_url: "https://github.com/onishi/changes",
    default_branch: "main",
    is_archived: 0,
    is_fork: 0,
    github_updated_at: null,
    last_synced_at: lastSyncedAt,
    deleted_at: null,
  };
}

describe("repository sync cutoff", () => {
  it("starts an initial sync at 2026-05-01 Tokyo time", () => {
    expect(initialSince(repository(null))).toBe("2026-04-30T15:00:00.000Z");
  });

  it("clamps the overlap window but retains later incremental syncs", () => {
    expect(initialSince(repository("2026-05-01T12:00:00.000Z"))).toBe(
      "2026-04-30T15:00:00.000Z",
    );
    expect(initialSince(repository("2026-08-26T00:00:00.000Z"))).toBe(
      "2026-08-24T00:00:00.000Z",
    );
  });
});
