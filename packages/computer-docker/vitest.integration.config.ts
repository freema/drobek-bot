import { defineConfig } from "vitest/config";

/** The full box lifecycle against a real Docker daemon; needs Docker. */
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
