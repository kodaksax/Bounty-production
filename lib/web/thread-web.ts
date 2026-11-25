/**
 * The job strip and the one pinned next step for a bounty thread on the
 * website (bountyfinder.net/bounty?id=), built by the app's own rules — the
 * same calls app/tabs/bounty-thread/[bountyId].tsx makes: describeJobStrip,
 * buildBountyThreadEvents, selectPinnedThreadCard and describePinnedCard.
 *
 * Pure and UI-free; bundled for the web-account Edge Function (see
 * lib/web/app-rules.ts).
 */
import { calculateHunterEarnings } from '../constants/fees';
import { firstName, formatJobAmount } from '../my-jobs/format';
import { describeJobStrip } from '../my-jobs/job-strip';
import {
  buildBountyThreadEvents,
  describePinnedCard,
  selectPinnedThreadCard,
  type BountyThreadAction,
  type BountyThreadInput,
  type BountyThreadRole,
} from '../utils/bounty-thread-events';

export interface WebThreadInput {
  role: BountyThreadRole;
  viewerId: string;
  bounty: BountyThreadInput['bounty'];
  /** The application between this hunter and this bounty. */
  request?: BountyThreadInput['request'];
  submission?: BountyThreadInput['submission'];
  cancellation?: BountyThreadInput['cancellation'];
  dispute?: BountyThreadInput['dispute'];
  counterpart: { id: string | null; name: string | null } | null;
  /** Whether the money for a completed job has reached the hunter. */
  paymentState?: 'released' | 'pending' | 'unknown' | null;
}

/**
 * What the website can do from a pinned card today. The rest (sending work,
 * answering a cancellation) are app-only for now, so their card shows the next
 * step in words without a button rather than a button that can't succeed.
 */
const WEB_PINNED_ACTION: Partial<Record<BountyThreadAction, 'approve_release'>> = {
  review_and_pay: 'approve_release',
};

export interface WebThreadView {
  strip: { side: 'posted' | 'offered' | 'doing' | 'did'; icon: string; text: string };
  pinned: {
    mode: 'your_turn' | 'waiting';
    /** The event the card was taken from: the website hides that card's own buttons. */
    event_kind: string;
    label: string;
    title: string;
    text: string | null;
    /** The button's words, only when the website can do it. */
    button: string | null;
    /** The website's action for the button (web-account card action). */
    web_action: 'approve_release' | null;
    /** True when it is the viewer's turn but the step can only be taken in the app. */
    app_only: boolean;
  } | null;
}

export function describeWebThread(input: WebThreadInput): WebThreadView {
  const { role, viewerId, bounty } = input;
  const counterpartName = input.counterpart?.name?.trim() || '';
  const strip = describeJobStrip({
    role,
    viewerId,
    counterpartId: input.counterpart?.id ?? null,
    bounty,
    counterpartName: firstName(counterpartName) ?? counterpartName,
    paymentState: input.paymentState ?? null,
  });

  const events = buildBountyThreadEvents({
    role,
    viewerId,
    bounty,
    request: input.request ?? null,
    submission: input.submission ?? null,
    cancellation: input.cancellation ?? null,
    dispute: input.dispute ?? null,
  });
  const pinned = selectPinnedThreadCard(events, role);
  if (!pinned) return { strip: { ...strip, icon: String(strip.icon) }, pinned: null };

  const other = firstName(counterpartName) ?? (role === 'poster' ? 'your helper' : 'the poster');
  const copy = describePinnedCard(pinned, role, other, {
    amount: bounty.is_for_honor ? null : formatJobAmount(bounty.amount),
    takeHome: bounty.is_for_honor ? null : formatJobAmount(calculateHunterEarnings(bounty.amount).net),
  });
  const yourTurn = pinned.mode === 'your_turn';
  const webAction = yourTurn && pinned.event.action ? WEB_PINNED_ACTION[pinned.event.action] ?? null : null;
  return {
    strip: { ...strip, icon: String(strip.icon) },
    pinned: {
      mode: pinned.mode,
      event_kind: pinned.event.kind,
      label: copy.label,
      title: copy.title,
      text: copy.text,
      button: webAction ? copy.button : null,
      web_action: webAction,
      app_only: yourTurn && !!copy.button && !webAction,
    },
  };
}
