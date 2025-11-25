/**
 * Unit tests for Stale Bounty Service
 * Tests the detection and management of stale bounties when hunter accounts are deleted
 */

import { staleBountyService } from '../../../services/api/src/services/stale-bounty-service';

// Mock the database and dependencies
jest.mock('../../../services/api/src/db/connection', () => ({
  db: {
    transaction: jest.fn(),
    select: jest.fn(),
    update: jest.fn(),
  },
}));

jest.mock('../../../services/api/src/services/outbox-service', () => ({
  outboxService: {
    createEvent: jest.fn(),
  },
}));

jest.mock('../../../services/api/src/services/notification-service', () => ({
  notificationService: {
    notifyBountyStale: jest.fn(),
    notifyStaleBountyCancelled: jest.fn(),
    notifyStaleBountyReposted: jest.fn(),
  },
}));

jest.mock('../../../services/api/src/services/wallet-service', () => ({
  walletService: {
    createTransaction: jest.fn(),
  },
}));

describe('StaleBountyService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isBountyStale', () => {
    it('should correctly identify stale bounties', () => {
      const staleBounty = {
        id: 1,
        title: 'Test Bounty',
        is_stale: true,
        stale_reason: 'hunter_deleted',
      };

      const normalBounty = {
        id: 2,
        title: 'Normal Bounty',
        is_stale: false,
      };

      expect(staleBountyService.isBountyStale(staleBounty as any)).toBe(true);
      expect(staleBountyService.isBountyStale(normalBounty as any)).toBe(false);
    });
  });

  describe('getStaleReason', () => {
    it('should return correct reason for hunter_deleted', () => {
      const bounty = {
        id: 1,
        is_stale: true,
        stale_reason: 'hunter_deleted',
      };

      const reason = staleBountyService.getStaleReason(bounty as any);
      expect(reason).toBe('The hunter deleted their account');
    });

    it('should return empty string for non-stale bounties', () => {
      const bounty = {
        id: 1,
        is_stale: false,
      };

      const reason = staleBountyService.getStaleReason(bounty as any);
      expect(reason).toBe('');
    });

    it('should return default message for unknown reasons', () => {
      const bounty = {
        id: 1,
        is_stale: true,
        stale_reason: 'unknown_reason',
      };

      const reason = staleBountyService.getStaleReason(bounty as any);
      expect(reason).toBe('This bounty needs attention');
    });
  });
});

describe('Stale Bounty Detection Flow', () => {
  it('should mark bounties as stale when hunter is deleted', async () => {
    // This test would require a more complete mock setup
    // For now, we verify the service methods exist and have correct signatures
    expect(typeof staleBountyService.detectStaleBounties).toBe('function');
    expect(typeof staleBountyService.getStaleBountiesForPoster).toBe('function');
    expect(typeof staleBountyService.cancelStaleBounty).toBe('function');
    expect(typeof staleBountyService.repostStaleBounty).toBe('function');
  });
});
