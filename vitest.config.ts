import { readFileSync } from "node:fs";
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations("migrations");
// The worker sandbox has no access to the repository, so hand the stylesheet
// to the test that checks the favicon paints the same shades as the page.
const styles = readFileSync("src/styles.css", "utf8");

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-08-18",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        bindings: { TEST_MIGRATIONS: migrations, TEST_STYLES: styles },
      },
    }),
  ],
  test: {
    setupFiles: ["./test/setup.ts"],
  },
});
