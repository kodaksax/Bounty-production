/**
 * Which manage actions each job offers. These are the old Inbox's long-press
 * rules (edit, take down, discard cancelled, archive, hide), now shared by the
 * featured card's "Other options" and the switcher's ⋯ menu.
 */
import {
  EDIT_LOCKED_REASON,
  getJobManageActions,
  getOfferAction,
} from '../../../lib/my-jobs/manage-actions';
import type { MyJob, MyOffer } from '../../../lib/my-jobs/types';

function job(over: Partial<MyJob> & { bounty: Partial<MyJob['bounty']> }): MyJob {
  return {
    side: 'posted',
    finished: false,
    pendingOfferCount: 0,
    ...over,
    bounty: { id: 'b1', status: 'open', ...over.bounty },
  } as MyJob;
}

const keys = (j: MyJob) => getJobManageActions(j).map((a) => a.key);

describe('getJobManageActions — jobs you posted', () => {
  it('open with nobody chosen: edit and take down (danger last)', () => {
    const actions = getJobManageActions(job({ bounty: {} }));
    expect(actions.map((a) => a.key)).toEqual(['edit', 'take_down']);
    expect(actions[0].disabledReason).toBeUndefined();
    expect(actions[1].tone).toBe('danger');
  });

  it('offers already in: edit is listed but locked, with the reason', () => {
    const [edit] = getJobManageActions(job({ bounty: {}, pendingOfferCount: 2 }));
    expect(edit.key).toBe('edit');
    expect(edit.disabledReason).toBe(EDIT_LOCKED_REASON);
    expect(edit.icon).toBe('lock-outline');
  });

  it('deadline passed: no edit, still take down', () => {
    expect(keys(job({ bounty: { end_date: '2020-01-01T00:00:00Z' } as never }))).toEqual(['take_down']);
  });

  it('someone chosen: nothing to manage here (the job screen handles it)', () => {
    expect(keys(job({ bounty: { status: 'in_progress', accepted_by: 'ada' } }))).toEqual([]);
  });

  it('cancelled: remove from list only', () => {
    expect(keys(job({ bounty: { status: 'cancelled' }, finished: true }))).toEqual(['discard_cancelled']);
  });

  it('completed: archive only', () => {
    expect(keys(job({ bounty: { status: 'completed' }, finished: true }))).toEqual(['archive']);
  });
});

describe('getJobManageActions — work you are doing', () => {
  it('finished work can be removed from your list', () => {
    expect(keys(job({ side: 'doing', finished: true, bounty: { status: 'completed' } }))).toEqual(['hide']);
  });

  it('live work has nothing to manage from the tab', () => {
    expect(keys(job({ side: 'doing', bounty: { status: 'in_progress' } }))).toEqual([]);
  });
});

describe('getOfferAction', () => {
  const offer = (status: MyOffer['status']) => ({ status }) as MyOffer;
  it('one action per offer', () => {
    expect(getOfferAction(offer('waiting'))).toEqual({ key: 'withdraw', label: 'Withdraw my offer', tone: 'danger' });
    expect(getOfferAction(offer('chosen')).key).toBe('open');
    expect(getOfferAction(offer('not_going_ahead')).key).toBe('remove');
  });
});
