/**
 * Contract tests for BountyStatusPanel — the component every bounty-management
 * surface renders instead of writing its own "what now?" copy.
 *
 * Two of these lock in behaviour the screens depend on:
 *  - an action with no handler is not rendered, which is how a screen opts out
 *    of an action it can't perform without the lifecycle needing to know;
 *  - destructive/secondary actions stay behind a disclosure, so the primary
 *    action is never one of several equal buttons.
 */
import { fireEvent, render } from '@testing-library/react-native';
import { BountyStatusPanel } from '../../components/ui/bounty-status-panel';
import { resolveBountyLifecycle } from '../../lib/utils/bounty-lifecycle';

const posterAwaitingApproval = () =>
  resolveBountyLifecycle({
    bounty: { id: 'b1', status: 'in_progress', amount: 50, accepted_by: 'h1' },
    role: 'poster',
    submissionStatus: 'pending',
    otherPartyName: 'Dana',
  });

describe('BountyStatusPanel', () => {
  it('leads with the headline, the explanation and what happens next', () => {
    const state = posterAwaitingApproval();
    const { getByText } = render(
      <BountyStatusPanel state={state} role="poster" otherPartyName="Dana" onAction={{}} />
    );

    getByText('Awaiting your approval');
    getByText('Waiting on you');
    getByText('Dana submitted the work for this bounty.');
    getByText(/Approve it to release \$50/);
  });

  it('renders the primary action only when the screen wired up a handler', () => {
    const state = posterAwaitingApproval();

    const withoutHandler = render(
      <BountyStatusPanel state={state} role="poster" onAction={{}} />
    );
    expect(withoutHandler.queryByText('Review & release payment')).toBeNull();

    const onReview = jest.fn();
    const withHandler = render(
      <BountyStatusPanel
        state={state}
        role="poster"
        onAction={{ review_submission: onReview }}
      />
    );
    fireEvent.press(withHandler.getByText('Review & release payment'));
    expect(onReview).toHaveBeenCalledTimes(1);
  });

  it('keeps secondary and destructive actions behind a disclosure', () => {
    const state = resolveBountyLifecycle({
      bounty: { id: 'b1', status: 'in_progress', amount: 50, accepted_by: 'h1' },
      role: 'poster',
      otherPartyName: 'Dana',
    });
    // open_dispute is the poster's destructive action on an in-progress bounty.
    // This used to assert on cancel_bounty, but a cancellation REQUEST is the
    // hunter's exit — granting one refunds the poster's escrow in full — so the
    // poster is no longer offered it at all. The contract under test is the
    // disclosure, not which action happens to sit behind it.
    const onDispute = jest.fn();
    const { getByText, queryByText } = render(
      <BountyStatusPanel
        state={state}
        role="poster"
        otherPartyName="Dana"
        onAction={{ message: jest.fn(), open_dispute: onDispute }}
      />
    );

    // Collapsed: the primary action is the only button on screen.
    expect(getByText('Message Dana')).toBeTruthy();
    expect(queryByText('Open a dispute')).toBeNull();

    fireEvent.press(getByText('More actions'));
    fireEvent.press(getByText('Open a dispute'));
    expect(onDispute).toHaveBeenCalledTimes(1);
  });

  it('never offers the primary action twice as a secondary', () => {
    const state = posterAwaitingApproval();
    const { getAllByText } = render(
      <BountyStatusPanel
        state={{ ...state, secondaryActions: [...state.secondaryActions, state.primaryAction!] }}
        role="poster"
        onAction={{ review_submission: jest.fn(), message: jest.fn(), open_dispute: jest.fn() }}
      />
    );
    expect(getAllByText('Review & release payment')).toHaveLength(1);
  });

  it('collapses to a single line for list rows, with no buttons', () => {
    const state = posterAwaitingApproval();
    const { queryByText, getByText } = render(
      <BountyStatusPanel
        state={state}
        role="poster"
        otherPartyName="Dana"
        variant="inline"
        onAction={{ review_submission: jest.fn() }}
      />
    );
    getByText('Waiting on you');
    expect(queryByText('Review & release payment')).toBeNull();
    expect(queryByText('More actions')).toBeNull();
  });

  it('marks the primary action disabled while it is running', () => {
    const state = posterAwaitingApproval();
    const { getByLabelText } = render(
      <BountyStatusPanel
        state={state}
        role="poster"
        onAction={{ review_submission: jest.fn() }}
        busyAction="review_submission"
      />
    );
    const button = getByLabelText('Review & release payment');
    expect(button.props.accessibilityState?.disabled).toBe(true);
  });
});
