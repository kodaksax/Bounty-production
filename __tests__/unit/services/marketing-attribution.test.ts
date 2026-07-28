/**
 * Unit tests for services/marketingAttribution.ts
 *
 * Covers the verification matrix for the client-side attribution integration:
 *   - Android path (Play Install Referrer forwarded)
 *   - iOS path (platform only, no referrer)
 *   - duplicate launches (once per user, and concurrent-call collapsing)
 *   - offline behaviour
 *   - server failure (5xx / unexpected body)
 *   - already_attributed response
 *   - PostHog identify wiring
 */

jest.mock('../../../lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
    },
  },
}));

jest.mock('../../../lib/config', () => ({
  config: { supabase: { url: 'https://test.supabase.co', anonKey: 'test-anon-key' } },
}));

jest.mock('../../../lib/config/api', () => ({
  API_BASE_URL: 'https://test.supabase.co/functions/v1',
}));

jest.mock('../../../lib/posthog', () => ({
  identify: jest.fn(),
  isPostHogReady: jest.fn().mockReturnValue(true),
}));

jest.mock('../../../lib/utils/error-logger', () => ({
  logger: {
    info: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
    critical: jest.fn(),
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import { Platform } from 'react-native';

import {
  MARKETING_ATTRIBUTION_STORAGE_PREFIX,
  performMarketingAttribution,
} from '../../../services/marketingAttribution';

const { identify, isPostHogReady } = require('../../../lib/posthog');
const { logger } = require('../../../lib/utils/error-logger');
const { supabase } = require('../../../lib/supabase');

const USER_ID = 'user-123';
const TOKEN = 'jwt-token-abc';
const STORAGE_KEY = `${MARKETING_ATTRIBUTION_STORAGE_PREFIX}${USER_ID}`;
const ENDPOINT = 'https://test.supabase.co/functions/v1/marketing-attribute';

const getInstallReferrerAsync = Application.getInstallReferrerAsync as jest.Mock;
const getItem = AsyncStorage.getItem as jest.Mock;
const setItem = AsyncStorage.setItem as jest.Mock;

/** Builds a fetch Response stand-in matching what the service reads. */
function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
  };
}

/** Returns the parsed body of the Nth fetch call. */
function fetchBody(callIndex = 0): Record<string, unknown> {
  const [, init] = (global.fetch as jest.Mock).mock.calls[callIndex];
  return JSON.parse(init.body);
}

/** Returns the parsed record written by the Nth AsyncStorage.setItem call. */
function writtenRecord(callIndex = 0): any {
  return JSON.parse(setItem.mock.calls[callIndex][1]);
}

/** Every `[Marketing Attribution] ...` message logged, across info + warning. */
function loggedMessages(): string[] {
  return [...logger.info.mock.calls, ...logger.warning.mock.calls].map(
    (call: any[]) => call[0] as string
  );
}

describe('performMarketingAttribution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Platform.OS = 'ios';
    getItem.mockResolvedValue(null);
    setItem.mockResolvedValue(undefined);
    getInstallReferrerAsync.mockResolvedValue('');
    isPostHogReady.mockReturnValue(true);
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ status: 'unattributed' }));
  });

  afterEach(() => {
    delete (global as any).fetch;
  });

  // ── Android path ────────────────────────────────────────────────────────
  describe('Android path', () => {
    beforeEach(() => {
      Platform.OS = 'android';
    });

    it('sends the raw Play Install Referrer string', async () => {
      const referrer = 'utm_source=facebook&utm_medium=cpc&click_id=abc-123';
      getInstallReferrerAsync.mockResolvedValue(referrer);
      (global.fetch as jest.Mock).mockResolvedValue(
        jsonResponse({ status: 'attributed', campaign_id: 'camp-1' })
      );

      const outcome = await performMarketingAttribution({
        userId: USER_ID,
        accessToken: TOKEN,
      });

      expect(outcome).toBe('completed');
      expect(getInstallReferrerAsync).toHaveBeenCalledTimes(1);
      expect(fetchBody()).toEqual({ platform: 'android', install_referrer: referrer });
    });

    it('sends the correct endpoint, method and auth headers', async () => {
      getInstallReferrerAsync.mockResolvedValue('utm_source=google-play');

      await performMarketingAttribution({ userId: USER_ID, accessToken: TOKEN });

      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe(ENDPOINT);
      expect(init.method).toBe('POST');
      expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
      expect(init.headers.apikey).toBe('test-anon-key');
      expect(init.headers['Content-Type']).toBe('application/json');
    });

    it('omits install_referrer when the Play referrer is empty', async () => {
      getInstallReferrerAsync.mockResolvedValue('   ');

      await performMarketingAttribution({ userId: USER_ID, accessToken: TOKEN });

      expect(fetchBody()).toEqual({ platform: 'android' });
    });

    it('still attributes when the Install Referrer API throws (no Play Store)', async () => {
      getInstallReferrerAsync.mockRejectedValue(new Error('Install Referrer unavailable'));

      const outcome = await performMarketingAttribution({
        userId: USER_ID,
        accessToken: TOKEN,
      });

      expect(outcome).toBe('completed');
      expect(fetchBody()).toEqual({ platform: 'android' });
    });
  });

  // ── iOS path ────────────────────────────────────────────────────────────
  describe('iOS path', () => {
    it('sends platform only and never reads the install referrer', async () => {
      Platform.OS = 'ios';

      const outcome = await performMarketingAttribution({
        userId: USER_ID,
        accessToken: TOKEN,
      });

      expect(outcome).toBe('completed');
      expect(fetchBody()).toEqual({ platform: 'ios' });
      expect(getInstallReferrerAsync).not.toHaveBeenCalled();
    });
  });

  it('skips unsupported platforms without calling the server', async () => {
    Platform.OS = 'web';

    const outcome = await performMarketingAttribution({ userId: USER_ID, accessToken: TOKEN });

    expect(outcome).toBe('skipped');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // ── Duplicate launches ──────────────────────────────────────────────────
  describe('duplicate launches', () => {
    it('does not call the server again once a verdict is recorded', async () => {
      getItem.mockResolvedValue(
        JSON.stringify({
          v: 1,
          state: 'completed',
          status: 'attributed',
          attempts: 1,
          updatedAt: new Date().toISOString(),
        })
      );

      const outcome = await performMarketingAttribution({
        userId: USER_ID,
        accessToken: TOKEN,
      });

      expect(outcome).toBe('skipped');
      expect(global.fetch).not.toHaveBeenCalled();
      expect(setItem).not.toHaveBeenCalled();
    });

    it('records the attempt before the request and the verdict after it', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        jsonResponse({ status: 'attributed', campaign_id: 'camp-1', match_method: 'play_referrer' })
      );

      await performMarketingAttribution({ userId: USER_ID, accessToken: TOKEN });

      expect(setItem).toHaveBeenCalledTimes(2);
      expect(setItem.mock.calls[0][0]).toBe(STORAGE_KEY);
      expect(writtenRecord(0)).toMatchObject({ v: 1, state: 'pending', attempts: 1 });
      expect(writtenRecord(1)).toMatchObject({
        v: 1,
        state: 'completed',
        status: 'attributed',
        attempts: 1,
      });
    });

    it('collapses concurrent calls for the same user into a single request', async () => {
      const [first, second] = await Promise.all([
        performMarketingAttribution({ userId: USER_ID, accessToken: TOKEN }),
        performMarketingAttribution({ userId: USER_ID, accessToken: TOKEN }),
      ]);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(first).toBe('completed');
      expect(second).toBe('completed');
    });

    it('stops retrying after the attempt budget is exhausted', async () => {
      getItem.mockResolvedValue(
        JSON.stringify({
          v: 1,
          state: 'pending',
          attempts: 3,
          updatedAt: new Date().toISOString(),
        })
      );

      const outcome = await performMarketingAttribution({
        userId: USER_ID,
        accessToken: TOKEN,
      });

      expect(outcome).toBe('skipped');
      expect(global.fetch).not.toHaveBeenCalled();
      expect(loggedMessages()).toContain('[Marketing Attribution] skipped');
    });

    it('attributes a different user on the same device independently', async () => {
      getItem.mockImplementation(async (key: string) =>
        key === STORAGE_KEY
          ? JSON.stringify({ v: 1, state: 'completed', status: 'attributed', attempts: 1, updatedAt: '' })
          : null
      );

      const outcome = await performMarketingAttribution({
        userId: 'user-456',
        accessToken: TOKEN,
      });

      expect(outcome).toBe('completed');
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(setItem.mock.calls[0][0]).toBe(
        `${MARKETING_ATTRIBUTION_STORAGE_PREFIX}user-456`
      );
    });
  });

  // ── Offline ─────────────────────────────────────────────────────────────
  describe('offline behaviour', () => {
    it('fails silently and leaves the record retryable', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new TypeError('Network request failed'));

      const outcome = await performMarketingAttribution({
        userId: USER_ID,
        accessToken: TOKEN,
      });

      expect(outcome).toBe('failed');
      // Only the pre-request `pending` write — no terminal verdict was recorded.
      expect(setItem).toHaveBeenCalledTimes(1);
      expect(writtenRecord(0)).toMatchObject({ state: 'pending', attempts: 1 });
      expect(identify).not.toHaveBeenCalled();
    });

    it('retries on the next launch, incrementing the attempt counter', async () => {
      getItem.mockResolvedValue(
        JSON.stringify({
          v: 1,
          state: 'pending',
          attempts: 1,
          updatedAt: new Date().toISOString(),
        })
      );
      (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({ status: 'attributed' }));

      const outcome = await performMarketingAttribution({
        userId: USER_ID,
        accessToken: TOKEN,
      });

      expect(outcome).toBe('completed');
      expect(writtenRecord(0)).toMatchObject({ state: 'pending', attempts: 2 });
      expect(writtenRecord(1)).toMatchObject({ state: 'completed', attempts: 2 });
    });
  });

  // ── Server failure ──────────────────────────────────────────────────────
  describe('server failure', () => {
    it('treats a 500 as a retryable failure', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        jsonResponse({ error: 'internal_error' }, 500)
      );

      const outcome = await performMarketingAttribution({
        userId: USER_ID,
        accessToken: TOKEN,
      });

      expect(outcome).toBe('failed');
      expect(setItem).toHaveBeenCalledTimes(1);
      expect(writtenRecord(0)).toMatchObject({ state: 'pending' });
      expect(loggedMessages()).toContain('[Marketing Attribution] failed');
    });

    it('treats a 401 as a retryable failure without recording a verdict', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({ error: 'unauthorized' }, 401));

      const outcome = await performMarketingAttribution({
        userId: USER_ID,
        accessToken: TOKEN,
      });

      expect(outcome).toBe('failed');
      expect(writtenRecord(0)).toMatchObject({ state: 'pending' });
    });

    it('treats a 200 with an unrecognised body as a failure', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({ status: 'who_knows' }));

      const outcome = await performMarketingAttribution({
        userId: USER_ID,
        accessToken: TOKEN,
      });

      expect(outcome).toBe('failed');
      expect(setItem).toHaveBeenCalledTimes(1);
      expect(identify).not.toHaveBeenCalled();
    });
  });

  // ── already_attributed ──────────────────────────────────────────────────
  describe('already_attributed response', () => {
    it('marks attribution complete locally', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        jsonResponse({
          status: 'already_attributed',
          campaign_id: 'camp-9',
          match_method: 'deep_link',
        })
      );

      const outcome = await performMarketingAttribution({
        userId: USER_ID,
        accessToken: TOKEN,
      });

      expect(outcome).toBe('already_attributed');
      expect(writtenRecord(1)).toMatchObject({
        state: 'completed',
        status: 'already_attributed',
      });
      expect(loggedMessages()).toContain('[Marketing Attribution] already attributed');
    });

    it('is not re-sent on the following launch', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        jsonResponse({ status: 'already_attributed', campaign_id: 'camp-9' })
      );
      await performMarketingAttribution({ userId: USER_ID, accessToken: TOKEN });

      // Second launch reads back what the first launch persisted.
      getItem.mockResolvedValue(setItem.mock.calls[1][1]);
      (global.fetch as jest.Mock).mockClear();

      const outcome = await performMarketingAttribution({
        userId: USER_ID,
        accessToken: TOKEN,
      });

      expect(outcome).toBe('skipped');
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  // ── PostHog ─────────────────────────────────────────────────────────────
  describe('PostHog identify', () => {
    it('identifies the user with the resolved attribution properties', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        jsonResponse({
          status: 'attributed',
          campaign_id: 'camp-1',
          creative_id: 'creative-2',
          utm_source: 'facebook',
          match_method: 'play_referrer',
          match_confidence: 1,
        })
      );

      await performMarketingAttribution({ userId: USER_ID, accessToken: TOKEN });

      expect(identify).toHaveBeenCalledWith(USER_ID, {
        campaign_id: 'camp-1',
        creative_id: 'creative-2',
        utm_source: 'facebook',
        match_method: 'play_referrer',
        match_confidence: 1,
      });
    });

    it('omits properties the server did not resolve', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        jsonResponse({
          status: 'attributed',
          campaign_id: 'camp-1',
          creative_id: null,
          match_method: 'fingerprint',
          match_confidence: 0.7,
        })
      );

      await performMarketingAttribution({ userId: USER_ID, accessToken: TOKEN });

      expect(identify).toHaveBeenCalledWith(USER_ID, {
        campaign_id: 'camp-1',
        match_method: 'fingerprint',
        match_confidence: 0.7,
      });
    });

    it('does not identify when PostHog is not initialized', async () => {
      isPostHogReady.mockReturnValue(false);
      (global.fetch as jest.Mock).mockResolvedValue(
        jsonResponse({ status: 'attributed', campaign_id: 'camp-1' })
      );

      const outcome = await performMarketingAttribution({
        userId: USER_ID,
        accessToken: TOKEN,
      });

      expect(outcome).toBe('completed');
      expect(identify).not.toHaveBeenCalled();
    });

    it('does not identify on an unattributed verdict', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({ status: 'unattributed' }));

      const outcome = await performMarketingAttribution({
        userId: USER_ID,
        accessToken: TOKEN,
      });

      expect(outcome).toBe('completed');
      expect(identify).not.toHaveBeenCalled();
    });

    it('still completes when identify throws', async () => {
      identify.mockImplementation(() => {
        throw new Error('posthog exploded');
      });
      (global.fetch as jest.Mock).mockResolvedValue(
        jsonResponse({ status: 'attributed', campaign_id: 'camp-1' })
      );

      await expect(
        performMarketingAttribution({ userId: USER_ID, accessToken: TOKEN })
      ).resolves.toBe('completed');
    });
  });

  // ── Session resolution ──────────────────────────────────────────────────
  describe('session resolution', () => {
    it('falls back to the current Supabase session when no params are given', async () => {
      supabase.auth.getSession.mockResolvedValue({
        data: { session: { access_token: 'session-token', user: { id: 'user-999' } } },
        error: null,
      });

      const outcome = await performMarketingAttribution();

      expect(outcome).toBe('completed');
      const [, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(init.headers.Authorization).toBe('Bearer session-token');
    });

    it('skips when there is no authenticated session', async () => {
      supabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });

      const outcome = await performMarketingAttribution();

      expect(outcome).toBe('skipped');
      expect(global.fetch).not.toHaveBeenCalled();
      expect(loggedMessages()).toContain('[Marketing Attribution] skipped');
    });

    it('skips when getSession rejects', async () => {
      supabase.auth.getSession.mockRejectedValue(new Error('auth lock contention'));

      await expect(performMarketingAttribution()).resolves.toBe('skipped');
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  // ── Structured logging ──────────────────────────────────────────────────
  describe('structured logging', () => {
    it('logs the attempt with platform context and then the completion', async () => {
      Platform.OS = 'android';
      getInstallReferrerAsync.mockResolvedValue('utm_source=facebook');
      (global.fetch as jest.Mock).mockResolvedValue(
        jsonResponse({ status: 'attributed', campaign_id: 'camp-1' })
      );

      await performMarketingAttribution({ userId: USER_ID, accessToken: TOKEN });

      expect(logger.info).toHaveBeenCalledWith(
        '[Marketing Attribution] attempted',
        expect.objectContaining({
          userId: USER_ID,
          attempt: 1,
          platform: 'android',
          hasInstallReferrer: true,
        })
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[Marketing Attribution] completed',
        expect.objectContaining({ userId: USER_ID, status: 'attributed' })
      );
    });

    it('logs failures at warning level', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network request failed'));

      await performMarketingAttribution({ userId: USER_ID, accessToken: TOKEN });

      expect(logger.warning).toHaveBeenCalledWith(
        '[Marketing Attribution] failed',
        expect.objectContaining({ userId: USER_ID, attempt: 1, attemptsRemaining: 2 })
      );
    });
  });

  // ── Never blocks / never throws ─────────────────────────────────────────
  it('never rejects, even when AsyncStorage is broken', async () => {
    getItem.mockRejectedValue(new Error('storage unavailable'));
    setItem.mockRejectedValue(new Error('storage unavailable'));

    await expect(
      performMarketingAttribution({ userId: USER_ID, accessToken: TOKEN })
    ).resolves.toBe('completed');
  });
});

describe('performMarketingAttribution when Supabase is not configured', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    delete (global as any).fetch;
  });

  it('skips without touching the network', async () => {
    jest.doMock('../../../lib/supabase', () => ({
      isSupabaseConfigured: false,
      supabase: { auth: { getSession: jest.fn() } },
    }));

    const { performMarketingAttribution: perform } =
      require('../../../services/marketingAttribution');

    await expect(perform({ userId: USER_ID, accessToken: TOKEN })).resolves.toBe('skipped');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
