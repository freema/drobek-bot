/** The tools a bot declared in `requires` that the box does not have, in declaration order. */
export function missingTools(requires: readonly string[], available: readonly string[]): string[] {
  const present = new Set(available);
  return [...new Set(requires)].filter((tool) => !present.has(tool));
}
