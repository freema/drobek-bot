import { defineConfig } from "vitest/config";

/** Integration tests against a Postgres 17 Testcontainer; needs Docker. */
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
