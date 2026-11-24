/**
 * Shared shapes for the My Jobs tab (app/tabs/my-jobs-screen.tsx).
 *
 * My Jobs shows the one job that needs the user most, whichever side of it
 * they are on, with every other job a tap away. Everything the tab renders is
 * derived — by the pure functions in this folder — from records the app
 * already loads (the user's posted bounties, their own bounty_requests, the
 * pending applications on their open bounties, completion submissions and
 * conversations). Nothing here is stored.
 */
import type { MaterialIcons } from '@expo/vector-icons';
import type { BountyRequestWithDetails } from '../services/bounty-request-service';
import type { Bounty } from '../services/database.types';
import type { BountyLifecycleState, BountyLifecycleTone } from '../utils/bounty-lifecycle';

export type IconName = keyof typeof MaterialIcons.glyphMap;

/** Which side of the job the viewer is on. */
export type JobSide = 'posted' | 'doing';

/**
 * Featured-job priority, most urgent first. Mirrors the "Which job is
 * featured" rule in the design: a problem beats someone waiting on you, which
 * beats new offers, then messages, then work happening, then waiting on the
 * other person. Finished jobs always come last.
 */
export const JOB_RANK = {
  problem: 1,
  waitingOnYou: 2,
  newOffers: 3,
  newMessage: 4,
  working: 5,
  waiting: 6,
  finished: 7,
} as const;

export type JobRank = (typeof JOB_RANK)[keyof typeof JOB_RANK];

/**
 * Where a job's button goes. Screens map these onto routes; this layer stays
 * free of navigation so it can be unit-tested.
 *
 * - `workspace`: the job's own screen (/postings/[id] or /in-progress/[id]/hunter).
 * - `thread`: the bounty conversation; `withId` names the hunter on the poster side.
 * - `applicants`: the "Who offered" sheet on My Jobs.
 */
export type JobTarget =
  | { kind: 'workspace'; side: JobSide; bountyId: string }
  | { kind: 'thread'; side: JobSide; bountyId: string; withId?: string | null }
  | { kind: 'applicants'; bountyId: string };

export interface JobStatusLine {
  icon: IconName;
  text: string;
  tone: BountyLifecycleTone;
}

export interface MyJob {
  /** Stable across loads: `${side}:${bountyId}`. */
  key: string;
  bountyId: string;
  side: JobSide;
  bounty: Bounty;
  lifecycle: BountyLifecycleState;
  rank: JobRank;
  /** Shown as "Needs you" in words. */
  needsYou: boolean;
  /** Completed, cancelled or otherwise over. */
  finished: boolean;
  title: string;
  /** Who and how much: "Posted Monday · $60", "Jordan K. · you get $72". */
  contextLine: string;
  /** What just happened, in a few words: "3 people want to help". */
  status: JobStatusLine;
  /** One or two sentences: what it means, and the money truth. */
  detail: string | null;
  /** "Posted Monday · newest offer today". Null when there is nothing to add. */
  historyLine: string | null;
  cta: { label: string; target: JobTarget };
  /** The other person, when known. */
  counterpartName: string | null;
  /** Unread messages on this job's conversation. */
  unread: number;
  /** First image the poster attached, if any. */
  coverUri: string | null;
  /** Category icon, used when there is no photo. */
  icon: IconName;
  /** When the current need began. Ties in rank go to whoever waited longest. */
  attentionSince: string | null;
  /** Unreviewed offers on a job the viewer posted. */
  pendingOfferCount: number;
}

/** Offers the viewer sent, grouped as in the "Your offers" list. */
export type OfferStatus = 'waiting' | 'chosen' | 'not_going_ahead';

export interface MyOffer {
  key: string;
  bountyId: string;
  bounty: Bounty;
  request: BountyRequestWithDetails;
  status: OfferStatus;
  title: string;
  posterName: string | null;
  amountLabel: string;
  /** "Sofia hasn't chosen yet", "Jordan chose you", "Closed: no answer in 3 days". */
  statusText: string;
  statusIcon: IconName;
  /** Extra line under a waiting offer, e.g. the money truth. Null when none. */
  detail: string | null;
  /** "Sofia L. · sent Thursday". */
  subtitle: string;
  icon: IconName;
  coverUri: string | null;
}

export interface MyJobsModel {
  /** Every job, sorted by featured priority. */
  jobs: MyJob[];
  /** Every offer the viewer sent that is still on their list. */
  offers: MyOffer[];
}
