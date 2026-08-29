import { PassThrough, type Readable, type Writable } from "node:stream";

import Docker from "dockerode";
import { z } from "zod";

import { toComputerError } from "./errors.js";

/**
 * The slice of the Docker API this package uses, and the dockerode
 * implementation of it. This is the only module that imports dockerode; the
 * provider is written against `DockerClient`, so a test drives it with a fake
 * client instead of a daemon.
 *
 * Everything the daemon returns is parsed before it is used: the responses are
 * HTTP, and the hand-written dockerode types are not a guarantee.
 */

export interface ContainerSummary {
  readonly id: string;
  /** Without the leading slash the API puts on it. */
  readonly name: string;
  readonly labels: Readonly<Record<string, string>>;
  /** A snapshot for reporting only; a container on its way down still reads
   * as running, so no lifecycle action may be gated on it. */
  readonly running: boolean;
}

export interface VolumeSummary {
  readonly name: string;
  readonly labels: Readonly<Record<string, string>>;
}

export interface ContainerFilters {
  /** `key=value` entries, as the Docker API wants them. */
  readonly label?: readonly string[];
  /** Anchored name patterns, e.g. `^/drobek-bot-box-scout$`. */
  readonly name?: readonly string[];
}

export interface CreateContainerInput {
  readonly name: string;
  readonly image: string;
  /** `NAME=value` entries. */
  readonly env: readonly string[];
  readonly labels: Readonly<Record<string, string>>;
  /** `source:target[:ro]` entries. */
  readonly binds: readonly string[];
  /** What PID 1 runs; the box stays up so commands can be executed in it. */
  readonly command: readonly string[];
}

export interface CreateExecInput {
  readonly cmd: readonly string[];
  readonly cwd?: string;
}

/** A running exec, already demultiplexed. */
export interface ExecStreams {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  /** Resolves once the daemon closed the connection. Never rejects. */
  readonly closed: Promise<void>;
}

export interface ExecStatus {
  readonly running: boolean;
  readonly exitCode: number | undefined;
}

export interface DockerClient {
  listContainers(filters: ContainerFilters): Promise<readonly ContainerSummary[]>;
  createContainer(input: CreateContainerInput): Promise<string>;
  startContainer(id: string): Promise<void>;
  stopContainer(id: string): Promise<void>;
  removeContainer(id: string): Promise<void>;
  inspectVolume(name: string): Promise<VolumeSummary | undefined>;
  createVolume(name: string, labels: Readonly<Record<string, string>>): Promise<void>;
  removeVolume(name: string): Promise<void>;
  createExec(containerId: string, input: CreateExecInput): Promise<string>;
  startExec(execId: string): Promise<ExecStreams>;
  inspectExec(execId: string): Promise<ExecStatus>;
}

const labelsSchema = z
  .record(z.string(), z.string())
  .nullish()
  .transform((labels) => labels ?? {});

const containerInfoSchema = z.object({
  Id: z.string().min(1),
  Names: z.array(z.string()).default([]),
  State: z.string().default(""),
  Labels: labelsSchema,
});

const volumeInfoSchema = z.object({
  Name: z.string().min(1),
  Labels: labelsSchema,
});

const execInfoSchema = z.object({
  Running: z.boolean(),
  ExitCode: z.number().int().nullish(),
});

function toSummary(info: z.infer<typeof containerInfoSchema>): ContainerSummary {
  const name = info.Names[0] ?? "";
  return {
    id: info.Id,
    name: name.startsWith("/") ? name.slice(1) : name,
    labels: info.Labels,
    running: info.State === "running",
  };
}

/** Docker's stream frame: type byte, three zeros, then a big-endian length. */
const FRAME_HEADER_BYTES = 8;
const STDERR_STREAM = 2;

/**
 * Splits the multiplexed exec output into stdout and stderr. A short read is
 * kept until the rest of the frame arrives; the payload is passed through
 * untouched, so binary content survives.
 */
function demultiplex(source: Readable, stdout: PassThrough, stderr: PassThrough): void {
  let pending = Buffer.alloc(0);
  source.on("data", (chunk: unknown) => {
    if (!Buffer.isBuffer(chunk)) return;
    pending = Buffer.concat([pending, chunk]);
    for (;;) {
      if (pending.length < FRAME_HEADER_BYTES) return;
      const size = pending.readUInt32BE(4);
      if (pending.length < FRAME_HEADER_BYTES + size) return;
      const target = pending.readUInt8(0) === STDERR_STREAM ? stderr : stdout;
      target.write(pending.subarray(FRAME_HEADER_BYTES, FRAME_HEADER_BYTES + size));
      pending = pending.subarray(FRAME_HEADER_BYTES + size);
    }
  });
  source.on("end", () => {
    stdout.end();
    stderr.end();
  });
  source.on("error", (error: Error) => {
    stdout.destroy(error);
    stderr.destroy(error);
  });
}

