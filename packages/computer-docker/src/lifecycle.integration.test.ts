import type { Readable } from "node:stream";

import { ComputerError } from "@drobek-bot/core";
import Docker from "dockerode";
import { beforeAll, describe, expect, it, onTestFinished } from "vitest";

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
// Unique per run, and combined with a per-test label below, unique per test:
// a leftover from an earlier (e.g. interrupted) run, or from another test in
// this run, can never make a test pass or fail spuriously.
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

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

/**
 * A bot id unique to this test, and registers its cleanup so the container
 * and volume are gone whether the test passes or fails — no test relies on
 * another test's teardown, and one test's crash cannot fail a different test.
 */
function botIdForThisTest(label: string): string {
  const botId = `smoke-${label}-${RUN_ID}`;
  onTestFinished(() => removeQuietly(botId));
  return botId;
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
  });

  it("provisions, keeps files across a stop, and leaves nothing after destroy", async () => {
    const botId = botIdForThisTest("lifecycle");

    const computer = await provider.provision({
      botId,
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

    await provider.stop(botId);
    const again = await provider.reconnect(botId);
    expect(again).toBeDefined();
    expect(await again?.readFile("/home/bot/hello.txt")).toEqual(Buffer.from(bytes));

    await provider.destroy(botId);
    expect(await provider.reconnect(botId)).toBeUndefined();
    await expect(docker.getVolume(volumeName(botId)).inspect()).rejects.toThrow();
  });

  it("refuses a container that carries the name but not the labels", async () => {
    const botId = botIdForThisTest("foreign");

    const foreign = await docker.createContainer({
      name: containerName(botId),
      Image: IMAGE,
      Entrypoint: [],
      Cmd: ["tail", "-f", "/dev/null"],
    });
    await foreign.start();

    await expect(provider.reconnect(botId)).rejects.toThrow(ComputerError);
    await expect(provider.stop(botId)).rejects.toThrow(ComputerError);
    await expect(provider.destroy(botId)).rejects.toThrow(ComputerError);

    const still = await docker.getContainer(containerName(botId)).inspect();
    expect(still.State.Running).toBe(true);
  });

  it("refuses an environment name that must never reach a box, and creates nothing", async () => {
    const botId = botIdForThisTest("denied-env");

    await expect(
      provider.provision({
        botId,
        image: IMAGE,
        env: { DROBEK_MASTER_KEY: "never" },
      }),
    ).rejects.toMatchObject({ kind: "denied-env" });

    await expect(docker.getContainer(containerName(botId)).inspect()).rejects.toThrow();
    await expect(docker.getVolume(volumeName(botId)).inspect()).rejects.toThrow();
  });

  it("stop and destroy are no-ops for a bot that was never provisioned", async () => {
    const botId = botIdForThisTest("absent");

    await expect(provider.stop(botId)).resolves.toBeUndefined();
    await expect(provider.destroy(botId)).resolves.toBeUndefined();
    expect(await provider.reconnect(botId)).toBeUndefined();
  });
});
