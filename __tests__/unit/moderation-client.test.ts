// Tests for the Bounty Moderation Queue client.
//
// The DB-side behaviour (the scan regexes, the auto-flag threshold, the state
// machine, RLS and the admin guard, threshold -> alert firing) is exercised
// against the real schema by scripts/verify-moderation-migration.js, which
// applies the migration inside a transaction and rolls it back. This suite
// covers the layer above it: the mapping and the button-gating logic that
// decide what an operator sees and which actions are offered.

const rpc = jest.fn();

jest.mock('../../lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args), from: jest.fn(), functions: { invoke: jest.fn() }, auth: {} },
  isSupabaseConfigured: true,
}));

import {
  moderationClient,
  __moderationInternals,
} from '../../lib/admin/moderationClient';
import { MODERATION_STATES, MODERATION_TRANSITIONS } from '../../lib/types-admin';

const {
  mapQueueRow,
  mapDetail,
  mapEvent,
  mapAlert,
  mapThreshold,
  mapMetrics,
  mapSignal,
  signalLabel,
  stateLabel,
  severityTone,
  isTransitionAllowed,
  classifyResolution,
  normalizeState,
} = __moderationInternals;

beforeEach(() => {
  rpc.mockReset();
});

function ok(data: unknown) {
  return Promise.resolve({ data, error: null });
}

// ─── row mappers ─────────────────────────────────────────────────────────

describe('queue row mapping', () => {
  test('maps every field the founder brief asks for', () => {
    const row = mapQueueRow({
      bounty_id: 'b1',
      title: 'Follow my Instagram 🚀',
      amount: '150.00',
      is_for_honor: false,
      bounty_status: 'open',
      created_at: '2026-08-29T10:00:00Z',
      poster_id: 'u1',
      poster_username: 'promo_guy',
      poster_account_age_days: 0,
      poster_account_status: 'active',
      poster_risk_level: 'high',
      applications: '9',
      application_velocity: '7',
      related_listings: '4',
      state: 'flagged',
      signal_score: '8',
      auto_flagged: true,
      flagged_at: '2026-08-29T10:05:00Z',
      flagged_reason: 'Auto-flagged: promotional_language, external_link',
      resolution: null,
      updated_at: '2026-08-29T10:05:00Z',
      signals: [
        { type: 'promotional_language', severity: 'medium', weight: 2, source: 'content', evidence: {}, detected_at: '2026-08-29T10:05:00Z' },
      ],
      total_count: '12',
    });

    expect(row.bountyId).toBe('b1');
    expect(row.amount).toBe(150);
    expect(row.applications).toBe(9);
    expect(row.applicationVelocity).toBe(7);
    expect(row.relatedListings).toBe(4);
    expect(row.posterAccountAgeDays).toBe(0);
    expect(row.posterRiskLevel).toBe('high');
    expect(row.state).toBe('flagged');
    expect(row.autoFlagged).toBe(true);
    expect(row.signalScore).toBe(8);
    expect(row.signals).toHaveLength(1);
  });

  test('an unknown state is normalised to active, never dropped', () => {
    expect(normalizeState('banana')).toBe('active');
    expect(mapQueueRow({ bounty_id: 'b', state: 'weird', signals: [] }).state).toBe('active');
  });

  test('a missing resolution stays undefined, not a fabricated value', () => {
    expect(mapQueueRow({ bounty_id: 'b', signals: [], resolution: '' }).resolution).toBeUndefined();
  });
});

describe('signal mapping', () => {
  test('accepts both `type` and `signal_type` keys and defaults source to content', () => {
    expect(mapSignal({ signal_type: 'crypto_promotion', severity: 'high', weight: '3' })).toMatchObject({
      type: 'crypto_promotion',
      severity: 'high',
      weight: 3,
      source: 'content',
    });
  });

  test('an unrecognised severity falls back to medium', () => {
    expect(mapSignal({ type: 'x', severity: 'spicy' }).severity).toBe('medium');
  });
});

