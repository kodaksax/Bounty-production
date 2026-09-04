/**
 * Lifecycle matrix tests.
 *
 * The point of lib/utils/bounty-lifecycle.ts is that the poster and the hunter
 * see two consistent halves of one story, so most of these assertions are about
 * agreement between the two roles for the same underlying backend state —
 * exactly the class of bug (each screen composing its own sentence) the module
 * exists to prevent.
 */
import {
  BOUNTY_ATTENTION_GROUP_LABELS,
  getBountyAttentionGroup,
  getBountyDetailSurface,
  getBountyStages,
  getWaitingOnLabel,
  resolveBountyLifecycle,
} from '../../../lib/utils/bounty-lifecycle';

const FUTURE = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
const PAST = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

const bounty = (over: Record<string, unknown> = {}) => ({
  id: 'b1',
  status: 'open',
  amount: 50,
  end_date: FUTURE,
  ...over,
});

describe('resolveBountyLifecycle — poster lifecycle', () => {
  it('an open bounty with no applications waits on hunters and needs nothing', () => {
    const s = resolveBountyLifecycle({ bounty: bounty(), role: 'poster', applicationCount: 0 });
    expect(s.status).toBe('open');
    expect(s.waitingOn).toBe('other');
    expect(s.needsAttention).toBe(false);
    expect(s.group).toBe('waiting');
    expect(s.stageIndex).toBe(0);
  });

  it('an open bounty with applications flips to needs-attention with a review CTA', () => {
    const s = resolveBountyLifecycle({ bounty: bounty(), role: 'poster', applicationCount: 3 });
    expect(s.headline).toBe('3 hunters applied');
    expect(s.needsAttention).toBe(true);
    expect(s.waitingOn).toBe('you');
    expect(s.primaryAction?.key).toBe('review_applications');
    expect(s.group).toBe('attention');
  });

  it('singularizes a single application', () => {
    const s = resolveBountyLifecycle({ bounty: bounty(), role: 'poster', applicationCount: 1 });
    expect(s.headline).toBe('1 hunter applied');
  });

  it('in-progress work waits on the hunter and offers messaging, not approval', () => {
    const s = resolveBountyLifecycle({
      bounty: bounty({ status: 'in_progress', accepted_by: 'u2' }),
      role: 'poster',
      otherPartyName: 'Dana',
    });
    expect(s.waitingOn).toBe('other');
    expect(s.needsAttention).toBe(false);
    expect(s.primaryAction?.key).toBe('message');
    expect(s.explanation).toContain('Dana');
    expect(s.stageIndex).toBe(1);
  });

  it('a pending submission becomes the poster’s single most urgent action', () => {
    const s = resolveBountyLifecycle({
      bounty: bounty({ status: 'in_progress', accepted_by: 'u2' }),
      role: 'poster',
      submissionStatus: 'pending',
    });
    expect(s.status).toBe('review_needed');
    expect(s.headline).toBe('Awaiting your approval');
    expect(s.needsAttention).toBe(true);
    expect(s.primaryAction?.key).toBe('review_submission');
    expect(s.stageIndex).toBe(2);
  });

  it('a revision the poster requested hands the ball back to the hunter', () => {
    const s = resolveBountyLifecycle({
      bounty: bounty({ status: 'in_progress', accepted_by: 'u2' }),
      role: 'poster',
      submissionStatus: 'revision_requested',
    });
    expect(s.headline).toBe('Changes requested');
    expect(s.waitingOn).toBe('other');
    expect(s.needsAttention).toBe(false);
  });

  it('completed but unsettled escrow reads as processing, not as paid', () => {
    const held = resolveBountyLifecycle({
      bounty: bounty({ status: 'completed' }),
      role: 'poster',
      paymentState: 'held',
    });
    expect(held.headline).toBe('Payment processing');
    expect(held.tone).toBe('progress');

    const released = resolveBountyLifecycle({
      bounty: bounty({ status: 'completed' }),
      role: 'poster',
      paymentState: 'released',
    });
    expect(released.headline).toBe('Completed — payment released');
    expect(released.primaryAction?.key).toBe('leave_review');
    expect(released.group).toBe('past');
  });

  it('an unclaimed bounty past its deadline pushes repost, not a phantom hunter', () => {
    const s = resolveBountyLifecycle({
      bounty: bounty({ end_date: PAST }),
      role: 'poster',
    });
    expect(s.status).toBe('deadline_passed');
    expect(s.needsAttention).toBe(true);
    expect(s.primaryAction?.key).toBe('repost');
    expect(s.explanation).not.toContain('hunter hasn');
  });

  it('a claimed bounty past its deadline points at the hunter instead', () => {
    const s = resolveBountyLifecycle({
      bounty: bounty({ status: 'in_progress', end_date: PAST, accepted_by: 'u2' }),
      role: 'poster',
    });
    expect(s.status).toBe('deadline_passed');
    expect(s.primaryAction?.key).toBe('message');
    expect(s.secondaryActions.map(a => a.key)).toContain('cancel_bounty');
  });

  it('cancelled and archived postings are terminal and offer a repost', () => {
    for (const status of ['cancelled', 'archived']) {
      const s = resolveBountyLifecycle({ bounty: bounty({ status }), role: 'poster' });
      expect(s.needsAttention).toBe(false);
      expect(s.group).toBe('past');
      expect(s.primaryAction?.key).toBe('repost');
    }
  });
});

