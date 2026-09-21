import { describe, expect, it } from "vitest";
import { parseGitHubRateLimit, repositoryCommitsPath } from "../worker/github";

describe("repository commit requests", () => {
  const path = repositoryCommitsPath(
    "onishi",
    { name: "changes", defaultBranch: "main" },
    "2026-09-18T00:00:00.000Z",
    2,
  );
  const query = new URL(path, "https://api.github.com").searchParams;

  it("asks for the default branch since the requested instant", () => {
    expect(path.startsWith("/repos/onishi/changes/commits?")).toBe(true);
    expect(query.get("sha")).toBe("main");
    expect(query.get("since")).toBe("2026-09-18T00:00:00.000Z");
    expect(query.get("page")).toBe("2");
    expect(query.get("per_page")).toBe("100");
  });

  it("does not filter by author", () => {
    // GitHub resolves `author` against the account a commit is linked to, so
    // the filter dropped commits an agent authored on the owner's behalf even
    // though they landed on the owner's own default branch.
    expect(query.has("author")).toBe(false);
  });
});

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