describe('detail mapping', () => {
  const json = {
    bounty: {
      id: 'b1', title: 'DM me on Telegram', description: 'text me', amount: '20',
      is_for_honor: false, status: 'open', created_at: '2026-08-29T00:00:00Z', hunter_id: null,
    },
    poster: {
      id: 'u1', username: 'spammer', account_status: 'active', account_restricted: false,
      risk_level: 'medium', account_age_days: 2, created_at: '2026-08-27T00:00:00Z',
    },
    moderation: { state: 'flagged', signal_score: '6', auto_flagged: true, resolution: null },
    signals: [{ signal_type: 'contact_off_platform', severity: 'high', weight: 3, source: 'content', evidence: { match: 'dm me' } }],
    events: [{ id: 'e1', bounty_id: 'b1', from_state: 'active', to_state: 'flagged', actor: 'system', created_at: '2026-08-29T00:01:00Z' }],
    applications: { total: 3, recent: [{ id: 'r1', hunter_id: 'h1', status: 'pending', created_at: '2026-08-29T00:02:00Z' }] },
    related_listings: [{ id: 'b2', title: 'another', amount: '20', status: 'open', created_at: '2026-08-28T00:00:00Z' }],
  };

  test('assembles the review screen payload', () => {
    const d = mapDetail(json)!;
    expect(d.bounty.title).toBe('DM me on Telegram');
    expect(d.poster?.accountAgeDays).toBe(2);
    expect(d.moderation.state).toBe('flagged');
    expect(d.signals[0].evidence).toEqual({ match: 'dm me' });
    expect(d.events[0].actor).toBe('system');
    expect(d.applications.recent[0].hunterId).toBe('h1');
    expect(d.relatedListings[0].id).toBe('b2');
  });

  test('returns null when the bounty is missing', () => {
    expect(mapDetail({})).toBeNull();
    expect(mapDetail(null)).toBeNull();
  });
});

describe('alert / threshold / metrics mapping', () => {
  test('alert maps summary and dedup key', () => {
    const a = mapAlert({
      id: 'a1', alert_key: 'application_velocity:b1:20260829T10', threshold_key: 'application_velocity',
      bounty_id: 'b1', poster_id: 'u1', severity: 'high',
      summary: 'Suspicious bounty received 7 applications within 30 minutes.',
      detail: { peak_per_30min: 7 }, created_at: '2026-08-29T10:00:00Z',
    });
    expect(a.thresholdKey).toBe('application_velocity');
    expect(a.summary).toContain('7 applications');
    expect(a.acknowledgedAt).toBeUndefined();
  });

  test('threshold maps numbers and enabled default', () => {
    const t = mapThreshold({ key: 'signal_score', description: 'x', threshold_value: '5', window_minutes: null, severity: 'high' });
    expect(t.thresholdValue).toBe(5);
    expect(t.windowMinutes).toBeUndefined();
    expect(t.enabled).toBe(true);
  });

  test('metrics separates legitimate from suspicious demand', () => {
    const m = mapMetrics({
      generated_at: '2026-08-29T12:00:00Z',
      by_state: { flagged: 3, approved: 1 },
      open_queue: 3, auto_flagged: 2,
      resolved_legitimate: 1, resolved_suspicious: 4,
      legitimate_demand: 5, suspicious_demand: 41,
      unacknowledged_alerts: 2, last_sweep_at: '2026-08-29T11:50:00Z',
    });
    expect(m.byState.flagged).toBe(3);
    expect(m.legitimateDemand).toBe(5);
    expect(m.suspiciousDemand).toBe(41);
    expect(m.unacknowledgedAlerts).toBe(2);
  });
});

describe('event mapping', () => {
  test('an unknown actor is treated as system, not admin', () => {
    expect(mapEvent({ id: 'e', bounty_id: 'b', to_state: 'flagged', actor: 'robot' }).actor).toBe('system');
  });
});

// ─── presentation helpers ────────────────────────────────────────────────

describe('labels and tone', () => {
  test('every signal type has a human label', () => {
    expect(signalLabel('promotional_language')).toMatch(/promotional/i);
    expect(signalLabel('contact_off_platform')).toMatch(/DM me/i);
    // unknown types are sentence-cased rather than shown raw
    expect(signalLabel('some_new_signal')).toBe('Some new signal');
  });

  test('every state has a label', () => {
    for (const s of MODERATION_STATES) {
      expect(stateLabel(s).length).toBeGreaterThan(0);
    }
  });

  test('severity maps to a tone', () => {
    expect(severityTone('critical')).toBe('error');
    expect(severityTone('high')).toBe('error');
    expect(severityTone('medium')).toBe('warning');
    expect(severityTone('low')).toBe('neutral');
  });
});

// ─── state machine (button gating) ───────────────────────────────────────

