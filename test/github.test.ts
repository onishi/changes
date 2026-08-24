import { describe, expect, it } from "vitest";
import { parseGitHubRateLimit } from "../worker/github";

describe("GitHub rate-limit headers", () => {
  it("parses an authenticated REST API rate-limit snapshot", () => {
    const headers = new Headers({
      "X-RateLimit-Limit": "5000",
      "X-RateLimit-Remaining": "4875",
      "X-RateLimit-Used": "125",
      "X-RateLimit-Reset": "1787551200",
      "X-RateLimit-Resource": "core",
    });

    expect(parseGitHubRateLimit(headers)).toEqual({
      limit: 5000,
      remaining: 4875,
      used: 125,
      resetAt: "2026-08-24T06:00:00.000Z",
      resource: "core",
    });
  });

  it("ignores responses without valid limit and remaining headers", () => {
    expect(parseGitHubRateLimit(new Headers())).toBeNull();
    expect(
      parseGitHubRateLimit(
        new Headers({
          "X-RateLimit-Limit": "5000",
          "X-RateLimit-Remaining": "invalid",
        }),
      ),
    ).toBeNull();
  });
});
