import { configDefaults, defineConfig } from "vitest/config";

/** Offline unit tests; the Testcontainers suite runs through `test:integration`. */
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "**/*.integration.test.ts"],
  },
});
