/**
 * SBA-10 (2): a hunter with a pending application is told how long the poster
 * has to decide, and that an automatic closure is not held against them. The
 * window mirrors fn_expire_bounty_requests: request_expiry_hours normally,
 * request_interacted_expiry_hours once the poster has engaged.
 */
import { render, screen } from '@testing-library/react-native';
import React from 'react';
import { resolveBountyLifecycle } from '../../../lib/utils/bounty-lifecycle';
import {
  describeApplicationWindow,
  formatExpiryWindow,
  parseExpiryHours,
} from '../../../lib/utils/request-expiry';
import { darkTheme } from '../../../lib/themes/darkTheme';
import { lightTheme } from '../../../lib/themes/lightTheme';

let mockTheme: any = lightTheme;
jest.mock('../../../lib/themes/AppThemeContext', () => ({
  useAppThemeContext: () => ({ theme: mockTheme }),
}));

import { BountyStatusPanel } from '../../../components/ui/bounty-status-panel';

const openBounty = { id: 'b1', status: 'open', amount: 40, is_for_honor: false };

function applied(extra: Record<string, unknown> = {}) {
  return resolveBountyLifecycle({
    bounty: openBounty,
    role: 'hunter',
    requestStatus: 'pending',
    otherPartyName: 'Sam',
    ...extra,
  });
}

describe('request expiry copy', () => {
  it('formats whole days and leftover hours', () => {
    expect(formatExpiryWindow(72)).toBe('3 days');
    expect(formatExpiryWindow(24)).toBe('1 day');
    expect(formatExpiryWindow(168)).toBe('7 days');
    expect(formatExpiryWindow(36)).toBe('36 hours');
    expect(formatExpiryWindow(1)).toBe('1 hour');
  });

  it('accepts the policy value as a number or numeric string, nothing else', () => {
    expect(parseExpiryHours(72)).toBe(72);
    expect(parseExpiryHours('48')).toBe(48);
    expect(parseExpiryHours(0)).toBeNull();
    expect(parseExpiryHours(-5)).toBeNull();
    expect(parseExpiryHours('abc')).toBeNull();
    expect(parseExpiryHours(null)).toBeNull();
  });

  it('capitalises the fallback party name at the start of the sentence', () => {
    expect(describeApplicationWindow('the poster')).toMatch(/^The poster has 3 days to decide\./);
  });
});

describe('resolveBountyLifecycle — hunter application window', () => {
  it('tells the hunter the poster has 3 days and that a closure does not count against them', () => {
    const s = applied();
    expect(s.headline).toBe('Application sent');
    expect(s.timingNote).toBe(
      "Sam has 3 days to decide. If they don't, your application closes automatically, and that doesn't count against you."
    );
  });

  it('uses the live policy value', () => {
    const s = applied({ requestExpiryPolicy: { expiryHours: 48, interactedExpiryHours: 168 } });
    expect(s.timingNote).toMatch(/^Sam has 2 days to decide\./);
  });

  it('describes the longer window once the poster has engaged', () => {
    const s = applied({ requestPosterInteracted: true });
    expect(s.timingNote).toMatch(/^Sam has been in touch, so they have up to 7 days from then to decide\./);
  });

  it('keeps the safety copy in nextStep', () => {
    expect(applied().nextStep).toContain('A chat message is not acceptance');
  });

  it('only applies to a pending application', () => {
    for (const requestStatus of ['accepted', 'rejected']) {
      const s = resolveBountyLifecycle({ bounty: openBounty, role: 'hunter', requestStatus });
      expect(s.timingNote ?? null).toBeNull();
    }
    expect(resolveBountyLifecycle({ bounty: openBounty, role: 'poster' }).timingNote ?? null).toBeNull();
  });
});

describe('BountyStatusPanel — timing note', () => {
  it.each([
    ['light', lightTheme],
    ['dark', darkTheme],
  ])('renders the note in the %s theme and reads it to screen readers', (_name, theme) => {
    mockTheme = theme;
    const state = applied();
    render(<BountyStatusPanel state={state} role="hunter" otherPartyName="Sam" />);
    const note = screen.getByText(state.timingNote as string);
    const style = Object.assign({}, ...[note.props.style].flat(Infinity));
    expect(style.color).toBe(theme.textSecondary);
    expect(screen.getByTestId('bounty-status-timing')).toBeTruthy();
    expect(screen.getByLabelText(new RegExp("doesn't count against you"))).toBeTruthy();
  });

  it('stays out of the compact inline row used in lists', () => {
    render(<BountyStatusPanel state={applied()} role="hunter" otherPartyName="Sam" variant="inline" />);
    expect(screen.queryByTestId('bounty-status-timing')).toBeNull();
  });
});
