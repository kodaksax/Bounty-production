/**
 * Unit tests for auth-validation utilities, focused on email guards
 * introduced to detect improperly formatted / typo-ed email addresses.
 */

import {
  validateEmail,
  suggestEmailCorrection,
} from '../../../lib/utils/auth-validation';

describe('validateEmail', () => {
  it('accepts valid emails', () => {
    expect(validateEmail('user@gmail.com')).toBeNull();
    expect(validateEmail('first.last@example.org')).toBeNull();
    expect(validateEmail('user+tag@domain.co.uk')).toBeNull();
  });

  it('rejects empty / blank input', () => {
    expect(validateEmail('')).not.toBeNull();
    expect(validateEmail('   ')).not.toBeNull();
  });

  it('rejects missing @ symbol', () => {
    expect(validateEmail('nodomain.com')).not.toBeNull();
  });

  it('rejects missing TLD', () => {
    expect(validateEmail('user@domain')).not.toBeNull();
  });
});

describe('suggestEmailCorrection', () => {
  it('returns null for a correctly formatted common domain', () => {
    expect(suggestEmailCorrection('user@gmail.com')).toBeNull();
    expect(suggestEmailCorrection('hello@yahoo.com')).toBeNull();
    expect(suggestEmailCorrection('me@outlook.com')).toBeNull();
  });

  it('suggests correction for a TLD typo (gmail.comk → gmail.com)', () => {
    expect(suggestEmailCorrection('kcw.diy@gmail.comk')).toBe('kcw.diy@gmail.com');
  });

  it('suggests correction for a transposed-letter domain (gmuil.com → gmail.com)', () => {
    expect(suggestEmailCorrection('leewright093@gmuil.com')).toBe('leewright093@gmail.com');
  });

  it('suggests correction for other common one-character typos', () => {
    expect(suggestEmailCorrection('user@gmial.com')).toBe('user@gmail.com');
    expect(suggestEmailCorrection('user@yahooo.com')).toBe('user@yahoo.com');
    expect(suggestEmailCorrection('user@hotmial.com')).toBe('user@hotmail.com');
  });

  it('returns null for emails with no similar common domain', () => {
    expect(suggestEmailCorrection('user@mycompany.io')).toBeNull();
    expect(suggestEmailCorrection('dev@acme.co')).toBeNull();
  });

  it('preserves the original local part in the suggestion', () => {
    const suggestion = suggestEmailCorrection('John.Doe@gmuil.com');
    expect(suggestion).toBe('John.Doe@gmail.com');
  });

  it('returns null for input without @ symbol', () => {
    expect(suggestEmailCorrection('notanemail')).toBeNull();
    expect(suggestEmailCorrection('')).toBeNull();
  });
});
