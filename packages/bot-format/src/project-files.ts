import type {
  BotIdentity,
  ClaudeMcpConfig,
  ClaudeMcpServer,
  ClaudeMcpStdioServer,
  ClaudeSettings,
  ResolvedMcp,
} from "@drobek-bot/contracts";

import type { LoadedBot } from "./types.js";

export interface ProjectFile {
  /** Relative to the box project directory, POSIX separators. */
  readonly path: string;
  readonly content: string;
}

export interface ClaudeProjectOptions {
  /** Pins a different model than the manifest names, e.g. Haiku for a test run. */
  readonly model?: string;
  /** Servers the host adds for the run (the browser over CDP); they win over the bot's on a name clash. */
  readonly mcpServers?: Readonly<Record<string, ClaudeMcpServer>>;
}

export type ClaudeProjectInput = Pick<
  LoadedBot,
  "identity" | "systemPrompt" | "manifest" | "mcp" | "skills"
>;

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** `CLAUDE.md`: the identity as a header, then the BOT.md body verbatim. */
export function toClaudeMd(identity: BotIdentity, systemPrompt: string): string {
  return `# ${identity.name}\n\nJob: ${identity.job}\nLanguage: ${identity.language}\n\n${systemPrompt}\n`;
}

/** The resolved `mcp` map in the shape Claude Code reads from `.mcp.json`. */
export function toClaudeMcpServers(mcp: ResolvedMcp): Record<string, ClaudeMcpServer> {
  const servers: Record<string, ClaudeMcpServer> = {};
  for (const [name, server] of Object.entries(mcp)) {
    if ("url" in server) {
      servers[name] = { type: server.type ?? "http", url: server.url };
      continue;
    }
    const stdio: ClaudeMcpStdioServer = { command: server.command };
    servers[name] =
      server.args === undefined && server.env === undefined
        ? stdio
        : server.env === undefined
          ? { ...stdio, args: server.args }
          : server.args === undefined
            ? { ...stdio, env: server.env }
            : { ...stdio, args: server.args, env: server.env };
  }
  return servers;
}

/**
 * The files the box project gets from a bot folder: `CLAUDE.md`,
 * `.claude/settings.json` (the model pin), one `.claude/skills/<name>/SKILL.md`
 * per skill, and `.mcp.json` when there is at least one server.
 */
export function toClaudeProjectFiles(
  bot: ClaudeProjectInput,
  options: ClaudeProjectOptions = {},
): ProjectFile[] {
  const settings: ClaudeSettings = { model: options.model ?? bot.manifest.model };
  const files: ProjectFile[] = [
    { path: "CLAUDE.md", content: toClaudeMd(bot.identity, bot.systemPrompt) },
    { path: ".claude/settings.json", content: json(settings) },
    ...bot.skills.map((skill) => ({
      path: `.claude/skills/${skill.name}/SKILL.md`,
      content: skill.text,
    })),
  ];
  const mcpServers = { ...toClaudeMcpServers(bot.mcp), ...options.mcpServers };
  if (Object.keys(mcpServers).length > 0) {
    const config: ClaudeMcpConfig = { mcpServers };
    files.push({ path: ".mcp.json", content: json(config) });
  }
  return files;
}
