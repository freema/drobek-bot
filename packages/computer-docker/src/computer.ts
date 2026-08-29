import { randomUUID } from "node:crypto";
import type { Readable, Writable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";

import {
  ComputerError,
  type AttachOptions,
  type AttachedProcess,
  type CommandResult,
  type Computer,
  type FileEntry,
  type RunCommandOptions,
} from "@drobek-bot/core";
import { z } from "zod";

import type { DockerClient, ExecStreams } from "./docker-client.js";

/**
 * One bot's box, driven through `docker exec`.
 *
 * Every command goes through a POSIX shell that writes its own process id to a
 * file in the box before handing over with `exec`. That is what makes a signal
 * reach the real process — the Docker API can start an exec but has no way to
 * signal one — and it is what a timeout and `AttachedProcess.kill` are built
 * on. File operations are shell commands too, so they run as the box's own
 * user and cannot leave root-owned files behind the way an unpacked archive
 * would.
 *
 * The image therefore has to provide `sh`, `cat`, `wc`, `dirname` and a
 * writable `/tmp`. The box image does.
 */

/** `$1` is the pid file, the rest is the command. */
const PID_WRAPPER = 'echo $$ > "$1"; shift; exec "$@"';

/** Distinguishes "the path is not there" from a command that failed for its own reasons. */
const MISSING_PATH_EXIT = 66;

const READ_SCRIPT = `[ -e "$1" ] || exit ${MISSING_PATH_EXIT}; exec cat "$1"`;

const WRITE_SCRIPT = `[ -d "$(dirname "$1")" ] || exit ${MISSING_PATH_EXIT}; exec cat > "$1"`;

/**
 * One line per entry: kind, size, name, tab separated. POSIX only, because the
 * box is not the only image this may run against; `find -printf` and `stat -c`
 * are not.
 */
const LIST_SCRIPT = [
  `cd "$1" 2>/dev/null || exit ${MISSING_PATH_EXIT}`,
  "for entry in * .*; do",
  '  case "$entry" in .|..) continue;; esac',
  '  [ -e "$entry" ] || continue',
  '  if [ -d "$entry" ]; then printf "d\\t0\\t%s\\n" "$entry";',
  '  else printf "f\\t%s\\t%s\\n" "$(wc -c < "$entry" 2>/dev/null || echo 0)" "$entry"; fi',
  "done",
].join("\n");

/** How long a killed command may take to let go of its streams. */
const KILL_GRACE_MS = 2_000;

/** An exec that has closed its streams reports its exit code within this many polls. */
const EXIT_POLL_ATTEMPTS = 600;
const EXIT_POLL_MS = 25;

const signalSchema = z.string().regex(/^(SIG)?[A-Z]+[0-9]*$/);

const listEntrySchema = z.object({
  kind: z.enum(["file", "directory"]),
  size: z.number().int().nonnegative(),
  name: z.string().min(1),
});

interface ExecResult {
  readonly exitCode: number;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
}

interface ExecOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly stdin?: Uint8Array;
}

function newPidPath(): string {
  return `/tmp/drobek-bot-exec-${randomUUID()}.pid`;
}

function wrapCommand(argv: readonly string[], pidPath: string): string[] {
  return ["sh", "-c", PID_WRAPPER, "drobek-bot", pidPath, ...argv];
}

/** Rejects only on a transport error; a destroyed stream resolves with what arrived. */
function collect(readable: Readable): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    readable.on("data", (chunk: unknown) => {
      if (Buffer.isBuffer(chunk)) chunks.push(chunk);
    });
    readable.on("end", () => resolve(Buffer.concat(chunks)));
    readable.on("close", () => resolve(Buffer.concat(chunks)));
    readable.on("error", (error: Error) => reject(error));
  });
}