describe('resolveBountyLifecycle — hunter lifecycle', () => {
  it('a pending application waits on the poster', () => {
    const s = resolveBountyLifecycle({
      bounty: bounty(),
      role: 'hunter',
      requestStatus: 'pending',
      otherPartyName: 'Sam',
    });
    expect(s.status).toBe('applied');
    expect(s.headline).toBe('Application sent');
    expect(s.waitingOn).toBe('other');
    expect(s.secondaryActions.map(a => a.key)).toContain('withdraw_application');
  });

  it('a rejected application is terminal and routes onward, never to a dead end', () => {
    const s = resolveBountyLifecycle({
      bounty: bounty(),
      role: 'hunter',
      requestStatus: 'rejected',
    });
    expect(s.status).toBe('rejected');
    expect(s.primaryAction?.key).toBe('find_bounties');
    expect(s.group).toBe('past');
  });

  it('accepted work is the hunter’s action item', () => {
    const s = resolveBountyLifecycle({
      bounty: bounty({ status: 'in_progress', accepted_by: 'me' }),
      role: 'hunter',
      requestStatus: 'accepted',
    });
    expect(s.needsAttention).toBe(true);
    expect(s.waitingOn).toBe('you');
    expect(s.primaryAction?.key).toBe('submit_work');
    expect(s.group).toBe('attention');
  });

  it('only the hunter’s own submission reads as submitted for review', () => {
    const mine = resolveBountyLifecycle({
      bounty: bounty({ status: 'in_progress' }),
      role: 'hunter',
      requestStatus: 'accepted',
      submissionStatus: 'pending',
      submissionIsMine: true,
    });
    expect(mine.status).toBe('submitted_for_review');
    expect(mine.waitingOn).toBe('other');

    const someoneElses = resolveBountyLifecycle({
      bounty: bounty({ status: 'in_progress' }),
      role: 'hunter',
      requestStatus: 'accepted',
      submissionStatus: 'pending',
      submissionIsMine: false,
    });
    expect(someoneElses.status).toBe('in_progress');
  });

  it('a still-pending application on a claimed bounty means someone else won it', () => {
    // The poster accepted another hunter; this row was never explicitly
    // rejected. Telling this hunter they are "on the clock" would be a lie.
    const s = resolveBountyLifecycle({
      bounty: bounty({ status: 'in_progress', accepted_by: 'someone-else' }),
      role: 'hunter',
      requestStatus: 'pending',
      otherPartyName: 'Sam',
    });
    expect(s.headline).toBe('Another hunter was selected');
    expect(s.needsAttention).toBe(false);
    expect(s.primaryAction?.key).toBe('find_bounties');
    expect(s.group).toBe('past');
  });

  it('never reports a payout to a hunter who was not the selected one', () => {
    const s = resolveBountyLifecycle({
      bounty: bounty({ status: 'completed', accepted_by: 'someone-else' }),
      role: 'hunter',
      requestStatus: 'pending',
    });
    expect(s.headline).toBe('Another hunter was selected');
    expect(s.explanation).not.toContain('added to your balance');
  });

  it('a requested revision is urgent for the hunter and asks for a resubmit', () => {
    const s = resolveBountyLifecycle({
      bounty: bounty({ status: 'in_progress' }),
      role: 'hunter',
      requestStatus: 'accepted',
      submissionStatus: 'revision_requested',
    });
    expect(s.headline).toBe('Changes requested');
    expect(s.needsAttention).toBe(true);
    expect(s.primaryAction?.label).toBe('Resubmit work');
  });

  it('payment state separates "approved" from "paid"', () => {
    const held = resolveBountyLifecycle({
      bounty: bounty({ status: 'completed' }),
      role: 'hunter',
      requestStatus: 'accepted',
      paymentState: 'held',
    });
    expect(held.headline).toBe('Approved — payment on the way');

    const paid = resolveBountyLifecycle({
      bounty: bounty({ status: 'completed' }),
      role: 'hunter',
      requestStatus: 'accepted',
      paymentState: 'released',
    });
    expect(paid.headline).toBe('Paid');
    expect(paid.tone).toBe('positive');
  });
});

