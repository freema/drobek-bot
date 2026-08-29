import type {
  BotIdentity,
  BotManifest,
  ResolvedMcp,
  SkillFrontmatter,
} from "@drobek-bot/contracts";

export interface LoadedSkill {
  /** The folder name, which the frontmatter `name` must equal. */
  readonly name: string;
  /** `skills/<name>/SKILL.md`, relative to the bot folder. */
  readonly file: string;
  readonly frontmatter: SkillFrontmatter;
  readonly body: string;
  /** The file verbatim; this is what goes into the box. */
  readonly text: string;
}

export interface MemoryInfo {
  /** Absolute path of `memory/`, whether or not it exists. */
  readonly path: string;
  readonly exists: boolean;
}

/** A bot folder, read and validated. */
export interface LoadedBot {
  /** The folder name. */
  readonly slug: string;
  /** Absolute path of the folder. */
  readonly dir: string;
  readonly identity: BotIdentity;
  /** The body of `BOT.md`. */
  readonly systemPrompt: string;
  readonly manifest: BotManifest;
  /** `manifest.mcp` with catalog references expanded. */
  readonly mcp: ResolvedMcp;
  readonly skills: readonly LoadedSkill[];
  readonly memory: MemoryInfo;
}
