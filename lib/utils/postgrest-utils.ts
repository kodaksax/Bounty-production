// Utilities for preparing values embedded in PostgREST textual filters
// (for example, values used inside `.or(...)` expressions).

/**
 * Escape characters that are special in SQL ILIKE patterns so user input
 * like `50%` or `a_b` doesn't create unintended pattern matches.
 */
export function escapeIlike(input: string): string {
  return (
    String(input)
      .replace(/\\/g, '\\\\')
      // Do not escape double quotes here. Quoting/escaping for PostgREST
      // textual filters is the responsibility of `quotePostgrestValue` below.
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_')
  );
}

/**
 * Quote a value for embedding in PostgREST textual filters such as `.or(...)`.
 * PostgREST splits conditions on commas and recognizes parentheses, so values
 * containing those characters must be wrapped in double quotes. This helper
 * also escapes any double quotes inside the value.
 */
export function quotePostgrestValue(value: string): string {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}
