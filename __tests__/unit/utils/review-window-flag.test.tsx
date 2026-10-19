/**
 * SBA-10 (6): the review-window promise ("If you don't respond, Bounty
 * reviews it" / "Bounty support is reviewing this") stays hidden until its
 * migrations (20261002120000/120100) are live. REVIEW_WINDOW_ENABLED
 * defaults off; review-deadline.test.ts covers the copy with it on.
 */
import { render, screen } from '@testing-library/react-native';
import React from 'react';
import { REVIEW_WINDOW_ENABLED } from '../../../lib/feature-flags';
import { getDisputeReasonOptions } from '../../../lib/utils/dispute-reasons';
import { getReviewDeadlineStatus } from '../../../lib/utils/review-deadline';
import { resolveBountyLifecycle } from '../../../lib/utils/bounty-lifecycle';
import { darkTheme } from '../../../lib/themes/darkTheme';
import { lightTheme } from '../../../lib/themes/lightTheme';

let mockTheme: any = lightTheme;
jest.mock('../../../lib/themes/AppThemeContext', () => ({
  useAppThemeContext: () => ({ theme: mockTheme }),
}));

import { BountyStatusPanel } from '../../../components/ui/bounty-status-panel';

const HOUR = 3600 * 1000;
const submittedAt = new Date(Date.now() - 80 * HOUR).toISOString(); // past 72h
const inProgress = { id: 'b1', status: 'in_progress', amount: 40, accepted_by: 'hunter-1' };

function bothSides() {
  return (['poster', 'hunter'] as const).map(role =>
    resolveBountyLifecycle({
      bounty: inProgress,
      role,
      viewerId: role === 'hunter' ? 'hunter-1' : 'poster-1',
      submissionStatus: 'pending',
      submissionIsMine: role === 'hunter',
      submittedAt,
      otherPartyName: role === 'poster' ? 'Ana' : 'Sam',
    })
  );
}

const SUPPORT_PROMISE = /Bounty support is reviewing|Bounty reviews it|support reviews it anyway|Bounty is reviewing/;

it('defaults off', () => {
  expect(REVIEW_WINDOW_ENABLED).toBe(false);
});

it('no deadline sentence for either side, even past 72h', () => {
  expect(getReviewDeadlineStatus(submittedAt, 'poster')).toBeNull();
  expect(getReviewDeadlineStatus(submittedAt, 'hunter')).toBeNull();
});

it('the lifecycle never says support is reviewing or claims a deadline', () => {
  for (const s of bothSides()) {
    expect(`${s.headline} ${s.explanation} ${s.nextStep}`).not.toMatch(SUPPORT_PROMISE);
    expect(s.waitingOn).not.toBe('support');
    expect(s.reviewDeadline ?? null).toBeNull();
  }
  const [, hunter] = bothSides();
  expect(hunter.headline).toBe('Submitted — awaiting approval');
});

it('the dispute reason help no longer promises a 72-hour support review', () => {
  const hunterSubmitted = getDisputeReasonOptions('hunter', { workSubmitted: true });
  const unresponsive = hunterSubmitted.find(o => o.code === 'poster_unresponsive');
  expect(unresponsive?.help).toBe('Support contacts the poster. The payment stays in escrow while support reviews.');
  for (const role of ['poster', 'hunter'] as const) {
    for (const workSubmitted of [true, false]) {
      for (const o of getDisputeReasonOptions(role, { workSubmitted })) {
        expect(o.help).not.toMatch(/72 hours|support reviews it anyway/);
      }
    }
  }
});

it.each([
  ['light', lightTheme],
  ['dark', darkTheme],
])('the status panel shows no review-window line (%s theme)', (_n, theme) => {
  mockTheme = theme;
  const [poster, hunter] = bothSides();
  const { unmount } = render(<BountyStatusPanel state={poster} role="poster" otherPartyName="Ana" />);
  expect(screen.queryByText(SUPPORT_PROMISE)).toBeNull();
  unmount();
  render(<BountyStatusPanel state={hunter} role="hunter" otherPartyName="Sam" />);
  expect(screen.queryByText(SUPPORT_PROMISE)).toBeNull();
});