async function waitForExit(client: DockerClient, execId: string): Promise<number> {
  for (let attempt = 0; attempt < EXIT_POLL_ATTEMPTS; attempt += 1) {
    const status = await client.inspectExec(execId);
    if (!status.running && status.exitCode !== undefined) return status.exitCode;
    await delay(EXIT_POLL_MS);
  }
  throw new ComputerError("runtime", "exec never reported an exit code");
}

/** `SIGTERM` and `TERM` are the same signal; anything else is not a signal name. */
function normalizeSignal(signal: string): string {
  const parsed = signalSchema.safeParse(signal.toUpperCase());
  if (!parsed.success) throw new ComputerError("invalid-spec", "not a signal name");
  return parsed.data.startsWith("SIG") ? parsed.data.slice(3) : parsed.data;
}

/** Best effort: the process may already be gone, or never have written its pid file. */
async function signalPid(
  client: DockerClient,
  containerId: string,
  pidPath: string,
  signal: string,
): Promise<void> {
  const execId = await client.createExec(containerId, {
    cmd: [
      "sh",
      "-c",
      'kill -s "$1" "$(cat "$2")" 2>/dev/null || true',
      "drobek-bot",
      signal,
      pidPath,
    ],
  });
  const streams = await client.startExec(execId);
  streams.stdin.end();
  await Promise.all([collect(streams.stdout), collect(streams.stderr)]);
}

