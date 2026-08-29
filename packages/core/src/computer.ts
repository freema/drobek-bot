import type { Readable, Writable } from "node:stream";

/**
 * The port a bot's computer ("box") is reached through: one isolated machine
 * per bot, with its own files, its own shell and its own tools. Types and
 * interfaces only — the Docker implementation lives in
 * `@drobek-bot/computer-docker`, and no other package may import a container
 * runtime.
 *
 * The box is untrusted. The app decides what goes in (`ComputerSpec.env` is an
 * allowlist built by `buildBoxEnv`, never the host environment) and every
 * action that leaves the box is brokered on the app side, not here.
 */

/** A host path made visible inside the box. */
export interface ComputerBind {
  /** Absolute path on the host. */
  readonly hostPath: string;
  /** Absolute path inside the box. */
  readonly boxPath: string;
  readonly readOnly?: boolean;
}

/** Everything needed to bring a bot's box into existence. */
export interface ComputerSpec {
  /** The bot this box belongs to; also the `id` the provider is addressed by. */
  readonly botId: string;
  /** Image reference, e.g. `drobek-bot-box`. Never built or pulled here. */
  readonly image: string;
  /** The allowlisted environment, as returned by `buildBoxEnv`. */
  readonly env: Readonly<Record<string, string>>;
  readonly binds?: readonly ComputerBind[];
}

/** A finished command. `exitCode` is the process's, not the provider's verdict. */
export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** One entry of a directory listing. `path` is absolute inside the box. */
export interface FileEntry {
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly size: number;
}

export interface RunCommandOptions {
  /** Absolute path inside the box; the image's working directory by default. */
  readonly cwd?: string;
  /** Kills the process and throws `ComputerError("timeout")` when exceeded. */
  readonly timeoutMs?: number;
}

export interface AttachOptions {
  readonly cwd?: string;
}

/**
 * A process in the box the caller holds the pipes of. This is what a runtime
 * that speaks a protocol over stdio needs; `runCommand` buffers and cannot
 * serve it.
 */
export interface AttachedProcess {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  /** The exit code, once the process is gone. */
  wait(): Promise<number>;
  /** Signals the process; `SIGTERM` by default. Safe to call twice. */
  kill(signal?: string): Promise<void>;
}

/** One bot's running box. */
export interface Computer {
  /** The bot id this box belongs to. */
  readonly id: string;
  runCommand(argv: readonly string[], opts?: RunCommandOptions): Promise<CommandResult>;
  attach(argv: readonly string[], opts?: AttachOptions): Promise<AttachedProcess>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  listFiles(path: string): Promise<readonly FileEntry[]>;
}

/**
 * The lifecycle of bot boxes. `id` is the bot id throughout.
 *
 * `stop` keeps the bot's home volume — `reconnect` is what makes that
 * worth doing. `destroy` is the hard delete of a bot: box and volume both.
 */
export interface ComputerProvider {
  provision(spec: ComputerSpec): Promise<Computer>;
  /** The bot's box, started if it was stopped; undefined when it does not exist. */
  reconnect(id: string): Promise<Computer | undefined>;
  /** Stops the box and keeps its home volume. No-op when there is no box. */
  stop(id: string): Promise<void>;
  /** Removes the box and its home volume. No-op when there is neither. */
  destroy(id: string): Promise<void>;
}

/**
 * Why a computer operation failed.
 *
 * - `invalid-spec` — a bot id, path or bind the provider will not accept
 * - `denied-env` — an environment name that must never reach a box
 * - `not-managed` — the name is taken by a container or volume this app did
 *   not create; refusing is the point, the app holds the host's docker socket
 * - `not-found` — the box is gone
 * - `file-not-found` — the path does not exist inside the box
 * - `image-not-found` — the image is not present on the host
 * - `timeout` — a command outlived its `timeoutMs`
 * - `unavailable` — the container runtime could not be reached
 * - `runtime` — anything else the container runtime reported
 */
export type ComputerErrorKind =
  | "invalid-spec"
  | "denied-env"
  | "not-managed"
  | "not-found"
  | "file-not-found"
  | "image-not-found"
  | "timeout"
  | "unavailable"
  | "runtime";

/** The only error a `ComputerProvider` or `Computer` throws. `detail` never carries secret values. */
export class ComputerError extends Error {
  readonly kind: ComputerErrorKind;

  constructor(kind: ComputerErrorKind, detail?: string) {
    super(detail === undefined ? `computer: ${kind}` : `computer: ${kind}: ${detail}`);
    this.name = "ComputerError";
    this.kind = kind;
  }
}
