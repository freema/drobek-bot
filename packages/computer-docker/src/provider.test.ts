import {
  BOX_ENV_DENIED_NAMES,
  BOX_ENV_DENIED_PREFIXES,
  isDeniedBoxEnvName,
  type ComputerBind,
} from "@drobek-bot/core";
import { describe, expect, it } from "vitest";

import type {
  ContainerSummary,
  CreateContainerInput,
  DockerClient,
  VolumeSummary,
} from "./docker-client.js";
import {
  BOT_ID_LABEL,
  BOX_HOME,
  MANAGED_LABEL,
  boxLabels,
  containerName,
  volumeName,
} from "./names.js";
import { createDockerComputerProvider } from "./provider.js";

/** A fake daemon: enough of the Docker API to drive the provider offline. */
interface FakeState {
  containers: ContainerSummary[];
  volumes: VolumeSummary[];
  created: CreateContainerInput[];
  removedContainers: string[];
  removedVolumes: string[];
  stopped: string[];
}

function createFake(state: FakeState): DockerClient {
  const notUsed = (): never => {
    throw new Error("the fake daemon does not execute commands");
  };
  return {
    listContainers: (filters) =>
      Promise.resolve(
        state.containers.filter((container) => {
          const byLabel = (filters.label ?? []).every((entry) => {
            const separator = entry.indexOf("=");
            return container.labels[entry.slice(0, separator)] === entry.slice(separator + 1);
          });
          const byName =
            filters.name === undefined ||
            filters.name.some((pattern) => new RegExp(pattern).test(`/${container.name}`));
          return byLabel && byName;
        }),
      ),
    createContainer: (input) => {
      state.created.push(input);
      state.containers.push({
        id: `id-${input.name}`,
        name: input.name,
        labels: input.labels,
        running: false,
      });
      return Promise.resolve(`id-${input.name}`);
    },
    // A real daemon flips `running` on start/stop; the fake mirrors that so a
    // provider that only calls `stopContainer` on a running box (idempotent
    // stop) can be driven and observed through this double.
    startContainer: (id) => {
      state.containers = state.containers.map((container) =>
        container.id === id ? { ...container, running: true } : container,
      );
      return Promise.resolve();
    },
    stopContainer: (id) => {
      state.stopped.push(id);
      state.containers = state.containers.map((container) =>
        container.id === id ? { ...container, running: false } : container,
      );
      return Promise.resolve();
    },
    removeContainer: (id) => {
      state.removedContainers.push(id);
      state.containers = state.containers.filter((container) => container.id !== id);
      return Promise.resolve();
    },
    inspectVolume: (name) => Promise.resolve(state.volumes.find((volume) => volume.name === name)),
    createVolume: (name, labels) => {
      state.volumes.push({ name, labels });
      return Promise.resolve();
    },
    removeVolume: (name) => {
      state.removedVolumes.push(name);
      state.volumes = state.volumes.filter((volume) => volume.name !== name);
      return Promise.resolve();
    },
    createExec: notUsed,
    startExec: notUsed,
    inspectExec: notUsed,
  };
}

function emptyState(): FakeState {
  return {
    containers: [],
    volumes: [],
    created: [],
    removedContainers: [],
    removedVolumes: [],
    stopped: [],
  };
}

