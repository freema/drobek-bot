/**
 * The only module that talks to the docker CLI. Everything it reads back is
 * parsed with zod before anyone else sees it.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { z } from "zod";

export const BOX_IMAGE = "drobek-bot-box";
export const BOX_HOME_VOLUME = "drobek-bot-box-home";
export const BOX_HOME = "/home/bot";
export const BOX_WORKDIR = "/home/bot/work";

/**
 * Reads `ANTHROPIC_API_KEY` from a dotenv-style file. The value is returned to
 * the caller and must only ever be handed to `docker run` through the process
 * environment, never through argv, logs or files.
 */
export async function readApiKeyFromEnvFile(path: string): Promise<string | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return undefined;
  }
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("ANTHROPIC_API_KEY=")) continue;
    const value = line.slice("ANTHROPIC_API_KEY=".length).trim();
    return value.replace(/^["']|["']$/g, "");
  }
  return undefined;
}

export type BoxOptions = {
  name: string;
  image?: string;
  volume?: string;
  /** Environment for the box. Values travel via the docker CLI's environment, never argv. */
  env: Record<string, string>;
  /** Command to run instead of the image default (the ACP adapter). */
  command?: readonly string[];
};

export type Box = {
  name: string;
  process: ChildProcessWithoutNullStreams;
  startedAt: number;
  /** Resolves with the docker CLI's exit code once the container is gone. */
  exited: Promise<number | null>;
};

export function startBox(options: BoxOptions): Box {
  const image = options.image ?? BOX_IMAGE;
  const volume = options.volume ?? BOX_HOME_VOLUME;
  const args = ["run", "-i", "--rm", "--name", options.name, "-v", `${volume}:${BOX_HOME}`];
  for (const key of Object.keys(options.env)) {
    args.push("-e", key);
  }
  args.push(image, ...(options.command ?? []));
  const startedAt = Date.now();
  const child = spawn("docker", args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...options.env },
  });
  const exited = new Promise<number | null>((resolve) => {
    child.on("exit", (code) => resolve(code));
    child.on("error", () => resolve(null));
  });
  return { name: options.name, process: child, startedAt, exited };
}

export async function killBox(name: string): Promise<void> {
  await runDocker(["kill", name]).catch(() => undefined);
}

export async function isBoxRunning(name: string): Promise<boolean> {
  const out = await runDocker(["ps", "-q", "--filter", `name=^/${name}$`]).catch(() => "");
  return out.trim() !== "";
}

const statsLineSchema = z.object({ MemUsage: z.string() });

/** Container memory in bytes as reported by `docker stats`. */
export async function memoryBytes(name: string): Promise<number | undefined> {
  const out = await runDocker(["stats", "--no-stream", "--format", "{{json .}}", name]).catch(
    () => "",
  );
  const line = out.trim().split("\n")[0];
  if (line === undefined || line === "") return undefined;
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    return undefined;
  }
  const parsed = statsLineSchema.safeParse(json);
  if (!parsed.success) return undefined;
  const used = parsed.data.MemUsage.split("/")[0]?.trim() ?? "";
  return parseByteSize(used);
}

const UNIT_FACTORS: Record<string, number> = {
  B: 1,
  KB: 1e3,
  MB: 1e6,
  GB: 1e9,
  KIB: 1024,
  MIB: 1024 ** 2,
  GIB: 1024 ** 3,
};

export function parseByteSize(text: string): number | undefined {
  const match = /^([\d.]+)\s*([A-Za-z]+)$/.exec(text.trim());
  if (!match) return undefined;
  const value = Number(match[1]);
  const factor = UNIT_FACTORS[(match[2] ?? "").toUpperCase()];
  if (!Number.isFinite(value) || factor === undefined) return undefined;
  return Math.round(value * factor);
}

export async function imageSizeBytes(image: string = BOX_IMAGE): Promise<number> {
  const out = await runDocker(["image", "inspect", "--format", "{{.Size}}", image]);
  return z.coerce.number().int().nonnegative().parse(out.trim());
}

export async function imageSizeHuman(image: string = BOX_IMAGE): Promise<string> {
  const out = await runDocker(["images", image, "--format", "{{.Size}}"]);
  return z.string().parse(out.trim().split("\n")[0] ?? "");
}

export async function execInBox(name: string, command: readonly string[]): Promise<string> {
  return runDocker(["exec", name, ...command]);
}

/** Writes a file into the home volume using a throwaway container. */
export async function writeFileInVolume(
  path: string,
  content: string,
  volume: string = BOX_HOME_VOLUME,
  image: string = BOX_IMAGE,
): Promise<void> {
  await runDocker(
    [
      "run",
      "--rm",
      "-i",
      "-v",
      `${volume}:${BOX_HOME}`,
      image,
      "sh",
      "-c",
      `mkdir -p "$(dirname '${path}')" && cat > '${path}'`,
    ],
    content,
  );
}

export async function removeFileInVolume(
  path: string,
  volume: string = BOX_HOME_VOLUME,
  image: string = BOX_IMAGE,
): Promise<void> {
  await runDocker(["run", "--rm", "-v", `${volume}:${BOX_HOME}`, image, "rm", "-f", path]);
}

/** The host address as seen from inside a box (`host.docker.internal`). */
export async function hostAddressFromBox(image: string = BOX_IMAGE): Promise<string> {
  const out = await runDocker(["run", "--rm", image, "getent", "hosts", "host.docker.internal"]);
  const address = out.trim().split(/\s+/)[0] ?? "";
  return z
    .string()
    .regex(/^\d{1,3}(\.\d{1,3}){3}$/)
    .parse(address);
}

export type Tail = { stop: () => void };

/**
 * Follows a file inside the running container line by line. The file may not
 * exist yet; `tail -F` waits for it.
 */
export function tailFileInBox(name: string, path: string, onLine: (line: string) => void): Tail {
  const child = spawn("docker", ["exec", name, "tail", "-n", "+1", "-F", path], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  const lines = createInterface({ input: child.stdout });
  lines.on("line", onLine);
  return {
    stop: () => {
      lines.close();
      child.kill();
    },
  };
}

function runDocker(args: readonly string[], stdin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(out).toString("utf8"));
      else
        reject(
          new Error(
            `docker ${args[0]} exited with ${code}: ${Buffer.concat(err).toString("utf8")}`,
          ),
        );
    });
    if (stdin !== undefined) child.stdin.end(stdin);
    else child.stdin.end();
  });
}
