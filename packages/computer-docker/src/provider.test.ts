import { describe, expect, it } from "vitest";

import type {
  ContainerSummary,
  CreateContainerInput,
  DockerClient,
  VolumeSummary,
} from "./docker-client.js";
import { BOT_ID_LABEL, MANAGED_LABEL, containerName, volumeName } from "./names.js";
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
    startContainer: () => Promise.resolve(),
    stopContainer: (id) => {
      state.stopped.push(id);
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
    expect(state.stopped).toEqual([]);
  });
});
