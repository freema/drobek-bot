import type { Readable } from "node:stream";

import { ComputerError } from "@drobek-bot/core";
import Docker from "dockerode";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDockerodeClient } from "./docker-client.js";
import { containerName, volumeName } from "./names.js";
import { createDockerComputerProvider } from "./provider.js";

/**
 * The full lifecycle against a real daemon, on a small pinned public image
 * rather than the box image: building 1.09 GB to read one version string is a
 * bad trade, and what the box contains is measured in `box/README.md`. What is
 * proved here is the contract.
 */

const IMAGE = "alpine:3.21";
const BOT_ID = "smoke-lifecycle";
const FOREIGN_BOT_ID = "smoke-foreign";

const docker = new Docker();
const provider = createDockerComputerProvider({ client: createDockerodeClient() });

async function pull(reference: string): Promise<void> {
  const stream: NodeJS.ReadableStream = await docker.pull(reference);
  await new Promise<void>((resolve, reject) => {
    stream.on("data", () => undefined);
    stream.on("end", () => resolve());
    stream.on("error", (error: Error) => reject(error));
  });
}

async function removeQuietly(botId: string): Promise<void> {
  await docker
    .getContainer(containerName(botId))
    .remove({ force: true })
    .catch(() => undefined);
  await docker
    .getVolume(volumeName(botId))
    .remove()
    .catch(() => undefined);
}

function readAll(readable: Readable): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    readable.on("data", (chunk: unknown) => {
      if (Buffer.isBuffer(chunk)) chunks.push(chunk);
    });
    readable.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    readable.on("error", (error: Error) => reject(error));
  });
}

describe("docker computer provider", () => {
  beforeAll(async () => {
    await pull(IMAGE);
    await removeQuietly(BOT_ID);
    await removeQuietly(FOREIGN_BOT_ID);
  });

  afterAll(async () => {
    await removeQuietly(BOT_ID);
    await removeQuietly(FOREIGN_BOT_ID);
  });

  it("provisions, keeps files across a stop, and leaves nothing after destroy", async () => {
    const computer = await provider.provision({
      botId: BOT_ID,
      image: IMAGE,
      env: { DROBEK_SMOKE: "ok" },
    });

    const echo = await computer.runCommand(["sh", "-c", "echo $DROBEK_SMOKE"]);
    expect(echo).toMatchObject({ exitCode: 0, stdout: "ok\n" });

    const bytes = new Uint8Array([0x68, 0x69, 0x0a]);
    await computer.writeFile("/home/bot/hello.txt", bytes);
    expect(await computer.readFile("/home/bot/hello.txt")).toEqual(Buffer.from(bytes));
    expect(await computer.listFiles("/home/bot")).toContainEqual({
      path: "/home/bot/hello.txt",
      kind: "file",
      size: 3,
    });

    const attached = await computer.attach(["cat"]);
    attached.stdin.end("ping\n");
    expect(await readAll(attached.stdout)).toBe("ping\n");
    expect(await attached.wait()).toBe(0);

    await provider.stop(BOT_ID);
    const again = await provider.reconnect(BOT_ID);
    expect(again).toBeDefined();
    expect(await again?.readFile("/home/bot/hello.txt")).toEqual(Buffer.from(bytes));

    await provider.destroy(BOT_ID);
    expect(await provider.reconnect(BOT_ID)).toBeUndefined();
    await expect(docker.getVolume(volumeName(BOT_ID)).inspect()).rejects.toThrow();
  });

  it("refuses a container that carries the name but not the labels", async () => {
    const foreign = await docker.createContainer({
      name: containerName(FOREIGN_BOT_ID),
      Image: IMAGE,
      Entrypoint: [],
      Cmd: ["tail", "-f", "/dev/null"],
    });
    await foreign.start();

    await expect(provider.reconnect(FOREIGN_BOT_ID)).rejects.toThrow(ComputerError);
    await expect(provider.stop(FOREIGN_BOT_ID)).rejects.toThrow(ComputerError);
    await expect(provider.destroy(FOREIGN_BOT_ID)).rejects.toThrow(ComputerError);

    const still = await docker.getContainer(containerName(FOREIGN_BOT_ID)).inspect();
    expect(still.State.Running).toBe(true);
  });

  it("refuses an environment name that must never reach a box", async () => {
    await expect(
      provider.provision({
        botId: BOT_ID,
        image: IMAGE,
        env: { DROBEK_MASTER_KEY: "never" },
      }),
    ).rejects.toMatchObject({ kind: "denied-env" });
  });
});
