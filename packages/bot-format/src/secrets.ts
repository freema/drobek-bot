/**
 * The secret rule: no bot file may contain anything shaped like a credential.
 * Matches are reported by kind and position; the matched text itself is not
 * returned beyond a short prefix, so a report never carries the secret.
 */

export type SecretKind =
  | "anthropic-api-key"
  | "secret-key"
  | "github-token"
  | "gitlab-token"
  | "aws-access-key-id"
  | "slack-token"
  | "private-key";

export interface SecretLikeMatch {
  readonly kind: SecretKind;
  /** 1-based. */
  readonly line: number;
  /** 1-based. */
  readonly column: number;
  /** The first characters of the match, enough to recognise it and nothing more. */
  readonly preview: string;
}

const PREVIEW_LENGTH = 7;

interface SecretPattern {
  readonly kind: SecretKind;
  readonly pattern: RegExp;
}

const SECRET_PATTERNS: readonly SecretPattern[] = [
  { kind: "anthropic-api-key", pattern: /\bsk-ant-[A-Za-z0-9_-]{8,}/g },
  { kind: "secret-key", pattern: /\bsk-[A-Za-z0-9_-]{20,}/g },
  { kind: "github-token", pattern: /\bghp_[A-Za-z0-9]{8,}/g },
  { kind: "github-token", pattern: /\bgithub_pat_[A-Za-z0-9_]{8,}/g },
  { kind: "gitlab-token", pattern: /\bglpat-[A-Za-z0-9_-]{8,}/g },
  { kind: "aws-access-key-id", pattern: /\bAKIA[A-Z0-9]{16}\b/g },
  { kind: "slack-token", pattern: /\bxox[bp]-[A-Za-z0-9-]{8,}/g },
  { kind: "private-key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
];

/** Every secret-shaped string in `text`, in document order. */
export function findSecretLikeStrings(text: string): SecretLikeMatch[] {
  const matches: SecretLikeMatch[] = [];
  text.split(/\r?\n/).forEach((lineText, index) => {
    for (const { kind, pattern } of SECRET_PATTERNS) {
      for (const found of lineText.matchAll(pattern)) {
        matches.push({
          kind,
          line: index + 1,
          column: found.index + 1,
          preview: `${found[0].slice(0, PREVIEW_LENGTH)}...`,
        });
      }
    }
  });
  // An Anthropic key also matches the generic `sk-` pattern; keep the specific hit only.
  return matches
    .filter(
      (match) =>
        match.kind !== "secret-key" ||
        !matches.some(
          (other) =>
            other.kind === "anthropic-api-key" &&
            other.line === match.line &&
            other.column === match.column,
        ),
    )
    .sort((a, b) => a.line - b.line || a.column - b.column);
}