/** The Docker daemon dockerode finds by itself: `DOCKER_HOST`, else the local socket. */
export function createDockerodeClient(): DockerClient {
  const docker = new Docker();

  return {
    async listContainers(filters) {
      const search: Record<string, string[]> = {};
      if (filters.label !== undefined) search.label = [...filters.label];
      if (filters.name !== undefined) search.name = [...filters.name];
      try {
        const found = await docker.listContainers({ all: true, filters: search });
        return z.array(containerInfoSchema).parse(found).map(toSummary);
      } catch (error) {
        throw toComputerError(error, "not-found");
      }
    },

    async createContainer(input) {
      try {
        const created = await docker.createContainer({
          name: input.name,
          Image: input.image,
          Labels: { ...input.labels },
          Env: [...input.env],
          // The image's own entrypoint would run the ACP adapter and exit; the
          // box has to stay up so commands can be executed in it.
          Entrypoint: [],
          Cmd: [...input.command],
          OpenStdin: false,
          Tty: false,
          HostConfig: {
            Binds: [...input.binds],
            // Nothing else reaps the orphans a long-lived box accumulates:
            // every command runs as an exec, and PID 1 only idles.
            Init: true,
            NetworkMode: "bridge",
            Privileged: false,
          },
        });
        return created.id;
      } catch (error) {
        throw toComputerError(error, "image-not-found");
      }
    },

    async startContainer(id) {
      try {
        await docker.getContainer(id).start();
      } catch (error) {
        // 304: already running.
        if (error instanceof Error && "statusCode" in error && error.statusCode === 304) return;
        throw toComputerError(error, "not-found");
      }
    },

    async stopContainer(id) {
      try {
        await docker.getContainer(id).stop();
      } catch (error) {
        // 304: already stopped.
        if (error instanceof Error && "statusCode" in error && error.statusCode === 304) return;
        throw toComputerError(error, "not-found");
      }
    },

    async removeContainer(id) {
      try {
        await docker.getContainer(id).remove({ force: true, v: false });
      } catch (error) {
        throw toComputerError(error, "not-found");
      }
    },

    async inspectVolume(name) {
      try {
        const info = await docker.getVolume(name).inspect();
        const parsed = volumeInfoSchema.parse(info);
        return { name: parsed.Name, labels: parsed.Labels };
      } catch (error) {
        const mapped = toComputerError(error, "not-found");
        if (mapped.kind === "not-found") return undefined;
        throw mapped;
      }
    },

    async createVolume(name, labels) {
      try {
        await docker.createVolume({ Name: name, Labels: { ...labels } });
      } catch (error) {
        throw toComputerError(error, "not-found");
      }
    },

    async removeVolume(name) {
      try {
        await docker.getVolume(name).remove();
      } catch (error) {
        const mapped = toComputerError(error, "not-found");
        if (mapped.kind === "not-found") return;
        throw mapped;
      }
    },

    async createExec(containerId, input) {
      try {
        const exec = await docker.getContainer(containerId).exec({
          Cmd: [...input.cmd],
          AttachStdin: true,
          AttachStdout: true,
          AttachStderr: true,
          Tty: false,
          ...(input.cwd === undefined ? {} : { WorkingDir: input.cwd }),
        });
        return exec.id;
      } catch (error) {
        throw toComputerError(error, "not-found");
      }
    },

    async startExec(execId) {
      let duplex;
      try {
        duplex = await docker.getExec(execId).start({ hijack: true, stdin: true });
      } catch (error) {
        throw toComputerError(error, "not-found");
      }
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      stdin.pipe(duplex);
      demultiplex(duplex, stdout, stderr);
      const closed = new Promise<void>((resolve) => {
        duplex.on("end", () => resolve());
        duplex.on("close", () => resolve());
        duplex.on("error", () => resolve());
      });
      return { stdin, stdout, stderr, closed };
    },

    async inspectExec(execId) {
      try {
        const info = execInfoSchema.parse(await docker.getExec(execId).inspect());
        return {
          running: info.Running,
          exitCode: info.ExitCode ?? undefined,
        };
      } catch (error) {
        throw toComputerError(error, "not-found");
      }
    },
  };
}
