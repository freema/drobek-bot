import { slugSchema } from "@drobek-bot/contracts";
import { ComputerError } from "@drobek-bot/core";

/**
 * Names and labels for the Docker objects a bot's box is made of.
 *
 * The labels are the safety catch. The app holds the host's Docker socket, so
 * a container that merely has the right name is not ours; only the labels say
 * so, and every operation checks them before it touches anything.
 */

export const MANAGED_LABEL = "drobek-bot.managed";
export const BOT_ID_LABEL = "drobek-bot.bot-id";

/** The bot's home, a named volume so it survives the container. */
export const BOX_HOME = "/home/bot";

/** `<botId>` as a valid bot id, or `invalid-spec`. */
export function parseBotId(botId: string): string {
  const parsed = slugSchema.safeParse(botId);
  if (!parsed.success) throw new ComputerError("invalid-spec", "bot id must be a slug");
  return parsed.data;
}

export function containerName(botId: string): string {
  return `drobek-bot-box-${botId}`;
}

export function volumeName(botId: string): string {
  return `drobek-bot-home-${botId}`;
}

/** The labels every container and volume this package creates carries. */
export function boxLabels(botId: string): Record<string, string> {
  return { [MANAGED_LABEL]: "true", [BOT_ID_LABEL]: botId };
}

/** True only for an object this app created for this bot. */
export function isManaged(labels: Readonly<Record<string, string>>, botId: string): boolean {
  return labels[MANAGED_LABEL] === "true" && labels[BOT_ID_LABEL] === botId;
}

/** The label filter that finds this bot's objects through the Docker API. */
export function managedFilter(botId: string): string[] {
  return [`${MANAGED_LABEL}=true`, `${BOT_ID_LABEL}=${botId}`];
}
