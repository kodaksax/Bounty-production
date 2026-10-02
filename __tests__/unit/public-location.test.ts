import cases from '../fixtures/public-location-label-cases.json';
import {
  formatPublicLocation,
  publicLocationLabel,
  publicNeighborhood,
} from '../../lib/utils/public-location';

// The same fixture is replayed against the SQL functions by
// scripts/verify-location-privacy.js, so these two implementations can't drift.
describe('publicLocationLabel (mirror of public.fn_public_location_label)', () => {
  it.each(cases.label.map((c) => [c.in, c.out] as const))('%j -> %j', (input, expected) => {
    expect(publicLocationLabel(input)).toBe(expected);
  });

  it('never returns a digit, # or a street-suffixed component', () => {
    for (const c of cases.label) {
      const out = publicLocationLabel(c.in);
      if (out == null) continue;
      expect(out).not.toMatch(/[0-9#]/);
      for (const part of out.split(', ')) {
        expect(part).not.toMatch(/\s(st|street|rd|road|ave|avenue|dr|drive|ln|lane)\.?$/i);
      }
    }
  });
});

describe('publicNeighborhood (mirror of public.fn_public_neighborhood)', () => {
  it.each(cases.neighborhood.map((c) => [c.in, c.out] as const))('%j -> %j', (input, expected) => {
    expect(publicNeighborhood(input)).toBe(expected);
  });
});

describe('formatPublicLocation', () => {
  it('combines neighborhood and city label', () => {
    expect(formatPublicLocation({ neighborhood: 'Fells Point', location: 'Baltimore, MD' })).toBe(
      'Fells Point · Baltimore, MD',
    );
  });

  it('does not repeat a neighborhood the label already starts with', () => {
    expect(formatPublicLocation({ neighborhood: 'Owings Mills', location: 'Owings Mills, MD' })).toBe(
      'Owings Mills, MD',
    );
  });

  it('strips a raw street address that reaches the client (cached pre-migration row)', () => {
    const out = formatPublicLocation({
      neighborhood: null,
      location: '1234 Painters Mill Road, Owings Mills, MD 21117, USA',
    });
    expect(out).toBe('Owings Mills, MD');
  });

  it('drops an address stuffed into neighborhood', () => {
    expect(formatPublicLocation({ neighborhood: '55 Elm Street', location: 'Boston, MA' })).toBe('Boston, MA');
  });

  it('returns null when nothing public is left', () => {
    expect(formatPublicLocation({ neighborhood: null, location: '123 Main St' })).toBeNull();
    expect(formatPublicLocation(null)).toBeNull();
  });
});
