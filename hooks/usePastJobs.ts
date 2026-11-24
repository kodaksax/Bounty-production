/**
 * Data for Profile › Past jobs (Focus-first P.1), from reads the app already
 * makes: your bounties (bountyService.getByUserId), your offers with their
 * bounties (bountyRequestService.getAllWithDetails), the chosen helpers' names
 * for jobs you posted (getAllWithDetailsBatch — the same call the poster's
 * applicant list uses), your rating (ratingsService.getAggregatedStats) and
 * the reviews behind it (ratingsService.getByUserId, paged), and refunds from
 * the wallet you already have loaded. Nothing is written.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  buildPastJobs,
  describeRatingFact,
  pastOutcome,
  refundsByBounty,
  type PastJobs,
  type RatingFact,
} from '../lib/my-jobs/past-jobs';
import { bountyRequestService, type BountyRequestWithDetails } from '../lib/services/bounty-request-service';
import { bountyService } from '../lib/services/bounty-service';
import type { Bounty } from '../lib/services/database.types';
import { ratingsService } from '../lib/services/ratings';
import { getBountyPaymentSettlementStates, type BountyPaymentSettlement } from '../lib/services/bounty-payments-service';
import type { UserRating } from '../lib/types';
import { useWallet } from '../lib/wallet-context';

/** get_user_reviews returns at most 50 rows per call. */
const REVIEW_PAGE = 50;
const MAX_REVIEW_PAGES = 4;
const HISTORY_PAGE_SIZE = 100;
const PAST_STATUSES = ['completed', 'cancelled', 'archived'];

async function loadReviews(userId: string, total: number | null): Promise<UserRating[]> {
  const all: UserRating[] = [];
  for (let page = 0; page < MAX_REVIEW_PAGES; page++) {
    const batch = await ratingsService.getByUserId(userId, { limit: REVIEW_PAGE, offset: page * REVIEW_PAGE });
    all.push(...batch);
    if (batch.length < REVIEW_PAGE || (total != null && all.length >= total)) break;
  }
  return all;
}

interface Loaded {
  posted: Bounty[];
  offers: BountyRequestWithDetails[];
  helperNames: Map<string, string>;
  reviews: UserRating[] | null;
  aggregate: { averageRating: number; ratingCount: number } | null;
  paymentStates: Map<string, BountyPaymentSettlement>;
}

const EMPTY: Loaded = {
  posted: [],
  offers: [],
  helperNames: new Map(),
  reviews: null,
  aggregate: null,
  paymentStates: new Map(),
};

async function loadPostedPages(userId: string): Promise<Bounty[]> {
  const all: Bounty[] = [];
  for (let offset = 0; ; offset += HISTORY_PAGE_SIZE) {
    const page = await bountyService.getByUserId(userId, {
      statuses: PAST_STATUSES,
      includeArchived: true,
      limit: HISTORY_PAGE_SIZE,
      offset,
      throwOnError: true,
    });
    all.push(...page);
    if (page.length < HISTORY_PAGE_SIZE) return all;
  }
}

async function loadOfferPages(userId: string): Promise<BountyRequestWithDetails[]> {
  const all: BountyRequestWithDetails[] = [];
  for (let page = 1; ; page++) {
    const batch = await bountyRequestService.getAllWithDetails({
      userId,
      page,
      pageSize: HISTORY_PAGE_SIZE,
      throwOnError: true,
    });
    all.push(...batch);
    if (batch.length < HISTORY_PAGE_SIZE) return all;
  }
}

export interface PastJobsState extends PastJobs {
  rating: RatingFact;
  loading: boolean;
  failed: boolean;
  reload: () => Promise<void>;
}

export function usePastJobs(userId: string | null): PastJobsState {
  const { transactions } = useWallet();
  const [data, setData] = useState<Loaded>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setFailed(false);
    try {
      const [mine, offers, aggregate] = await Promise.all([
        loadPostedPages(userId),
        loadOfferPages(userId),
        ratingsService.getAggregatedStats(userId).catch(() => null),
      ]);
      const posted = (mine ?? []).filter((b) => pastOutcome(b) != null);
      const hired = posted.filter((b) => !!b.accepted_by);
      const [requests, reviews] = await Promise.all([
        hired.length > 0
          ? bountyRequestService
              .getAllWithDetailsBatch(hired.map((b) => b.id), { status: 'accepted', throwOnError: true })
              .catch(() => [] as BountyRequestWithDetails[])
          : Promise.resolve([] as BountyRequestWithDetails[]),
        loadReviews(userId, aggregate?.ratingCount ?? null).catch(() => null),
      ]);
      const paymentIds = [...posted, ...offers.map((offer) => offer.bounty).filter((b): b is Bounty => !!b)]
        .filter((b) => pastOutcome(b) === 'completed' && Number((b as any).payment_architecture_version ?? 1) >= 2)
        .map((b) => String(b.id));
      const paymentStates = paymentIds.length > 0
        ? await getBountyPaymentSettlementStates(paymentIds).catch(() => new Map<string, BountyPaymentSettlement>())
        : new Map<string, BountyPaymentSettlement>();
      const helperNames = new Map<string, string>();
      for (const b of hired) {
        const chosen = requests.find(
          (r) => String(r.bounty_id) === String(b.id) && String(r.hunter_id) === String(b.accepted_by)
        );
        const name = chosen?.profile?.username?.trim();
        if (name) helperNames.set(String(b.id), name);
      }
      setData({ posted, offers, helperNames, reviews, aggregate, paymentStates });
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const refunds = useMemo(() => refundsByBounty(transactions), [transactions]);
  const paymentStates = useMemo(() => {
    const states = new Map(data.paymentStates);
    for (const transaction of transactions) {
      const bountyId = transaction.details?.bounty_id;
      if (
        transaction.type === 'release' &&
        bountyId != null &&
        (transaction.details?.settlementState === 'ledger_only' || transaction.details?.settlementState === 'stripe_settled')
      ) {
        states.set(String(bountyId), 'released');
      }
    }
    return states;
  }, [data.paymentStates, transactions]);
  const jobs = useMemo(
    () =>
      buildPastJobs({
        viewerId: userId ?? '',
        posted: data.posted,
        offers: data.offers,
        helperNames: data.helperNames,
        reviews: data.reviews,
        refunds,
        paymentStates,
      }),
    [userId, data, refunds, paymentStates]
  );
  const rating = useMemo(
    () =>
      describeRatingFact({
        reviews: data.reviews,
        aggregate: data.aggregate,
        workedAsHelper: jobs.work.length > 0,
        didIds: new Set(jobs.work.map((r) => r.bountyId)),
        postedIds: new Set(jobs.posted.map((r) => r.bountyId)),
      }),
    [data.reviews, data.aggregate, jobs]
  );

  return { ...jobs, rating, loading, failed, reload };
}
