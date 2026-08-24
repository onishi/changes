import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations("migrations");

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-08-18",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        bindings: { TEST_MIGRATIONS: migrations },
      },
    }),
  ],
  test: {
    setupFiles: ["./test/setup.ts"],
  },
});
