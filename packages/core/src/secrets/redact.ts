/**
 * Redaction of secret values from text and from event payloads: the last line
 * of defence before anything is written to a transcript, an event or a log.
 * Pure; the values a redactor holds never leave it.
 */

export interface RedactorSecret {
  readonly name: string;
  readonly value: string;
}

export interface Redactor {
  /** `text` with every form of every value replaced by `[REDACTED:<name>]`. */
  redactText(text: string): string;
  /**
   * A copy of `value` with every string inside it (object values and keys,
   * array items, at any depth) passed through `redactText`; the input is not
   * mutated. Anything that is not a string, an array or a plain object is
   * returned as is.
   */
  redactValue(value: unknown): unknown;
}

interface Pattern {
  readonly form: string;
  readonly token: string;
}

/** The marker a value is replaced with. */
export function redactionToken(name: string): string {
  return `[REDACTED:${name}]`;
}

/** The value itself and the encodings it commonly travels in. */
function formsOf(value: string): string[] {
  const forms = new Set<string>([
    value,
    JSON.stringify(value).slice(1, -1),
    Buffer.from(value, "utf8").toString("base64"),
  ]);
  try {
    forms.add(encodeURIComponent(value));
  } catch {
    // A lone surrogate has no URL form; the other forms still apply.
  }
  forms.delete("");
  return [...forms];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Longest forms first, so a value contained in another value is handled by the longer one. */
export function createRedactor(secrets: readonly RedactorSecret[]): Redactor {
  const patterns: Pattern[] = secrets
    .filter((secret) => secret.value.length > 0)
    .flatMap((secret) =>
      formsOf(secret.value).map((form) => ({ form, token: redactionToken(secret.name) })),
    )
    .sort((a, b) => b.form.length - a.form.length);

  const redactText = (text: string): string => {
    let out = text;
    for (const { form, token } of patterns) {
      if (out.includes(form)) out = out.split(form).join(token);
    }
    return out;
  };

  const walk = (value: unknown, seen: Map<object, unknown>): unknown => {
    if (typeof value === "string") return redactText(value);
    if (Array.isArray(value)) {
      const existing = seen.get(value);
      if (existing !== undefined) return existing;
      const copy: unknown[] = [];
      seen.set(value, copy);
      for (const item of value) copy.push(walk(item, seen));
      return copy;
    }
    if (isPlainObject(value)) {
      const existing = seen.get(value);
      if (existing !== undefined) return existing;
      const copy: Record<string, unknown> = {};
      seen.set(value, copy);
      for (const [key, item] of Object.entries(value)) copy[redactText(key)] = walk(item, seen);
      return copy;
    }
    return value;
  };

  return {
    redactText,
    redactValue: (value) => walk(value, new Map()),
  };
}
