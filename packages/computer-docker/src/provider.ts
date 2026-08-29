import {
  ComputerError,
  isDeniedBoxEnvName,
  type Computer,
  type ComputerBind,
  type ComputerProvider,
  type ComputerSpec,
} from "@drobek-bot/core";

import { DockerComputer } from "./computer.js";
import {
  createDockerodeClient,
  type ContainerSummary,
  type DockerClient,
} from "./docker-client.js";
import {
  BOX_HOME,
  boxLabels,
  containerName,
  isManaged,
  managedFilter,
  parseBotId,
  volumeName,
} from "./names.js";

/**
 * The Docker implementation of `ComputerProvider`: one container and one named
 * volume per bot, started straight through the host's Docker socket.
 *
 * The app is trusted and the boxes are not — the trust boundary is never the
 * app against the host. That is exactly why every lookup here goes through the
 * labels: the process holding this socket can stop anything on the machine, so
 * a container that merely carries the expected name is refused, loudly, rather
 * than touched.
 */

/** PID 1 of a box: the container exists so commands can be executed in it. */
const IDLE_COMMAND = ["tail", "-f", "/dev/null"];

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface DockerComputerProviderOptions {
  /** Defaults to the daemon dockerode finds: `DOCKER_HOST`, else the local socket. */
  readonly client?: DockerClient;
}

/**
 * This bot's box, or `undefined`. Throws `not-managed` when the name is taken
 * by a container this app did not create — including one carrying the labels
 * of a different bot.
 */
async function findManaged(
  client: DockerClient,
  botId: string,
): Promise<ContainerSummary | undefined> {
  const name = containerName(botId);
  const managed = await client.listContainers({ label: managedFilter(botId) });
  const ours = managed.find((found) => found.name === name && isManaged(found.labels, botId));
  if (ours !== undefined) return ours;
  const byName = await client.listContainers({ name: [`^/${name}$`] });
  if (byName.some((found) => found.name === name)) throw new ComputerError("not-managed", name);
  return undefined;
}

/**
 * `NAME=value` entries for the box. The caller is meant to pass `buildBoxEnv`
 * output; this is the second line of defence, so that a master key or a
 * database URL cannot reach a box even by mistake.
 */
function toEnvEntries(env: Readonly<Record<string, string>>): string[] {
  const entries: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (isDeniedBoxEnvName(name)) throw new ComputerError("denied-env", name);
    if (!ENV_NAME_PATTERN.test(name)) {
      throw new ComputerError("invalid-spec", "not an environment variable name");
    }
    entries.push(`${name}=${value}`);
  }
  return entries;
}

/** The home volume first; a colon in a path would smuggle extra mount options. */
function toBinds(botId: string, binds: readonly ComputerBind[] | undefined): string[] {
  const entries = [`${volumeName(botId)}:${BOX_HOME}`];
  for (const bind of binds ?? []) {
    if (!bind.hostPath.startsWith("/") || !bind.boxPath.startsWith("/")) {
      throw new ComputerError("invalid-spec", "bind paths must be absolute");
    }
    if (bind.hostPath.includes(":") || bind.boxPath.includes(":")) {
      throw new ComputerError("invalid-spec", "bind paths may not contain a colon");
    }
    if (bind.boxPath === BOX_HOME) {
      throw new ComputerError("invalid-spec", `a bind may not replace ${BOX_HOME}`);
    }
    entries.push(`${bind.hostPath}:${bind.boxPath}${bind.readOnly === true ? ":ro" : ""}`);
  }
  return entries;
}

/** Creates the bot's home volume, or checks that the one already there is ours. */
async function ensureVolume(client: DockerClient, botId: string): Promise<void> {
  const name = volumeName(botId);
  const existing = await client.inspectVolume(name);
  if (existing === undefined) {
    await client.createVolume(name, boxLabels(botId));
    return;
  }
  if (!isManaged(existing.labels, botId)) throw new ComputerError("not-managed", name);
}

export function createDockerComputerProvider(
  options: DockerComputerProviderOptions = {},
): ComputerProvider {
  const client = options.client ?? createDockerodeClient();

  return {
    async provision(spec: ComputerSpec): Promise<Computer> {
      const botId = parseBotId(spec.botId);
      if (spec.image.trim() === "") throw new ComputerError("invalid-spec", "image is empty");
      const env = toEnvEntries(spec.env);
      const binds = toBinds(botId, spec.binds);
      const existing = await findManaged(client, botId);
      await ensureVolume(client, botId);
      // The container is disposable and the spec is authoritative, so a box
      // that is already there is replaced. The home volume is not touched;
      // `reconnect` is the call that keeps a box as it is.
      if (existing !== undefined) await client.removeContainer(existing.id);
      const containerId = await client.createContainer({
        name: containerName(botId),
        image: spec.image,
        env,
        labels: boxLabels(botId),
        binds,
        command: IDLE_COMMAND,
      });
      await client.startContainer(containerId);
      return new DockerComputer(client, botId, containerId);
    },

    async reconnect(id: string): Promise<Computer | undefined> {
      const botId = parseBotId(id);
      const found = await findManaged(client, botId);
      if (found === undefined) return undefined;
      // Unconditionally, never gated on the listing's `running` flag: that
      // flag is a snapshot, and a container on its way down still reads as
      // running. Starting an already-running container is a no-op (304), and
      // it is the only way the caller gets a box that is actually up.
      await client.startContainer(found.id);
      return new DockerComputer(client, botId, found.id);
    },

    async stop(id: string): Promise<void> {
      const botId = parseBotId(id);
      const found = await findManaged(client, botId);
      if (found === undefined) return;
      // Same reason as `reconnect`: stopping an already-stopped container is
      // a no-op (304), and the flag cannot be trusted to say which it is.
      await client.stopContainer(found.id);
    },

    async destroy(id: string): Promise<void> {
      const botId = parseBotId(id);
      // Both are checked before either is removed: a hard delete must not take
      // half of something that is not ours.
      const found = await findManaged(client, botId);
      const volume = await client.inspectVolume(volumeName(botId));
      if (volume !== undefined && !isManaged(volume.labels, botId)) {
        throw new ComputerError("not-managed", volume.name);
      }
      if (found !== undefined) await client.removeContainer(found.id);
      if (volume !== undefined) await client.removeVolume(volume.name);
    },
  };
}
