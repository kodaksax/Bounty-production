/**
 * The poster job page's new pieces (2026-11-16 second pass):
 *   - Get help: rows match the job's state; "Where is my money?" answers in
 *     place with the page's own money sentence.
 *   - HireConfirmation: says who was chosen and what happens next.
 *   - ApplicantCard on the job page: plain trust lines, one confirmation not
 *     two, and never "held" before anything was charged.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';
import { lightTheme } from '../../lib/themes/lightTheme';

jest.mock('../../lib/themes/AppThemeContext', () => ({ useAppThemeContext: () => ({ theme: lightTheme }) }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/postings/b-1',
  useGlobalSearchParams: () => ({}),
}));
jest.mock('../../components/ui/verification-badge', () => {
  const { Text } = require('react-native');
  return { VerificationBadge: () => <Text>ID checked</Text> };
});
jest.mock('../../components/ui/avatar', () => {
  const R = require('react');
  const Pass = ({ children }: any) => R.createElement(R.Fragment, null, children);
  return { Avatar: Pass, AvatarImage: () => null, AvatarFallback: Pass };
});

import { ApplicantCard } from '../../components/applicant-card';
import { buildHelpRows, GetHelpSheet, type GetHelpContext } from '../../components/poster-job/get-help-sheet';
import { HireConfirmation } from '../../components/poster-job/hire-confirmation';
import { JobOffersSection } from '../../components/poster-job/job-offers-section';

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => {
  (Alert.alert as jest.Mock).mockRestore?.();
});

const ctx = (over: Partial<GetHelpContext> = {}): GetHelpContext => ({
  helperName: null,
  hired: false,
  canTakeDown: false,
  awaitingApproval: false,
  hasDispute: false,
  completed: false,
  moneyLine: null,
  ...over,
});
const routes = (c: GetHelpContext) => buildHelpRows(c).map(r => r.route);

describe('Get help rows follow the job', () => {
  it('open, nobody chosen: take it down, money, Bounty help, a person', () => {
    expect(routes(ctx({ canTakeDown: true, moneyLine: "You haven't paid anything yet." }))).toEqual([
      'cancel_open',
      'money',
      'assist',
      'support',
    ]);
  });

  it('someone is doing it: message, no-show, missed time, cancel, money, help', () => {
    expect(routes(ctx({ helperName: 'Marcus', hired: true, moneyLine: 'Bounty is holding your $60.' }))).toEqual([
      'message',
      'no_show',
      'missed_time',
      'cancel_hired',
      'money',
      'assist',
      'support',
    ]);
  });

  it('work waiting on the poster: ask to finish / not done properly instead of no-show', () => {
    const r = routes(ctx({ helperName: 'Marcus', hired: true, awaitingApproval: true, moneyLine: 'x' }));
    expect(r).toContain('ask_to_finish');
    expect(r).toContain('work_quality');
    expect(r).not.toContain('no_show');
  });

  it('a reported problem: see the report first, and no new reports on top', () => {
    const r = routes(ctx({ helperName: 'Marcus', hired: true, hasDispute: true, moneyLine: 'x' }));
    expect(r[0]).toBe('see_report');
    expect(r).not.toContain('no_show');
    expect(r).not.toContain('cancel_hired');
  });

  it('never offers to cancel an open job and a hired one at once', () => {
    const r = routes(ctx({ helperName: 'Marcus', hired: true, canTakeDown: false }));
    expect(r).not.toContain('cancel_open');
  });

  it('every row is plain words', () => {
    const all = buildHelpRows(ctx({ helperName: 'Marcus', hired: true, awaitingApproval: true, moneyLine: 'x', canTakeDown: true, hasDispute: true }));
    for (const r of all) {
      expect(`${r.title} ${r.detail}`).not.toMatch(/\b(hunters?|escrow|payouts?|dispute)\b/i);
      expect(`${r.title} ${r.detail}`).not.toMatch(/\bbount(y|ies)\b/);
    }
  });
});

describe('GetHelpSheet', () => {
  it('answers "Where is my money?" in place, with the page\'s own sentence', () => {
    const onRoute = jest.fn();
    render(
      <GetHelpSheet visible onClose={jest.fn()} onRoute={onRoute} {...ctx({ canTakeDown: true, moneyLine: "You haven't paid anything yet. You only pay when you choose someone." })} />
    );
    expect(screen.queryByTestId('get-help-money-answer')).toBeNull();
    fireEvent.press(screen.getByTestId('get-help-money'));
    expect(screen.getByText("You haven't paid anything yet. You only pay when you choose someone.")).toBeTruthy();
    expect(onRoute).not.toHaveBeenCalled();
  });

  it('routes a row and renders nothing while hidden', () => {
    const onRoute = jest.fn();
    const { rerender } = render(<GetHelpSheet visible onClose={jest.fn()} onRoute={onRoute} {...ctx()} />);
    fireEvent.press(screen.getByTestId('get-help-assist'));
    expect(onRoute).toHaveBeenCalledWith('assist');
    rerender(<GetHelpSheet visible={false} onClose={jest.fn()} onRoute={onRoute} {...ctx()} />);
    expect(screen.queryByTestId('get-help-sheet')).toBeNull();
  });
});

describe('HireConfirmation', () => {
  it('names the person, lists what happens next, and offers to message them', () => {
    const onMessage = jest.fn();
    const onDone = jest.fn();
    render(<HireConfirmation visible helperName="Marcus" isForHonor={false} onMessage={onMessage} onDone={onDone} />);
    expect(screen.getByText("You've chosen Marcus")).toBeTruthy();
    expect(screen.getByText('Send Marcus a message.')).toBeTruthy();
    expect(screen.getByText('Agree on a day and time for the work.')).toBeTruthy();
    expect(screen.getByText('You check the work and approve the payment.')).toBeTruthy();
    expect(screen.getByText(/Marcus is paid only after you approve the work/)).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Message Marcus'));
    expect(onMessage).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByLabelText('Back to my job'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('an unpaid favour has no money line', () => {
    render(<HireConfirmation visible helperName="Marcus" isForHonor onMessage={jest.fn()} onDone={jest.fn()} />);
    expect(screen.queryByText(/is paid only after/)).toBeNull();
    expect(screen.getByText('You check the work and mark it done.')).toBeTruthy();
  });

  it('renders nothing until a hire is confirmed', () => {
    render(<HireConfirmation visible={false} helperName="Marcus" isForHonor={false} onMessage={jest.fn()} onDone={jest.fn()} />);
    expect(screen.queryByTestId('hire-confirmation')).toBeNull();
  });
});

const request = (bountyOver: Record<string, unknown> = {}, profileOver: Record<string, unknown> = {}) =>
  ({
    id: 'req-1',
    bounty_id: 'b-1',
    hunter_id: 'h-1',
    status: 'pending',
    created_at: '2026-11-15T00:00:00Z',
    message: 'I have a van.',
    distance_mi: 2,
    bounty: { id: 'b-1', title: 'Remove old furniture', amount: 60, is_for_honor: false, funding_mode: 'at_accept', ...bountyOver },
    profile: { id: 'h-1', username: 'Marcus', hunterCompleted: 6, averageRating: 4.8, ratingCount: 6, stripe_identity_status: 'verified', ...profileOver },
  }) as any;

describe('ApplicantCard on the job page', () => {
  it('keeps explicit confirmation before choosing from pay-at-accept offers', async () => {
    const onChoose = jest.fn().mockResolvedValue(undefined);
    render(
      <JobOffersSection
        offers={[request()]}
        loadState="ready"
        onChoose={onChoose}
        onPass={jest.fn().mockResolvedValue(undefined)}
        onAsk={jest.fn()}
        onRetry={jest.fn()}
        askingRequestId={null}
        isAskBusy={false}
      />
    );

    fireEvent.press(screen.getByLabelText('Choose Marcus'));
    expect(Alert.alert).toHaveBeenCalledWith(
      'Choose Marcus?',
      expect.any(String),
      expect.any(Array),
    );
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('shows who they are in plain words, with a profile button', () => {
    render(<ApplicantCard request={request()} variant="job_page" onAccept={jest.fn()} onReject={jest.fn()} />);
    expect(screen.getByText('6 jobs done on Bounty')).toBeTruthy();
    expect(screen.getByText('★ 4.8 from 6 reviews')).toBeTruthy();
    expect(screen.getByText('ID checked')).toBeTruthy();
    expect(screen.getByText('About 2 mi away')).toBeTruthy();
    expect(screen.getByText('I have a van.')).toBeTruthy();
    expect(screen.getByLabelText("View Marcus's profile and reviews")).toBeTruthy();
    // The tappable header reads the person's summary instead of a second 'View profile'.
    expect(screen.getByLabelText('Marcus. ID checked by Bounty. 6 jobs done on Bounty. ★ 4.8 from 6 reviews. About 2 mi away')).toBeTruthy();
    expect(screen.getByText('Choose Marcus')).toBeTruthy();
    expect(screen.getByText('Not this time')).toBeTruthy();
    expect(screen.queryByText(/Applying to/)).toBeNull();
    expect(screen.queryByText(/hunter/i)).toBeNull();
  });

  it('shows no badge for an unverified person, and no average under the sample size', () => {
    render(
      <ApplicantCard
        request={request({}, { stripe_identity_status: null, ratingCount: 2, averageRating: 5, hunterCompleted: 0 })}
        variant="job_page"
        onAccept={jest.fn()}
        onReject={jest.fn()}
      />
    );
    expect(screen.queryByText('ID checked')).toBeNull();
    expect(screen.getByText('New to Bounty')).toBeTruthy();
    expect(screen.queryByText(/★/)).toBeNull();
  });

  it('pay-when-you-choose: the pay sheet is the one confirmation, so the card asks nothing', async () => {
    const onAccept = jest.fn().mockResolvedValue(undefined);
    render(<ApplicantCard request={request()} variant="job_page" confirmBeforeAccept={false} onAccept={onAccept} onReject={jest.fn()} />);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Choose Marcus'));
    });
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(onAccept).toHaveBeenCalledWith('req-1');
  });

  it('paid up front: the card confirms, says it was already paid, and never "held … now"', async () => {
    const onAccept = jest.fn().mockResolvedValue(undefined);
    render(<ApplicantCard request={request({ funding_mode: 'at_post' })} variant="job_page" onAccept={onAccept} onReject={jest.fn()} />);
    fireEvent.press(screen.getByLabelText('Choose Marcus'));
    const [title, message, buttons] = (Alert.alert as jest.Mock).mock.calls[0];
    expect(title).toBe('Choose Marcus?');
    expect(message).toContain('You already paid $60 when you posted this job.');
    expect(message).not.toMatch(/escrow now|held in escrow/);
    expect(onAccept).not.toHaveBeenCalled();
    await act(async () => {
      buttons.find((b: any) => b.text === 'Choose Marcus').onPress();
    });
    expect(onAccept).toHaveBeenCalledWith('req-1');
  });

  it('the default card (legacy list) no longer says money is held before a charge', () => {
    render(<ApplicantCard request={request()} onAccept={jest.fn()} onReject={jest.fn()} />);
    fireEvent.press(screen.getByLabelText('Choose Marcus for this bounty'));
    const [, message] = (Alert.alert as jest.Mock).mock.calls[0];
    expect(message).not.toMatch(/held in escrow now/);
    expect(message).toContain("Next you'll see exactly what you pay ($60) before anything is charged.");
  });

  it('opens the profile without a referrer, so its back button returns to the offers', () => {
    render(<ApplicantCard request={request()} variant="job_page" onAccept={jest.fn()} onReject={jest.fn()} />);
    fireEvent.press(screen.getByLabelText("View Marcus's profile and reviews"));
    const [target] = mockPush.mock.calls[0];
    expect(target.pathname).toBe('/profile/[userId]');
    expect(target.params).not.toHaveProperty('referrer');
    expect(target.params).toEqual(expect.objectContaining({ userId: 'h-1', isApplicant: 'true', bountyId: 'b-1' }));
  });

  it('"Not this time" asks first and removes only the offer', async () => {
    const onReject = jest.fn().mockResolvedValue(undefined);
    render(<ApplicantCard request={request()} variant="job_page" onAccept={jest.fn()} onReject={onReject} />);
    fireEvent.press(screen.getByText('Not this time'));
    const [title, message, buttons] = (Alert.alert as jest.Mock).mock.calls[0];
    expect(title).toBe('Not this time?');
    expect(message).toContain('Your job stays open');
    expect(onReject).not.toHaveBeenCalled();
    await act(async () => {
      buttons.find((b: any) => b.style === 'destructive').onPress();
    });
    expect(onReject).toHaveBeenCalledWith('req-1');
  });
});
