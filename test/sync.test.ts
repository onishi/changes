import { describe, expect, it } from "vitest";
import type { RepositoryRow } from "../worker/domain";
import { isSummaryGenerationDue } from "../worker/records";
import { initialSince } from "../worker/sync";
import { periodBoundsForInstant } from "../worker/lib/time";

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
    created_at: "2026-05-01T00:00:00.000Z",
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

describe("summary generation cadence", () => {
  const now = "2026-08-20T01:00:00.000Z";

  it("always refreshes daily and completed periods", () => {
    expect(
      isSummaryGenerationDue(
        periodBoundsForInstant("daily", now),
        "2026-08-20T00:30:00.000Z",
        now,
      ),
    ).toBe(true);
    expect(
      isSummaryGenerationDue(
        periodBoundsForInstant("weekly", "2026-08-10T01:00:00.000Z"),
        now,
        now,
      ),
    ).toBe(true);
  });

  it("refreshes the current week at most once per Tokyo day", () => {
    const bounds = periodBoundsForInstant("weekly", now);
    expect(
      isSummaryGenerationDue(bounds, "2026-08-19T23:00:00.000Z", now),
    ).toBe(false);
    expect(
      isSummaryGenerationDue(bounds, "2026-08-19T14:00:00.000Z", now),
    ).toBe(true);
  });

  it("refreshes the current month at most once per Tokyo week", () => {
    const bounds = periodBoundsForInstant("monthly", now);
    expect(
      isSummaryGenerationDue(bounds, "2026-08-16T01:00:00.000Z", now),
    ).toBe(false);
    expect(
      isSummaryGenerationDue(bounds, "2026-08-15T14:00:00.000Z", now),
    ).toBe(true);
  });

  it("allows the first summary for every period immediately", () => {
    expect(
      isSummaryGenerationDue(periodBoundsForInstant("monthly", now), null, now),
    ).toBe(true);
  });
});
