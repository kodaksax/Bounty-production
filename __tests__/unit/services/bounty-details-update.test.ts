/**
 * Unit tests for bountyService.updateBountyDetails (app/services/bountyService.ts)
 * — the write the two-step posting flow uses to attach photos/details,
 * location and schedule onto a bounty that is ALREADY LIVE.
 *
 * The cases here are the ones that made those edits look like they saved
 * while the row never changed:
 *   - `is_time_sensitive` is NOT NULL in the database, so an explicit null
 *     (which every non-ASAP save used to send) fails the whole UPDATE with
 *     23502 — taking the photos/description/location in the same payload
 *     down with it.
 *   - the base service swallows its own errors and resolves to null, so a
 *     rejected write has to be turned back into a throw or the confirmation
 *     screen reports a save that never happened.
 *   - an offline publish hands back a synthetic `temp-` id that matches no
 *     row at all.
 */

jest.mock('../../../lib/services/bounty-service', () => ({
  bountyService: {
    update: jest.fn(),
  },
}));

jest.mock('../../../lib/services/analytics-service', () => ({
  analyticsService: {
    trackEvent: jest.fn().mockResolvedValue(undefined),
    incrementUserProperty: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../../lib/services/performance-service', () => ({
  performanceService: {
    startMeasurement: jest.fn(),
    endMeasurement: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../../lib/services/offline-queue-service', () => ({
  offlineQueueService: {
    getOnlineStatus: jest.fn().mockReturnValue(true),
    enqueue: jest.fn(),
  },
}));

jest.mock('../../../lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabaseEnv: { hasUrl: true, hasKey: true, mismatch: false },
}));

jest.mock('../../../lib/utils/data-utils', () => ({
  getCurrentUserId: jest.fn().mockReturnValue('user-abc'),
}));

import type { BountyDraft } from '../../../app/hooks/useBountyDraft';
import { bountyService } from '../../../app/services/bountyService';

const { bountyService: baseBountyService } = require('../../../lib/services/bounty-service');
const { analyticsService } = require('../../../lib/services/analytics-service');

const makeDraft = (overrides: Partial<BountyDraft> = {}): BountyDraft => ({
  title: 'Move a couch',
  description: '',
  amount: 40,
  isForHonor: false,
  location: '123 Main St, Baltimore, MD',
  workType: 'in_person',
  attachments: [],
  ...overrides,
});

const updatedRow = { id: 'bounty-1', title: 'Move a couch' };

beforeEach(() => {
  jest.clearAllMocks();
  baseBountyService.update.mockResolvedValue(updatedRow);
});

describe('updateBountyDetails column mapping', () => {
  it('sends is_time_sensitive as a boolean, never null (NOT NULL column)', async () => {
    for (const scheduleType of ['flexible', 'scheduled', undefined] as const) {
      baseBountyService.update.mockClear();
      await bountyService.updateBountyDetails('bounty-1', makeDraft({ scheduleType }));

      const updates = baseBountyService.update.mock.calls[0][1];
      expect(updates.is_time_sensitive).toBe(false);
      expect(updates.is_time_sensitive).not.toBeNull();
    }

    baseBountyService.update.mockClear();
    await bountyService.updateBountyDetails('bounty-1', makeDraft({ scheduleType: 'asap' }));
    expect(baseBountyService.update.mock.calls[0][1].is_time_sensitive).toBe(true);
  });

  it('never sends a null description (NOT NULL column)', async () => {
    await bountyService.updateBountyDetails(
      'bounty-1',
      makeDraft({ description: undefined as unknown as string })
    );
    expect(baseBountyService.update.mock.calls[0][1].description).toBe('');
  });

  it('persists photos to both attachment columns so readers cannot disagree', async () => {
    const attachments = [
      { id: 'a1', name: 'couch.jpg', uri: 'file:///couch.jpg', remoteUri: 'https://cdn/couch.jpg', status: 'uploaded' },
      { id: 'a2', name: 'door.jpg', uri: 'file:///door.jpg', remoteUri: 'https://cdn/door.jpg', status: 'uploaded' },
    ] as BountyDraft['attachments'];

    await bountyService.updateBountyDetails(
      'bounty-1',
      makeDraft({ attachments, description: 'Third floor walk-up' })
    );

    const updates = baseBountyService.update.mock.calls[0][1];
    expect(JSON.parse(updates.attachments_json)).toHaveLength(2);
    expect(updates.attachments).toHaveLength(2);
    expect(updates.description).toBe('Third floor walk-up');
  });

  it('writes in-person coordinates and clears them for online work', async () => {
    await bountyService.updateBountyDetails(
      'bounty-1',
      makeDraft({ latitude: 39.29, longitude: -76.61, neighborhood: 'Federal Hill' })
    );
    const inPerson = baseBountyService.update.mock.calls[0][1];
    expect(inPerson.latitude).toBe(39.29);
    expect(inPerson.longitude).toBe(-76.61);
    expect(inPerson.neighborhood).toBe('Federal Hill');

    baseBountyService.update.mockClear();
    await bountyService.updateBountyDetails(
      'bounty-1',
      makeDraft({ workType: 'online', latitude: 39.29, longitude: -76.61 })
    );
    const online = baseBountyService.update.mock.calls[0][1];
    expect(online.latitude).toBeNull();
    expect(online.longitude).toBeNull();
    expect(online.location).toBe('');
  });

  it('persists the structured schedule fields', async () => {
    await bountyService.updateBountyDetails(
      'bounty-1',
      makeDraft({
        scheduleType: 'scheduled',
        startDate: '2026-09-01T15:00:00.000Z',
        endDate: '2026-09-01T18:00:00.000Z',
      })
    );

    const updates = baseBountyService.update.mock.calls[0][1];
    expect(updates.schedule_type).toBe('scheduled');
    expect(updates.start_date).toBe('2026-09-01T15:00:00.000Z');
    expect(updates.end_date).toBe('2026-09-01T18:00:00.000Z');
  });
});

describe('updateBountyDetails failure handling', () => {
  it('throws when the write is rejected (the base service resolves null)', async () => {
    baseBountyService.update.mockResolvedValue(null);

    await expect(bountyService.updateBountyDetails('bounty-1', makeDraft())).rejects.toThrow(
      /Could not save these details/
    );
    expect(analyticsService.trackEvent).not.toHaveBeenCalledWith(
      'bounty_details_added',
      expect.anything()
    );
  });

  it('rejects a not-yet-synced offline bounty instead of updating nothing', async () => {
    await expect(
      bountyService.updateBountyDetails('temp-1234-abcd', makeDraft())
    ).rejects.toThrow(/hasn't finished posting/);
    expect(baseBountyService.update).not.toHaveBeenCalled();
  });

  it('reports what was added once the write lands', async () => {
    await bountyService.updateBountyDetails(
      'bounty-1',
      makeDraft({
        scheduleType: 'flexible',
        latitude: 39.29,
        longitude: -76.61,
        description: 'Third floor',
        attachments: [{ id: 'a1', name: 'x.jpg', uri: 'file:///x.jpg', status: 'uploaded' }] as BountyDraft['attachments'],
      })
    );

    expect(analyticsService.trackEvent).toHaveBeenCalledWith('bounty_details_added', {
      bountyId: 'bounty-1',
      hasLocation: true,
      hasSchedule: true,
      hasDescription: true,
      attachmentCount: 1,
    });
  });
});
