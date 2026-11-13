const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True for a real row/user id. Guards PostgREST filters on uuid columns: a
 * placeholder such as 'current-user' in `.eq('user_id', …)` is a 400 from
 * Postgres (invalid input syntax for type uuid), not an empty result.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}