describe('resolveBountyLifecycle — overlays outrank the normal flow', () => {
  it('a dispute freezes both sides and points at support', () => {
    for (const role of ['poster', 'hunter'] as const) {
      const s = resolveBountyLifecycle({
        bounty: bounty({ status: 'in_progress' }),
        role,
        submissionStatus: 'pending',
        submissionIsMine: true,
        hasDispute: true,
      });
      expect(s.headline).toBe('Dispute under review');
      expect(s.waitingOn).toBe('support');
      expect(s.needsAttention).toBe(true);
      expect(s.primaryAction?.key).toBe('view_dispute');
    }
  });

  it('a pending cancellation outranks in-progress work for both sides', () => {
    const s = resolveBountyLifecycle({
      bounty: bounty({ status: 'in_progress' }),
      role: 'poster',
      hasCancellationRequest: true,
    });
    expect(s.status).toBe('cancellation_requested');
    expect(s.primaryAction?.key).toBe('respond_cancellation');

    const fromColumn = resolveBountyLifecycle({
      bounty: bounty({ status: 'cancellation_requested' }),
      role: 'hunter',
      requestStatus: 'accepted',
    });
    expect(fromColumn.status).toBe('cancellation_requested');
    expect(fromColumn.needsAttention).toBe(true);
  });
});

describe('poster and hunter never both think it is the other’s turn', () => {
  const scenarios = [
    { name: 'open with applications', bounty: bounty(), poster: { applicationCount: 2 }, hunter: { requestStatus: 'pending' } },
    {
      name: 'work in progress',
      bounty: bounty({ status: 'in_progress', accepted_by: 'me' }),
      poster: {},
      hunter: { requestStatus: 'accepted' },
    },
    {
      name: 'submitted for review',
      bounty: bounty({ status: 'in_progress', accepted_by: 'me' }),
      poster: { submissionStatus: 'pending' },
      hunter: { requestStatus: 'accepted', submissionStatus: 'pending', submissionIsMine: true },
    },
  ];

  it.each(scenarios)('$name has exactly one side holding the ball', ({ bounty: b, poster, hunter }) => {
    const p = resolveBountyLifecycle({ bounty: b, role: 'poster', ...poster });
    const h = resolveBountyLifecycle({ bounty: b, role: 'hunter', ...hunter });
    const blocked = [p.waitingOn === 'you', h.waitingOn === 'you'].filter(Boolean).length;
    expect(blocked).toBe(1);
    // …and the other side is explicitly told they are waiting.
    expect(p.waitingOn === 'you' ? h.waitingOn : p.waitingOn).toBe('other');
  });
});