describe('isTransitionAllowed mirrors the DB matrix', () => {
  test('matches MODERATION_TRANSITIONS for every state pair', () => {
    for (const from of MODERATION_STATES) {
      for (const to of MODERATION_STATES) {
        const expected = (MODERATION_TRANSITIONS[from] ?? []).includes(to);
        expect(isTransitionAllowed(from, to)).toBe(expected);
      }
    }
  });

  test('rejects the transitions the pipeline must never allow', () => {
    // removed is near-terminal: only reinstatement back to approved
    expect(isTransitionAllowed('removed', 'active')).toBe(false);
    expect(isTransitionAllowed('removed', 'flagged')).toBe(false);
    expect(isTransitionAllowed('removed', 'hidden')).toBe(false);
    // approved cannot silently drop back to active
    expect(isTransitionAllowed('approved', 'active')).toBe(false);
    // a no-op is not a transition
    expect(isTransitionAllowed('flagged', 'flagged')).toBe(false);
    // unknown states are never allowed
    expect(isTransitionAllowed('active', 'banana' as never)).toBe(false);
    expect(isTransitionAllowed('banana' as never, 'approved')).toBe(false);
  });

  test('the human review path from the brief is walkable', () => {
    expect(isTransitionAllowed('active', 'flagged')).toBe(true);
    expect(isTransitionAllowed('flagged', 'under_review')).toBe(true);
    expect(isTransitionAllowed('under_review', 'approved')).toBe(true);
    expect(isTransitionAllowed('under_review', 'hidden')).toBe(true);
    expect(isTransitionAllowed('under_review', 'removed')).toBe(true);
    expect(isTransitionAllowed('flagged', 'active')).toBe(true); // dismiss the flag
  });
});

describe('classifyResolution', () => {
  test('approve records legitimate, hide/remove record suspicious_confirmed', () => {
    expect(classifyResolution('approved')).toBe('legitimate');
    expect(classifyResolution('hidden')).toBe('suspicious_confirmed');
    expect(classifyResolution('removed')).toBe('suspicious_confirmed');
    expect(classifyResolution('under_review')).toBeUndefined();
    expect(classifyResolution('flagged')).toBeUndefined();
  });
});

// ─── client wrappers ─────────────────────────────────────────────────────

describe('moderationClient RPC wrappers', () => {
  test('fetchQueue passes the state filter and derives total + hasMore', async () => {
    rpc.mockReturnValueOnce(
      ok([
        { bounty_id: 'b1', state: 'flagged', signals: [], total_count: '3' },
        { bounty_id: 'b2', state: 'flagged', signals: [], total_count: '3' },
      ])
    );
    const page = await moderationClient.fetchQueue({ state: 'flagged', limit: 2, offset: 0 });
    expect(rpc).toHaveBeenCalledWith('admin_moderation_queue', {
      p_state: 'flagged',
      p_limit: 2,
      p_offset: 0,
    });
    expect(page.total).toBe(3);
    expect(page.rows).toHaveLength(2);
    expect(page.hasMore).toBe(true);
  });

  test('fetchQueue with no filter sends p_state: null', async () => {
    rpc.mockReturnValueOnce(ok([]));
    const page = await moderationClient.fetchQueue();
    expect(rpc).toHaveBeenCalledWith('admin_moderation_queue', expect.objectContaining({ p_state: null }));
    expect(page.total).toBe(0);
    expect(page.hasMore).toBe(false);
  });

  test('transition forwards the required reason and maps the result', async () => {
    rpc.mockReturnValueOnce(ok({ from_state: 'flagged', to_state: 'hidden', bounty_status: 'archived' }));
    const res = await moderationClient.transition('b1', 'hidden', 'Promotional / no actionable task');
    expect(rpc).toHaveBeenCalledWith('admin_moderation_transition', {
      p_bounty_id: 'b1',
      p_new_state: 'hidden',
      p_reason: 'Promotional / no actionable task',
      p_notes: null,
    });
    expect(res).toEqual({ fromState: 'flagged', toState: 'hidden', bountyStatus: 'archived' });
  });

  test('updateThreshold sends only the fields provided', async () => {
    rpc.mockReturnValueOnce(ok({ key: 'application_velocity', description: 'x', threshold_value: 5, severity: 'high' }));
    await moderationClient.updateThreshold('application_velocity', { thresholdValue: 5 });
    expect(rpc).toHaveBeenCalledWith('admin_update_moderation_threshold', {
      p_key: 'application_velocity',
      p_threshold_value: 5,
      p_window_minutes: null,
      p_enabled: null,
    });
  });

  test('a Supabase error is surfaced as a thrown Error, not swallowed', async () => {
    rpc.mockReturnValueOnce(Promise.resolve({ data: null, error: { message: 'permission denied for function admin_moderation_queue' } }));
    await expect(moderationClient.fetchQueue()).rejects.toThrow(/permission denied/);
  });
});
