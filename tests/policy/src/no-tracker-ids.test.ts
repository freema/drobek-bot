import { execFileSync } from "node:child_process";
import { closeSync, openSync, readFileSync, readSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { REPO_ROOT } from "./repo.js";

/**
 * AGENTS.md, "No tracker references": issue tracker IDs must never appear
 * anywhere in this repository. A tracker ID is the tracker's three-letter
 * prefix, a hyphen and one or more digits, as a whole word. The prefix is
 * assembled at runtime from its individual letters (and, in the self-check
 * below, so are the sample and near-miss strings) so this file never
 * contains the literal prefix as contiguous text.
 */

const TRACKER_LETTERS: readonly string[] = ["N", "S", "O"];
const TRACKER_PREFIX = TRACKER_LETTERS.join("");
const TRACKER_ID_PATTERN = new RegExp(`\\b${TRACKER_PREFIX}-\\d+\\b`);

const BINARY_PROBE_BYTES = 8192;

/** A file is treated as binary if its first 8 KB contains a NUL byte. */
function isBinary(absolutePath: string): boolean {
  const fd = openSync(absolutePath, "r");
  try {
    const buffer = Buffer.alloc(BINARY_PROBE_BYTES);
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).includes(0);
  } finally {
    closeSync(fd);
  }
}

function repositoryFiles(): string[] {
  const output = execFileSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8" });
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((relativePath) => path.basename(relativePath) !== "pnpm-lock.yaml");
}

interface TrackerHit {
  readonly file: string;
  readonly line: number;
  readonly match: string;
}

function findTrackerIdHits(): TrackerHit[] {
  const hits: TrackerHit[] = [];
  for (const relativePath of repositoryFiles()) {
    const absolutePath = path.join(REPO_ROOT, relativePath);
    if (isBinary(absolutePath)) {
      continue;
    }
    const lines = readFileSync(absolutePath, "utf8").split(/\r?\n/);
    lines.forEach((lineText, index) => {
      const globalPattern = new RegExp(TRACKER_ID_PATTERN.source, "g");
      for (const found of lineText.matchAll(globalPattern)) {
        hits.push({ file: relativePath, line: index + 1, match: found[0] });
      }
    });
  }
  return hits;
}

describe("no tracker IDs anywhere in the repository", () => {
  it("finds no tracker ID in any tracked, non-binary file", () => {
    const hits = findTrackerIdHits();
    const report = hits.map((hit) => `${hit.file}:${hit.line}: ${hit.match}`).join("\n");
    expect(hits, `tracker ID(s) found:\n${report}`).toHaveLength(0);
  });

  it("detector fires on a constructed sample and ignores near-miss text", () => {
    const sample = `${TRACKER_LETTERS.join("")}-123`;
    expect(sample).toMatch(TRACKER_ID_PATTERN);

    const missingLetter = `${TRACKER_LETTERS.slice(1).join("")}-2`;
    const missingHyphen = `${TRACKER_LETTERS.join("")}2`;
    const embeddedPrefix = `x${TRACKER_LETTERS.join("")}-`;

    for (const nearMiss of [missingLetter, missingHyphen, embeddedPrefix]) {
      expect(nearMiss).not.toMatch(TRACKER_ID_PATTERN);
    }
  });
});
