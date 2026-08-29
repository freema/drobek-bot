import { createDb, migrate } from "@drobek-bot/db";
import { serve } from "@hono/node-server";

import { createApp } from "./app.js";
import { readEnv } from "./env.js";
import { closeDependencies, createDependencies, createProbes } from "./probes.js";
import type { Dependencies } from "./probes.js";
import { readRootVersion } from "./version.js";

async function main(): Promise<void> {
  const env = readEnv(process.env);
  const build = { version: await readRootVersion(), commit: env.GIT_SHA };
  const dependencies = createDependencies(env);
  await applyMigrations(dependencies);
  const app = createApp(build, createProbes(dependencies));

  const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`api ${build.version} (${build.commit}) listening on port ${info.port}`);
  });

  const shutdown = (signal: NodeJS.Signals): void => {
    console.log(`api received ${signal}, shutting down`);
    server.close(() => {
      void closeDependencies(dependencies).finally(() => process.exit(0));
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

/** Brings the database up to date before the api serves anything; idempotent. */
async function applyMigrations({ postgres }: Dependencies): Promise<void> {
  try {
    await migrate(createDb(postgres));
    console.log("database migrations applied");
  } catch (error) {
    console.error("database migration failed, api not starting:", error);
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error("api failed to start:", error);
  process.exit(1);
});
