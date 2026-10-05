import { trustSafetyStrings } from '../../../lib/strings/trust-safety';
import { getApplicationSafetyMessage, resolveBountyLifecycle } from '../../../lib/utils/bounty-lifecycle';

describe('application and acceptance safety copy', () => {
  const bounty = { id: 'b1', status: 'open', amount: 50, accepted_by: null };

  it('distinguishes an application sent from official acceptance', () => {
    expect(getApplicationSafetyMessage({ bounty, viewerId: 'me', requestStatus: 'pending', submitted: true }))
      .toBe(trustSafetyStrings.applicationSent);
    expect(getApplicationSafetyMessage({ bounty, viewerId: 'me', requestStatus: 'pending' }))
      .toBe(trustSafetyStrings.pendingApplication);
  });

  it('does not tell a recovered accepted request that it is pending', () => {
    const message = getApplicationSafetyMessage({ bounty, viewerId: 'me', requestStatus: 'accepted' });
    expect(message).not.toMatch(/pending|not accepted yet|officially accepted/i);
    expect(message).toContain('A chat message is not official acceptance');
  });

  it('only acknowledges acceptance for the officially assigned hunter on active work', () => {
    expect(getApplicationSafetyMessage({
      bounty: { ...bounty, status: 'in_progress', accepted_by: 'me' },
      viewerId: 'me', requestStatus: 'accepted',
    })).toBe(trustSafetyStrings.acceptedWork);
  });

  it.each([
    { status: 'in_progress', accepted_by: 'someone-else', viewerId: 'me' },
    { status: 'in_progress', accepted_by: null, viewerId: 'me' },
    { status: 'in_progress', accepted_by: 'me', viewerId: null },
    { status: 'open', accepted_by: 'me', viewerId: 'me' },
    { status: 'completed', accepted_by: 'me', viewerId: 'me' },
    { status: 'cancelled', accepted_by: 'me', viewerId: 'me' },
    { status: 'cancellation_requested', accepted_by: 'me', viewerId: 'me' },
  ])('does not authorize work from a stale request: %j', ({ viewerId, ...state }) => {
    expect(getApplicationSafetyMessage({
      bounty: { ...bounty, ...state }, viewerId, requestStatus: 'accepted',
    })).not.toContain(trustSafetyStrings.acceptedWork);
  });

  it('does not call rejected applications pending', () => {
    expect(getApplicationSafetyMessage({ bounty, viewerId: 'me', requestStatus: 'rejected' }))
      .not.toMatch(/is pending|officially accepted/);
  });

  it('reuses the pending warning in hunter lifecycle education without changing actions', () => {
    const state = resolveBountyLifecycle({ bounty, role: 'hunter', viewerId: 'me', requestStatus: 'pending' });
    expect(state.explanation).toBe(trustSafetyStrings.pendingApplication);
    expect(state.nextStep).toContain('A chat message is not acceptance');
    expect(state.secondaryActions.map(action => action.key)).toContain('withdraw_application');
  });

  it('explains that officially accepted honor work has no funds', () => {
    expect(getApplicationSafetyMessage({
      bounty: { ...bounty, status: 'in_progress', accepted_by: 'me', is_for_honor: true },
      viewerId: 'me', requestStatus: 'accepted',
    })).toContain('no funds are held or paid');
    const state = resolveBountyLifecycle({
      bounty: { ...bounty, is_for_honor: true }, role: 'poster', applicationCount: 1,
    });
    expect(state.nextStep).toContain('no funds are held or paid');
    expect(state.nextStep).not.toContain('escrow');
  });
});
