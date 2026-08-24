import { describe, expect, it } from "vitest";
import {
  decodeCursor,
  encodeCursor,
  hmacSha256,
  timingSafeEqual,
} from "../worker/lib/crypto";

describe("cursor and token helpers", () => {
  it("round-trips cursor data without exposing raw JSON", () => {
    const cursor = encodeCursor({
      lastCommittedAt: "2026-08-20T10:00:00.000Z",
      repositoryId: "repo_123",
    });
    expect(cursor).not.toContain("repo_123");
    expect(decodeCursor(cursor)).toEqual({
      lastCommittedAt: "2026-08-20T10:00:00.000Z",
      repositoryId: "repo_123",
    });
  });

  it("compares tokens after hashing", async () => {
    await expect(timingSafeEqual("one-token", "one-token")).resolves.toBe(true);
    await expect(timingSafeEqual("one-token", "other-token")).resolves.toBe(
      false,
    );
  });

  it("peppers stored session tokens with the session secret", async () => {
    const first = await hmacSha256("secret-one", "session-token");
    const second = await hmacSha256("secret-two", "session-token");
    expect(first).not.toBe(second);
    expect(first).not.toContain("session-token");
  });
});
