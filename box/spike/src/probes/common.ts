/**
 * Shared argument parsing and defaults for the probe entry points.
 */
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readApiKeyFromEnvFile } from "../docker.ts";
import { DEFAULT_POLICY, type Policy } from "../policy.ts";
import {
  DEFAULT_CAP_USD,
  DEFAULT_MAX_TURNS,
  DEFAULT_MODEL,
  type ModelVia,
  type RunConfig,
} from "../run.ts";

export const TEST_ENV_FILE = path.join(os.homedir(), ".config", "drobek-bot", ".env.test");

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export type ProbeArgs = {
  capUsd: number;
  maxTurns: number;
  model: string;
  modelVia: ModelVia;
  /** `--no-key`: do not pass ANTHROPIC_API_KEY; the box must be logged in. */
  noKey: boolean;
  outDir: string;
  allow: string[] | undefined;
  rest: string[];
};

export function parseArgs(
  probe: string,
  argv: readonly string[] = process.argv.slice(2),
): ProbeArgs {
  const args: ProbeArgs = {
    capUsd: DEFAULT_CAP_USD,
    maxTurns: DEFAULT_MAX_TURNS,
    model: DEFAULT_MODEL,
    modelVia: "settings",
    noKey: false,
    outDir: path.join(
      packageRoot,
      "out",
      `${probe}-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    ),
    allow: undefined,
    rest: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      i += 1;
      return value;
    };
    switch (arg) {
      case "--cap":
        args.capUsd = Number(next());
        break;
      case "--max-turns":
        args.maxTurns = Number(next());
        break;
      case "--model":
        args.model = next();
        break;
      case "--model-via": {
        const via = next();
        if (via !== "option" && via !== "env" && via !== "settings") {
          throw new Error("--model-via option|env|settings");
        }
        args.modelVia = via;
        break;
      }
      case "--no-key":
        args.noKey = true;
        break;
      case "--out":
        args.outDir = path.resolve(next());
        break;
      case "--allow":
        args.allow = next()
          .split(",")
          .filter((s) => s !== "");
        break;
      default:
        if (arg !== undefined) args.rest.push(arg);
    }
  }
  if (!Number.isFinite(args.capUsd) || args.capUsd < 0) throw new Error("--cap must be >= 0");
  return args;
}

export async function baseConfig(
  probe: string,
  args: ProbeArgs,
  overrides: Partial<RunConfig> & { prompts: readonly string[] },
): Promise<RunConfig> {
  const apiKey = args.noKey ? undefined : await readApiKeyFromEnvFile(TEST_ENV_FILE);
  if (!args.noKey && apiKey === undefined) {
    throw new Error(
      `No ANTHROPIC_API_KEY in ${TEST_ENV_FILE}; pass --no-key to use the box's own login`,
    );
  }
  const policy: Policy = args.allow !== undefined ? { allow: args.allow } : DEFAULT_POLICY;
  return {
    name: probe,
    policy,
    capUsd: args.capUsd,
    maxTurns: args.maxTurns,
    model: args.model,
    modelVia: args.modelVia,
    apiKey,
    outDir: args.outDir,
    ...overrides,
  };
}

export function log(message: string): void {
  process.stderr.write(`[spike] ${message}\n`);
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(5)}`;
}

export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return "n/a";
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