describe('visitors', () => {
  it('sees an open bounty as applyable', () => {
    const s = resolveBountyLifecycle({ bounty: bounty(), role: 'visitor' });
    expect(s.primaryAction?.key).toBe('apply');
  });

  it('is told plainly when a bounty is already claimed', () => {
    const s = resolveBountyLifecycle({
      bounty: bounty({ status: 'in_progress' }),
      role: 'visitor',
    });
    expect(s.headline).toBe('Already claimed');
    expect(s.primaryAction?.key).toBe('find_bounties');
  });
});

describe('presentation helpers', () => {
  it('labels stages differently for each role so "review" is unambiguous', () => {
    expect(getBountyStages('poster').map(s => s.label)).toEqual([
      'Posted',
      'In progress',
      'Your review',
      'Paid',
    ]);
    expect(getBountyStages('hunter')[2].label).toBe('In review');
    // Stage ids stay stable across roles — screens key off the id, not the label.
    expect(getBountyStages('poster').map(s => s.id)).toEqual(getBountyStages('hunter').map(s => s.id));
  });

  it('names the party being waited on', () => {
    expect(getWaitingOnLabel('you', 'poster')).toBe('Waiting on you');
    expect(getWaitingOnLabel('other', 'poster', 'Dana')).toBe('Waiting on Dana');
    expect(getWaitingOnLabel('other', 'hunter', null)).toBe('Waiting on the poster');
    expect(getWaitingOnLabel('nobody', 'poster')).toBeNull();
  });

  it('groups on the resolved state, not on the raw status', () => {
    expect(getBountyAttentionGroup({ needsAttention: true, waitingOn: 'other', status: 'completed' })).toBe('attention');
    expect(getBountyAttentionGroup({ needsAttention: false, waitingOn: 'other', status: 'open' })).toBe('waiting');
    expect(getBountyAttentionGroup({ needsAttention: false, waitingOn: 'you', status: 'in_progress' })).toBe('active');
    expect(Object.keys(BOUNTY_ATTENTION_GROUP_LABELS)).toHaveLength(4);
  });
});

describe('getBountyDetailSurface — deep links never land on a wall', () => {
  it('sends the poster to their own dashboard', () => {
    expect(getBountyDetailSurface({ isPoster: true })).toBe('poster');
  });

  it('sends anyone with an application to the hunter hub, rejected included', () => {
    for (const requestStatus of ['pending', 'accepted', 'rejected']) {
      expect(getBountyDetailSurface({ isPoster: false, requestStatus })).toBe('hunter');
    }
  });

  it('keeps an accepted hunter off the public view even when the request lookup failed', () => {
    expect(
      getBountyDetailSurface({ isPoster: false, requestStatus: null, isAcceptedHunter: true })
    ).toBe('hunter');
  });

  it('sends a stranger to the read-only public view, not the poster dashboard', () => {
    // The regression this guards: a shared link used to open the poster's
    // dashboard, which alerted "Access Denied" and called router.back() — with
    // nothing behind it when the link came from outside the app.
    expect(getBountyDetailSurface({ isPoster: false, requestStatus: null })).toBe('public');
    expect(getBountyDetailSurface({ isPoster: false })).toBe('public');
  });
});

describe('money and party name formatting', () => {
  it('renders whole dollars without cents and honors for-honor bounties', () => {
    const paid = resolveBountyLifecycle({ bounty: bounty({ amount: 50 }), role: 'poster', applicationCount: 1 });
    expect(paid.nextStep).toContain('$50');

    const cents = resolveBountyLifecycle({ bounty: bounty({ amount: 12.5 }), role: 'poster', applicationCount: 1 });
    expect(cents.nextStep).toContain('$12.50');

    const honor = resolveBountyLifecycle({
      bounty: bounty({ is_for_honor: true, amount: 0 }),
      role: 'poster',
      applicationCount: 1,
    });
    expect(honor.nextStep).toContain('for honor');
  });

  it('falls back to a role word when the other party has no name yet', () => {
    const s = resolveBountyLifecycle({
      bounty: bounty({ status: 'in_progress' }),
      role: 'poster',
      otherPartyName: '   ',
    });
    expect(s.explanation).toContain('the hunter');
  });
});
