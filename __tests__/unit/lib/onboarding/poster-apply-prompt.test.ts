/**
 * Applying for a bounty while primary_role = poster: asked once, and applying
 * goes ahead whatever the answer.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import AsyncStorage from '@react-native-async-storage/async-storage';

let mockRole: string | null = 'poster';
jest.mock('../../../../lib/services/auth-profile-service', () => ({
  authProfileService: { getPrimaryRoleForAnalytics: () => mockRole },
}));

const mockTrackEvent = jest.fn();
jest.mock('../../../../lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: (...args: unknown[]) => mockTrackEvent(...args) },
}));

import {
  __resetPosterApplyPromptForTests,
  askPosterBeforeApplying,
} from '../../../../lib/onboarding/poster-apply-prompt';
import { posterHomeStrings } from '../../../../lib/strings/posterHome';

const RN = require('react-native');

const OPTIONS = {
  enabled: true,
  userId: 'user-1',
  bountyId: 'bounty-1',
  surface: 'modal',
} as const;

let alertSpy: jest.Mock;
let storage: Record<string, string>;

const flush = () => new Promise(resolve => setImmediate(resolve));

async function pressAlertButton(label: string) {
  await flush();
  const buttons = alertSpy.mock.calls[alertSpy.mock.calls.length - 1][2];
  buttons.find((b: { text: string }) => b.text === label).onPress();
}

const events = (name: string) => mockTrackEvent.mock.calls.filter(([e]) => e === name);

beforeEach(() => {
  jest.clearAllMocks();
  __resetPosterApplyPromptForTests();
  mockRole = 'poster';
  storage = {};
  alertSpy = jest.fn();
  RN.Alert = { alert: alertSpy };
  RN.Platform.OS = 'ios';
  (AsyncStorage.getItem as jest.Mock).mockImplementation((k: string) =>
    Promise.resolve(storage[k] ?? null)
  );
  (AsyncStorage.setItem as jest.Mock).mockImplementation((k: string, v: string) => {
    storage[k] = v;
    return Promise.resolve();
  });
});

describe('askPosterBeforeApplying', () => {
  it.each([
    ['apply_once', posterHomeStrings.applyPrompt.applyOnce],
    ['earn_too', posterHomeStrings.applyPrompt.earnToo],
  ])('continues and records %s', async (choice, label) => {
    let continued = false;
    const asked = askPosterBeforeApplying(OPTIONS).then(() => {
      continued = true;
    });
    await pressAlertButton(label);
    await asked;

    expect(continued).toBe(true);
    expect(events('poster_apply_prompt_shown')).toEqual([
      ['poster_apply_prompt_shown', { bounty_id: 'bounty-1', surface: 'modal' }],
    ]);
    expect(events('poster_apply_prompt_answered')).toEqual([
      ['poster_apply_prompt_answered', { bounty_id: 'bounty-1', surface: 'modal', choice }],
    ]);
  });

  it('can only be answered with a button, so it can never strand the application', async () => {
    const asked = askPosterBeforeApplying(OPTIONS);
    await flush();
    expect(alertSpy.mock.calls[0][3]).toEqual({ cancelable: false });
    await pressAlertButton(posterHomeStrings.applyPrompt.applyOnce);
    await asked;
  });

  it('asks once per user, including after an app restart', async () => {
    const first = askPosterBeforeApplying(OPTIONS);
    await pressAlertButton(posterHomeStrings.applyPrompt.applyOnce);
    await first;

    __resetPosterApplyPromptForTests();
    await askPosterBeforeApplying(OPTIONS);
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });

  it('asks a different user on the same device', async () => {
    const first = askPosterBeforeApplying(OPTIONS);
    await pressAlertButton(posterHomeStrings.applyPrompt.applyOnce);
    await first;

    const second = askPosterBeforeApplying({ ...OPTIONS, userId: 'user-2' });
    await pressAlertButton(posterHomeStrings.applyPrompt.applyOnce);
    await second;
    expect(alertSpy).toHaveBeenCalledTimes(2);
  });

  it.each([['hunter'], ['both'], [null]])('does not ask when the role is %p', async role => {
    mockRole = role;
    await askPosterBeforeApplying(OPTIONS);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('does not ask with the flag off', async () => {
    await askPosterBeforeApplying({ ...OPTIONS, enabled: false });
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockTrackEvent).not.toHaveBeenCalled();
  });

  it('does not ask on web, where the alert could never be answered', async () => {
    RN.Platform.OS = 'web';
    await askPosterBeforeApplying(OPTIONS);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('continues without asking if storage cannot be read', async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValue(new Error('disk'));
    await askPosterBeforeApplying(OPTIONS);
    expect(alertSpy).not.toHaveBeenCalled();
  });
});

describe('both apply paths', () => {
  const root = join(__dirname, '../../../..');
  it.each([
    ['components/bountydetailmodal.tsx', 'modal'],
    ['app/bounty/[id]/public.tsx', 'public_route'],
  ])('%s asks first and leaves primary_role alone', (file, surface) => {
    const source = readFileSync(join(root, file), 'utf8');
    const ask = source.indexOf('await askPosterBeforeApplying');
    const proceed = source.indexOf('applyLocationGate.run');

    expect(ask).toBeGreaterThan(-1);
    expect(ask).toBeLessThan(proceed);
    expect(source).toContain(`surface: '${surface}'`);
    expect(source).not.toMatch(/primary_role/);
  });
});
