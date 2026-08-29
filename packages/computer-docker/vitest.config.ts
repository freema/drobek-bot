import { configDefaults, defineConfig } from "vitest/config";

/** Offline unit tests against a fake `DockerClient`; the lifecycle suite runs through `test:integration`. */
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "**/*.integration.test.ts"],
  },
});
