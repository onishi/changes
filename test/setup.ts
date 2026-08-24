import { env } from "cloudflare:workers";
import { applyD1Migrations, reset, type D1Migration } from "cloudflare:test";
import { afterEach, beforeEach } from "vitest";

const testEnv = env as typeof env & { TEST_MIGRATIONS: D1Migration[] };

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

afterEach(async () => {
  await reset();
});
