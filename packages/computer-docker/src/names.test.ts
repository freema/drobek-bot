import { ComputerError } from "@drobek-bot/core";
import { describe, expect, it } from "vitest";

import {
  BOT_ID_LABEL,
  BOX_HOME,
  MANAGED_LABEL,
  boxLabels,
  containerName,
  isManaged,
  managedFilter,
  parseBotId,
  volumeName,
} from "./names.js";

/**
 * `names.ts` is exported public surface: the naming and labelling rules every
 * other part of the package (and the fakes other tests write) build on. These
 * are pure functions, tested directly.
 */

describe("containerName / volumeName", () => {
  it("derives the container name from the bot id", () => {
    expect(containerName("scout")).toBe("drobek-bot-box-scout");
  });

  it("derives the volume name from the bot id", () => {
    expect(volumeName("scout")).toBe("drobek-bot-home-scout");
  });

  it("names two bots differently", () => {
    expect(containerName("scout")).not.toBe(containerName("watcher"));
    expect(volumeName("scout")).not.toBe(volumeName("watcher"));
  });
});

describe("BOX_HOME", () => {
  it("is the bot's home directory inside the box", () => {
    expect(BOX_HOME).toBe("/home/bot");
  });
});

describe("boxLabels", () => {
  it("carries the managed flag and the bot id", () => {
    expect(boxLabels("scout")).toEqual({
      [MANAGED_LABEL]: "true",
      [BOT_ID_LABEL]: "scout",
    });
  });
});

describe("parseBotId", () => {
  it("accepts a valid slug and returns it unchanged", () => {
    expect(parseBotId("scout-2")).toBe("scout-2");
  });

  it.each(["Scout", "scout_1", "-scout", "scout-", "sc out", "", "a".repeat(65)])(
    "rejects %j as invalid-spec",
    (botId) => {
      let caught: unknown;
      try {
        parseBotId(botId);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ComputerError);
      expect(caught).toMatchObject({ kind: "invalid-spec" });
    },
  );
});

describe("isManaged", () => {
  it("is true when both the managed flag and the bot id label match", () => {
    expect(isManaged(boxLabels("scout"), "scout")).toBe(true);
  });

  it("is false with no labels at all", () => {
    expect(isManaged({}, "scout")).toBe(false);
  });

  it("is false when the bot id label names a different bot", () => {
    expect(isManaged(boxLabels("someone-else"), "scout")).toBe(false);
  });

  it("is false when the managed flag is missing", () => {
    expect(isManaged({ [BOT_ID_LABEL]: "scout" }, "scout")).toBe(false);
  });

  it("is false when the managed flag is not exactly the string true", () => {
    expect(isManaged({ [MANAGED_LABEL]: "yes", [BOT_ID_LABEL]: "scout" }, "scout")).toBe(false);
  });
});

describe("managedFilter", () => {
  it("is the label filter that finds only this bot's objects", () => {
    expect(managedFilter("scout")).toEqual([`${MANAGED_LABEL}=true`, `${BOT_ID_LABEL}=scout`]);
  });
});