describe("createDockerComputerProvider", () => {
  it("labels the container and the volume it creates", async () => {
    const state = emptyState();
    const provider = createDockerComputerProvider({ client: createFake(state) });

    await provider.provision({ botId: "scout", image: "drobek-bot-box", env: { TZ: "UTC" } });

    expect(state.created[0]).toMatchObject({
      name: containerName("scout"),
      labels: { [MANAGED_LABEL]: "true", [BOT_ID_LABEL]: "scout" },
      binds: [`${volumeName("scout")}:/home/bot`],
      env: ["TZ=UTC"],
    });
    expect(state.volumes).toEqual([
      { name: volumeName("scout"), labels: { [MANAGED_LABEL]: "true", [BOT_ID_LABEL]: "scout" } },
    ]);
  });

  it("refuses an environment name that must never reach a box, and creates nothing", async () => {
    const state = emptyState();
    const provider = createDockerComputerProvider({ client: createFake(state) });

    await expect(
      provider.provision({
        botId: "scout",
        image: "drobek-bot-box",
        env: { DATABASE_URL: "postgres://never" },
      }),
    ).rejects.toMatchObject({ kind: "denied-env" });
    expect(state.created).toEqual([]);
    expect(state.volumes).toEqual([]);
  });

  // `isDeniedBoxEnvName` in `@drobek-bot/core` is the source of truth for the
  // denylist; these cases are generated from it, not transcribed, so the test
  // tracks the list if it ever changes.
  const deniedEnvNames = [
    ...BOX_ENV_DENIED_NAMES,
    ...BOX_ENV_DENIED_PREFIXES.map((prefix) => `${prefix}EXAMPLE`),
  ];

  it.each(deniedEnvNames)(
    "refuses the denylisted environment name %s, and creates nothing",
    async (name) => {
      expect(isDeniedBoxEnvName(name)).toBe(true);
      const state = emptyState();
      const provider = createDockerComputerProvider({ client: createFake(state) });

      await expect(
        provider.provision({ botId: "scout", image: "drobek-bot-box", env: { [name]: "x" } }),
      ).rejects.toMatchObject({ kind: "denied-env" });
      expect(state.created).toEqual([]);
      expect(state.volumes).toEqual([]);
    },
  );

  it.each(["Scout", "scout_1", "-scout", "scout-", "sc out", ""])(
    "rejects the invalid bot id %j, and creates nothing",
    async (botId) => {
      const state = emptyState();
      const provider = createDockerComputerProvider({ client: createFake(state) });

      await expect(
        provider.provision({ botId, image: "drobek-bot-box", env: {} }),
      ).rejects.toMatchObject({ kind: "invalid-spec" });
      expect(state.created).toEqual([]);
      expect(state.volumes).toEqual([]);
    },
  );

  const invalidBinds: Array<{ name: string; bind: ComputerBind }> = [
    { name: "a relative host path", bind: { hostPath: "relative/path", boxPath: "/mnt/data" } },
    { name: "a relative box path", bind: { hostPath: "/tmp/data", boxPath: "relative/data" } },
    { name: "a colon in the host path", bind: { hostPath: "/tmp/da:ta", boxPath: "/mnt/data" } },
    { name: "a colon in the box path", bind: { hostPath: "/tmp/data", boxPath: "/mnt/da:ta" } },
    {
      name: "a box path that replaces /home/bot",
      bind: { hostPath: "/tmp/data", boxPath: BOX_HOME },
    },
  ];

  it.each(invalidBinds)("rejects a bind spec with $name, and creates nothing", async ({ bind }) => {
    const state = emptyState();
    const provider = createDockerComputerProvider({ client: createFake(state) });

    await expect(
      provider.provision({ botId: "scout", image: "drobek-bot-box", env: {}, binds: [bind] }),
    ).rejects.toMatchObject({ kind: "invalid-spec" });
    expect(state.created).toEqual([]);
    expect(state.volumes).toEqual([]);
  });

  it("will not touch a container that has the name but not the labels", async () => {
    const state = emptyState();
    state.containers.push({
      id: "someone-elses",
      name: containerName("scout"),
      labels: {},
      running: true,
    });
    const provider = createDockerComputerProvider({ client: createFake(state) });

    await expect(provider.reconnect("scout")).rejects.toMatchObject({ kind: "not-managed" });
    await expect(provider.stop("scout")).rejects.toMatchObject({ kind: "not-managed" });
    await expect(provider.destroy("scout")).rejects.toMatchObject({ kind: "not-managed" });
    expect(state.removedContainers).toEqual([]);
    expect(state.removedVolumes).toEqual([]);
    expect(state.stopped).toEqual([]);
    expect(state.containers).toEqual([
      { id: "someone-elses", name: containerName("scout"), labels: {}, running: true },
    ]);
  });

  it("will not touch a container that carries a different bot's id label", async () => {
    const state = emptyState();
    state.containers.push({
      id: "someone-elses",
      name: containerName("scout"),
      labels: boxLabels("someone-else"),
      running: true,
    });
    const provider = createDockerComputerProvider({ client: createFake(state) });

    await expect(provider.reconnect("scout")).rejects.toMatchObject({ kind: "not-managed" });
    await expect(provider.stop("scout")).rejects.toMatchObject({ kind: "not-managed" });
    await expect(provider.destroy("scout")).rejects.toMatchObject({ kind: "not-managed" });
    expect(state.removedContainers).toEqual([]);
    expect(state.removedVolumes).toEqual([]);
    expect(state.stopped).toEqual([]);
  });

  it("stops the container and keeps its volume", async () => {
    const state = emptyState();
    const provider = createDockerComputerProvider({ client: createFake(state) });
    await provider.provision({ botId: "scout", image: "drobek-bot-box", env: {} });

    await provider.stop("scout");

    expect(state.stopped).toEqual([`id-${containerName("scout")}`]);
    expect(state.removedContainers).toEqual([]);
    expect(state.removedVolumes).toEqual([]);
    expect(state.volumes).toEqual([
      { name: volumeName("scout"), labels: { [MANAGED_LABEL]: "true", [BOT_ID_LABEL]: "scout" } },
    ]);
  });

  it("destroy removes both the container and its volume", async () => {
    const state = emptyState();
    const provider = createDockerComputerProvider({ client: createFake(state) });
    await provider.provision({ botId: "scout", image: "drobek-bot-box", env: {} });

    await provider.destroy("scout");

    expect(state.removedContainers).toEqual([`id-${containerName("scout")}`]);
    expect(state.removedVolumes).toEqual([volumeName("scout")]);
    expect(state.containers).toEqual([]);
    expect(state.volumes).toEqual([]);
  });

  it("reconnect finds the box again after stop, with its volume intact", async () => {
    const state = emptyState();
    const provider = createDockerComputerProvider({ client: createFake(state) });
    await provider.provision({ botId: "scout", image: "drobek-bot-box", env: {} });
    await provider.stop("scout");

    const reconnected = await provider.reconnect("scout");

    expect(reconnected).toBeDefined();
    expect(reconnected?.id).toBe("scout");
    expect(state.volumes).toEqual([
      { name: volumeName("scout"), labels: { [MANAGED_LABEL]: "true", [BOT_ID_LABEL]: "scout" } },
    ]);
  });

  it("reconnect resolves to undefined for a bot that was never provisioned", async () => {
    const state = emptyState();
    const provider = createDockerComputerProvider({ client: createFake(state) });

    expect(await provider.reconnect("never-seen")).toBeUndefined();
  });

  it("stop and destroy are no-ops when there is no box", async () => {
    const state = emptyState();
    const provider = createDockerComputerProvider({ client: createFake(state) });

    await expect(provider.stop("never-seen")).resolves.toBeUndefined();
    await expect(provider.destroy("never-seen")).resolves.toBeUndefined();
    expect(state.stopped).toEqual([]);
    expect(state.removedContainers).toEqual([]);
    expect(state.removedVolumes).toEqual([]);
  });
});
