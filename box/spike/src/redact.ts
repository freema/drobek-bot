/**
 * Last line of defence against a secret reaching stdout or a log file. Pure.
 */

const ANTHROPIC_KEY_PATTERN = /sk-ant-[A-Za-z0-9_-]{16,}/g;

export const REDACTED = "[REDACTED]";

export type Redaction = { text: string; redacted: boolean };

/** Replaces every occurrence of `secret` and anything shaped like an Anthropic key. */
export function redactSecrets(text: string, secret: string | undefined): Redaction {
  let out = text;
  let redacted = false;
  if (secret !== undefined && secret.length > 0 && out.includes(secret)) {
    out = out.split(secret).join(REDACTED);
    redacted = true;
  }
  if (ANTHROPIC_KEY_PATTERN.test(out)) {
    out = out.replace(ANTHROPIC_KEY_PATTERN, REDACTED);
    redacted = true;
  }
  ANTHROPIC_KEY_PATTERN.lastIndex = 0;
  return { text: out, redacted };
}