function requireArgv(argv: readonly string[]): readonly string[] {
  const first = argv[0];
  if (first === undefined || first === "") {
    throw new ComputerError("invalid-spec", "command is empty");
  }
  if (argv.some((word) => word.includes("\0"))) {
    throw new ComputerError("invalid-spec", "command contains a NUL byte");
  }
  return argv;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function requirePath(path: string): string {
  if (!path.startsWith("/")) throw new ComputerError("invalid-spec", "path must be absolute");
  // A newline would forge a line in the directory listing; a NUL cannot cross argv.
  if (hasControlCharacter(path)) {
    throw new ComputerError("invalid-spec", "path contains a control character");
  }
  return path;
}

/** The box's own message, capped; it can only name the path the caller passed. */
function firstLine(stderr: Buffer): string | undefined {
  const line = stderr.toString("utf8").trim().split("\n")[0];
  return line === undefined || line === "" ? undefined : line.slice(0, 200);
}

function parseListing(directory: string, text: string): readonly FileEntry[] {
  const base = directory.endsWith("/") ? directory.slice(0, -1) : directory;
  const entries: FileEntry[] = [];
  for (const line of text.split("\n")) {
    if (line === "") continue;
    const parts = line.split("\t");
    const parsed = listEntrySchema.safeParse({
      kind: parts[0] === "d" ? "directory" : parts[0] === "f" ? "file" : parts[0],
      size: Number((parts[1] ?? "").trim()),
      name: parts.slice(2).join("\t"),
    });
    if (parts.length < 3 || !parsed.success) {
      throw new ComputerError("runtime", "directory listing is not readable");
    }
    entries.push({
      path: `${base}/${parsed.data.name}`,
      kind: parsed.data.kind,
      size: parsed.data.kind === "directory" ? 0 : parsed.data.size,
    });
  }
  return entries;
}

class DockerAttachedProcess implements AttachedProcess {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  readonly #client: DockerClient;
  readonly #containerId: string;
  readonly #execId: string;
  readonly #closed: Promise<void>;
  readonly #pidPath: string;
  #exit: Promise<number> | undefined;

  constructor(
    client: DockerClient,
    containerId: string,
    execId: string,
    streams: ExecStreams,
    pidPath: string,
  ) {
    this.#client = client;
    this.#containerId = containerId;
    this.#execId = execId;
    this.#closed = streams.closed;
    this.#pidPath = pidPath;
    this.stdin = streams.stdin;
    this.stdout = streams.stdout;
    this.stderr = streams.stderr;
  }

  wait(): Promise<number> {
    this.#exit ??= this.#closed.then(() => waitForExit(this.#client, this.#execId));
    return this.#exit;
  }

  async kill(signal = "SIGTERM"): Promise<void> {
    await signalPid(this.#client, this.#containerId, this.#pidPath, normalizeSignal(signal));
  }
}

export class DockerComputer implements Computer {
  readonly id: string;
  readonly #client: DockerClient;
  readonly #containerId: string;

  constructor(client: DockerClient, botId: string, containerId: string) {
    this.#client = client;
    this.id = botId;
    this.#containerId = containerId;
  }

  async runCommand(argv: readonly string[], opts: RunCommandOptions = {}): Promise<CommandResult> {
    const result = await this.#execute(requireArgv(argv), {
      ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
      ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
    });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString("utf8"),
      stderr: result.stderr.toString("utf8"),
    };
  }

  async attach(argv: readonly string[], opts: AttachOptions = {}): Promise<AttachedProcess> {
    const pidPath = newPidPath();
    const execId = await this.#client.createExec(this.#containerId, {
      cmd: wrapCommand(requireArgv(argv), pidPath),
      ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
    });
    const streams = await this.#client.startExec(execId);
    return new DockerAttachedProcess(this.#client, this.#containerId, execId, streams, pidPath);
  }

  async readFile(path: string): Promise<Uint8Array> {
    const target = requirePath(path);
    const result = await this.#execute(["sh", "-c", READ_SCRIPT, "drobek-bot", target], {});
    if (result.exitCode === MISSING_PATH_EXIT) throw new ComputerError("file-not-found", target);
    if (result.exitCode !== 0) throw new ComputerError("runtime", firstLine(result.stderr));
    return result.stdout;
  }

  async writeFile(path: string, bytes: Uint8Array): Promise<void> {
    const target = requirePath(path);
    const result = await this.#execute(["sh", "-c", WRITE_SCRIPT, "drobek-bot", target], {
      stdin: bytes,
    });
    if (result.exitCode === MISSING_PATH_EXIT) {
      throw new ComputerError("file-not-found", `no directory for ${target}`);
    }
    if (result.exitCode !== 0) throw new ComputerError("runtime", firstLine(result.stderr));
  }

  async listFiles(path: string): Promise<readonly FileEntry[]> {
    const directory = requirePath(path);
    const result = await this.#execute(["sh", "-c", LIST_SCRIPT, "drobek-bot", directory], {});
    if (result.exitCode === MISSING_PATH_EXIT) throw new ComputerError("file-not-found", directory);
    if (result.exitCode !== 0) throw new ComputerError("runtime", firstLine(result.stderr));
    return parseListing(directory, result.stdout.toString("utf8"));
  }

  async #execute(argv: readonly string[], opts: ExecOptions): Promise<ExecResult> {
    const pidPath = newPidPath();
    const execId = await this.#client.createExec(this.#containerId, {
      cmd: wrapCommand(argv, pidPath),
      ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
    });
    const streams = await this.#client.startExec(execId);
    if (opts.stdin === undefined) streams.stdin.end();
    else streams.stdin.end(Buffer.from(opts.stdin));

    let timedOut = false;
    let killer: NodeJS.Timeout | undefined;
    let grace: NodeJS.Timeout | undefined;
    if (opts.timeoutMs !== undefined) {
      killer = setTimeout(() => {
        timedOut = true;
        void signalPid(this.#client, this.#containerId, pidPath, "KILL").catch(() => undefined);
        // A process that does not let go of its streams must not hold the caller.
        grace = setTimeout(() => {
          streams.stdout.destroy();
          streams.stderr.destroy();
        }, KILL_GRACE_MS);
      }, opts.timeoutMs);
    }

    try {
      const [stdout, stderr] = await Promise.all([
        collect(streams.stdout),
        collect(streams.stderr),
      ]);
      if (timedOut) throw new ComputerError("timeout");
      return { exitCode: await waitForExit(this.#client, execId), stdout, stderr };
    } finally {
      clearTimeout(killer);
      clearTimeout(grace);
    }
  }
}
