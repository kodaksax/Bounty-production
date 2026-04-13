/* eslint-env jest */
import { escapeIlike, quotePostgrestValue } from 'lib/utils/postgrest-utils';

describe('postgrest-utils', () => {
  test('escapeIlike does not escape double quotes', () => {
    expect(escapeIlike('a"b')).toBe('a"b');
  });

  test('quotePostgrestValue escapes double quotes once after escapeIlike', () => {
    const input = 'a"b';
    const pattern = `%${escapeIlike(input)}%`;
    expect(quotePostgrestValue(pattern)).toBe(`"%a\\"b%"`);
  });
});
