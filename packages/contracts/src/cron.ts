/**
 * Structural validation of five-field cron expressions, without a dependency.
 *
 * A field is `*`, a number, a range `a-b`, a step (`*` or a range followed
 * by `/n`), or a comma-separated list of those. Names (`MON`, `JAN`) and macros (`@daily`)
 * are not accepted. Numbers must fall in the field's bounds: minute 0-59,
 * hour 0-23, day of month 1-31, month 1-12, day of week 0-7 (0 and 7 are
 * both Sunday).
 */

const FIELD_BOUNDS: readonly (readonly [number, number])[] = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
];

function isNumberIn(text: string, min: number, max: number): boolean {
  if (!/^\d+$/.test(text)) return false;
  const value = Number(text);
  return value >= min && value <= max;
}

function isValidItem(item: string, min: number, max: number): boolean {
  const [base, step, ...rest] = item.split("/");
  if (base === undefined || rest.length > 0) return false;
  if (step !== undefined && (!/^\d+$/.test(step) || Number(step) < 1)) return false;
  if (base === "*") return true;
  if (base.includes("-")) {
    const [from, to, ...more] = base.split("-");
    if (from === undefined || to === undefined || more.length > 0) return false;
    return isNumberIn(from, min, max) && isNumberIn(to, min, max) && Number(from) <= Number(to);
  }
  // A step needs a range or `*` in front of it.
  if (step !== undefined) return false;
  return isNumberIn(base, min, max);
}

/** True when `expression` has five valid fields separated by whitespace. */
export function isValidCron(expression: string): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== FIELD_BOUNDS.length) return false;
  return fields.every((field, index) => {
    const bounds = FIELD_BOUNDS[index];
    if (bounds === undefined || field.length === 0) return false;
    const [min, max] = bounds;
    return field.split(",").every((item) => isValidItem(item, min, max));
  });
}
