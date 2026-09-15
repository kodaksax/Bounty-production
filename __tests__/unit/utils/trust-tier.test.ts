import { detectTrustTier, isHighRiskTrustTier } from '../../../lib/utils/trust-tier';

describe('detectTrustTier', () => {
  test('standard errand/delivery/labor text stays standard', () => {
    expect(detectTrustTier('Pick up my dry cleaning', '').tier).toBe('standard');
    expect(detectTrustTier('Deliver a package across town', '').tier).toBe('standard');
    expect(detectTrustTier('Assemble my furniture', 'IKEA bookshelf, needs two people').tier).toBe(
      'standard'
    );
    expect(detectTrustTier('Help me move boxes', '').tier).toBe('standard');
  });

  test('animal care is detected and defaults ID-required ON', () => {
    const result = detectTrustTier('Walk my dog', 'Twice a day while I am at work');
    expect(result.tier).toBe('animal_care');
    expect(result.recommendIdVerified).toBe(true);
    expect(result.defaultIdVerified).toBe(true);
    expect(result.bannerCopy).toMatch(/pet care/i);
  });

  test('pet sitting and pet boarding are also animal_care', () => {
    expect(detectTrustTier('Pet sitting this weekend', '').tier).toBe('animal_care');
    expect(detectTrustTier('Need pet boarding for a week', '').tier).toBe('animal_care');
    expect(detectTrustTier('Cat sitting needed', '').tier).toBe('animal_care');
  });

  test('home entry is detected, recommended but defaults OFF', () => {
    const result = detectTrustTier('House cleaning needed', 'Deep clean the kitchen and bathrooms');
    expect(result.tier).toBe('home_entry');
    expect(result.recommendIdVerified).toBe(true);
    expect(result.defaultIdVerified).toBe(false);
  });

  test('licensed trades surfaces a no-license-verification disclaimer, defaults OFF', () => {
    const result = detectTrustTier('Fix my electrical panel', 'Circuit breaker keeps tripping');
    expect(result.tier).toBe('licensed_trades');
    expect(result.defaultIdVerified).toBe(false);
    expect(result.bannerCopy).toMatch(/does not verify licenses/i);
  });

  test('vulnerable people surfaces a no-background-check disclaimer, defaults OFF', () => {
    const result = detectTrustTier('Need a nanny for Saturday night', '');
    expect(result.tier).toBe('vulnerable_people');
    expect(result.defaultIdVerified).toBe(false);
    expect(result.bannerCopy).toMatch(/does not perform background checks/i);
  });

  test('babysitting and elder care are also vulnerable_people', () => {
    expect(detectTrustTier('Babysitting needed Friday', '').tier).toBe('vulnerable_people');
    expect(detectTrustTier('Elder care for my grandmother', '').tier).toBe('vulnerable_people');
  });

  test('digital/skill work is recognized but never recommends ID', () => {
    const result = detectTrustTier('Build me a website', 'Need a landing page coded in React');
    expect(result.tier).toBe('digital_skill');
    expect(result.recommendIdVerified).toBe(false);
    expect(result.bannerCopy).toBeUndefined();
  });

  test('a bounty matching two tiers resolves to the more cautious one', () => {
    // vulnerable_people (babysit) outranks animal_care (walk the dog) in priority order.
    const result = detectTrustTier('Babysit my kids and walk the dog', '');
    expect(result.tier).toBe('vulnerable_people');
  });

  test('never claims verification/background checks/vetting for any tier', () => {
    const allCopy = [
      detectTrustTier('Walk my dog', '').bannerCopy,
      detectTrustTier('House cleaning', '').bannerCopy,
      detectTrustTier('Fix my electrical panel', '').bannerCopy,
      detectTrustTier('Need a nanny', '').bannerCopy,
    ].join(' ');
    expect(allCopy).not.toMatch(/\bsafe\b/i);
    expect(allCopy).not.toMatch(/\bvetted\b/i);
    expect(allCopy).not.toMatch(/background[ -]checked/i);
  });

  test('handles null/undefined/empty input without throwing', () => {
    expect(() => detectTrustTier(null, null)).not.toThrow();
    expect(() => detectTrustTier(undefined, undefined)).not.toThrow();
    expect(detectTrustTier('', '').tier).toBe('standard');
  });
});

describe('isHighRiskTrustTier', () => {
  test('flags the four high-risk tiers', () => {
    expect(isHighRiskTrustTier('animal_care')).toBe(true);
    expect(isHighRiskTrustTier('home_entry')).toBe(true);
    expect(isHighRiskTrustTier('licensed_trades')).toBe(true);
    expect(isHighRiskTrustTier('vulnerable_people')).toBe(true);
  });

  test('does not flag standard or digital_skill', () => {
    expect(isHighRiskTrustTier('standard')).toBe(false);
    expect(isHighRiskTrustTier('digital_skill')).toBe(false);
  });

  test('handles null/undefined/unknown without throwing', () => {
    expect(isHighRiskTrustTier(null)).toBe(false);
    expect(isHighRiskTrustTier(undefined)).toBe(false);
    expect(isHighRiskTrustTier('made_up_tier')).toBe(false);
  });
});
