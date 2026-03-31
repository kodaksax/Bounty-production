/**
 * Unit tests for bounty-request status transitions
 * Validates the domain-level guards added to bounty-transitions.ts
 */

import {
  transitionBountyRequest,
  isValidRequestTransition,
  type BountyRequestStatus,
  type BountyRequestAction,
} from '../../../lib/domain/bounty-transitions';

describe('transitionBountyRequest', () => {
  // ── Happy paths ──

  it('should allow accepting a pending request', () => {
    const result = transitionBountyRequest('pending', 'accept');
    expect(result).toEqual({ success: true, newStatus: 'accepted' });
  });

  it('should allow rejecting a pending request', () => {
    const result = transitionBountyRequest('pending', 'reject');
    expect(result).toEqual({ success: true, newStatus: 'rejected' });
  });

  it('should allow withdrawing a pending request', () => {
    const result = transitionBountyRequest('pending', 'withdraw');
    expect(result).toEqual({ success: true, newStatus: 'withdrawn' });
  });

  // ── Invalid transitions ──

  it('should reject accepting an already-accepted request', () => {
    const result = transitionBountyRequest('accepted', 'accept');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('accepted');
    }
  });

  it('should reject withdrawing an accepted request', () => {
    const result = transitionBountyRequest('accepted', 'withdraw');
    expect(result.success).toBe(false);
  });

  it('should reject accepting a rejected request', () => {
    const result = transitionBountyRequest('rejected', 'accept');
    expect(result.success).toBe(false);
  });

  it('should reject withdrawing a withdrawn request', () => {
    const result = transitionBountyRequest('withdrawn', 'withdraw');
    expect(result.success).toBe(false);
  });

  it('should return error for an invalid action', () => {
    const result = transitionBountyRequest('pending', 'invalid_action' as BountyRequestAction);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Invalid request action');
    }
  });
});

describe('isValidRequestTransition', () => {
  it('returns true for valid transitions', () => {
    expect(isValidRequestTransition('pending', 'accept')).toBe(true);
    expect(isValidRequestTransition('pending', 'reject')).toBe(true);
    expect(isValidRequestTransition('pending', 'withdraw')).toBe(true);
  });

  it('returns false for invalid transitions', () => {
    expect(isValidRequestTransition('accepted', 'accept')).toBe(false);
    expect(isValidRequestTransition('rejected', 'reject')).toBe(false);
    expect(isValidRequestTransition('withdrawn', 'accept')).toBe(false);
  });
});
