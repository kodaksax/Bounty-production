/**
 * Unit tests for the hunter "stand out to posters" checklist
 */

import { getHunterProfileChecklist } from '../../lib/utils/hunter-profile-checklist';

const COMPLETE = {
  stripe_identity_status: 'verified' as const,
  bio: 'I fix bikes and assemble furniture.',
  skills: ['Bike repair'],
  avatar_url: 'https://example.com/a.jpg',
  phone_verified: true,
  payouts_enabled: true,
};

describe('getHunterProfileChecklist', () => {
  it('orders items ID -> bio+skills -> photo -> payouts, without phone by default', () => {
    const { items } = getHunterProfileChecklist({});
    expect(items.map((i) => i.id)).toEqual(['id_verification', 'bio_and_skills', 'photo', 'payouts']);
  });

  it('places phone between photo and payouts when included', () => {
    const { items } = getHunterProfileChecklist({}, { includePhone: true });
    expect(items.map((i) => i.id)).toEqual(['id_verification', 'bio_and_skills', 'photo', 'phone', 'payouts']);
  });

  it('is complete and has nothing remaining when every step is done', () => {
    const result = getHunterProfileChecklist(COMPLETE, { includePhone: true });
    expect(result.isComplete).toBe(true);
    expect(result.remaining).toBe(0);
    expect(result.nextItem).toBeNull();
  });

  it('never throws on empty or null input', () => {
    expect(() =>
      getHunterProfileChecklist({
        stripe_identity_status: null,
        id_verification_status: null,
        id_verification_rejection_reason: null,
        bio: null,
        skills: null,
        avatar_url: null,
        phone_verified: null,
        payouts_enabled: null,
      })
    ).not.toThrow();
    expect(getHunterProfileChecklist({}).remaining).toBe(4);
  });

  describe('ID verification', () => {
    const idItem = (input: Parameters<typeof getHunterProfileChecklist>[0]) =>
      getHunterProfileChecklist(input).items[0];

    it('requires_input with no reason is an unfinished session, not a rejection', () => {
      const item = idItem({ stripe_identity_status: 'requires_input' });
      expect(item.state).toBe('in_progress');
      expect(item.title).toBe('Finish verifying your ID');
    });

    it('requires_input with a rejection reason needs a resubmit', () => {
      const item = idItem({
        stripe_identity_status: 'requires_input',
        id_verification_rejection_reason: 'The document is invalid.',
      });
      expect(item.state).toBe('needs_fix');
      expect(item.title).toBe('Resubmit your ID');
    });

    it('legacy rejected status needs a resubmit', () => {
      expect(idItem({ id_verification_status: 'rejected' }).state).toBe('needs_fix');
    });

    it('processing is in review and not counted as remaining', () => {
      const result = getHunterProfileChecklist({ ...COMPLETE, stripe_identity_status: 'processing' });
      expect(result.items[0].state).toBe('in_review');
      expect(result.remaining).toBe(0);
      expect(result.isComplete).toBe(false);
    });

    it('legacy verified wins over a stale processing Stripe status', () => {
      expect(idItem({ stripe_identity_status: 'processing', id_verification_status: 'verified' }).state).toBe('done');
    });

    it('unstarted and canceled are todo', () => {
      expect(idItem({ stripe_identity_status: 'unstarted' }).state).toBe('todo');
      expect(idItem({ stripe_identity_status: 'canceled' }).state).toBe('todo');
    });
  });

  describe('bio and skills', () => {
    const bioItem = (input: Parameters<typeof getHunterProfileChecklist>[0]) =>
      getHunterProfileChecklist(input).items[1];

    it('needs both to be done', () => {
      expect(bioItem({ bio: 'Hi', skills: ['Moving'] }).state).toBe('done');
      expect(bioItem({ bio: 'Hi' })).toMatchObject({ state: 'in_progress', title: 'List your skills' });
      expect(bioItem({ skills: ['Moving'] })).toMatchObject({ state: 'in_progress', title: 'Add a short bio' });
    });

    it('treats whitespace bios and blank skill entries as missing', () => {
      expect(bioItem({ bio: '   ', skills: ['  '] }).state).toBe('todo');
    });
  });

  it('nextItem is the first actionable item, skipping one in review', () => {
    const result = getHunterProfileChecklist({ stripe_identity_status: 'processing' });
    expect(result.nextItem?.id).toBe('bio_and_skills');
  });

  it('payouts stays last even when it is the only thing left', () => {
    const result = getHunterProfileChecklist({ ...COMPLETE, payouts_enabled: false });
    expect(result.remaining).toBe(1);
    expect(result.nextItem?.id).toBe('payouts');
  });
});
