import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { REPO_ROOT } from "./repo.js";

/**
 * The public README, setup prompt, llms.txt and every docs page must read as
 * a neutral, self-hosted tool: no regional or regulatory positioning. This
 * scans each target file line by line so a violation is reported as
 * file:line:match, and self-checks its own detector against a positive
 * sample (all three terms) and a set of near-miss strings that must not
 * fire, so a broken pattern fails loudly instead of silently passing
 * everything.
 */

interface PositioningTerm {
  readonly label: string;
  readonly pattern: RegExp;
}

// "EU" is matched as a case-sensitive whole word so it does not fire on
// "Europe" or "EUR". GDPR and "AI Act" are matched case-insensitively; "AI
// Act" requires exactly one space between the two words.
const POSITIONING_TERMS: readonly PositioningTerm[] = [
  { label: "EU", pattern: /\bEU\b/ },
  { label: "GDPR", pattern: /\bGDPR\b/i },
  { label: "AI Act", pattern: /\bAI Act\b/i },
];

interface PositioningHit {
  readonly line: number;
  readonly match: string;
}

function scanForPositioningTerms(text: string): PositioningHit[] {
  const hits: PositioningHit[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((lineText, index) => {
    for (const term of POSITIONING_TERMS) {
      const globalPattern = new RegExp(term.pattern.source, `${term.pattern.flags}g`);
      for (const found of lineText.matchAll(globalPattern)) {
        hits.push({ line: index + 1, match: found[0] });
      }
    }
  });
  return hits;
}

function collectMarkdownFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(fullPath);
    }
  }
  return results;
}

function promoTargetFiles(): string[] {
  const topLevel = ["README.md", "SETUP_PROMPT.md", "llms.txt"].map((name) =>
    path.join(REPO_ROOT, name),
  );
  const docs = collectMarkdownFiles(path.join(REPO_ROOT, "docs"));
  return [...topLevel, ...docs];
}

describe("promo text carries no regional or regulatory positioning", () => {
  const targetFiles = promoTargetFiles();

  it("finds at least one promo file to scan", () => {
    expect(targetFiles.length).toBeGreaterThan(0);
  });

  for (const absolutePath of targetFiles) {
    const relativePath = path.relative(REPO_ROOT, absolutePath);
    it(`${relativePath} contains no EU/GDPR/AI Act positioning`, () => {
      const hits = scanForPositioningTerms(readFileSync(absolutePath, "utf8"));
      const report = hits.map((hit) => `${relativePath}:${hit.line}: "${hit.match}"`).join("\n");
      expect(hits, `forbidden positioning term(s) found:\n${report}`).toHaveLength(0);
    });
  }

  it("detector fires on each forbidden term and ignores near-miss text", () => {
    const positive = "Hosted in the EU, compliant with GDPR and ready for the AI Act.";
    const positiveMatches = scanForPositioningTerms(positive).map((hit) => hit.match);
    expect(positiveMatches).toContain("EU");
    expect(positiveMatches).toContain("GDPR");
    expect(positiveMatches).toContain("AI Act");

    for (const nearMiss of ["Europe/Prague", "neutral", "bureau"]) {
      expect(scanForPositioningTerms(nearMiss)).toHaveLength(0);
    }
  });
});
