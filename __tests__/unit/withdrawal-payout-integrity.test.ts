/**
 * Flow-level regression guards for the 2026-08-13 withdrawal integrity
 * incident.
 *
 * The Edge Function handlers take live Stripe/Supabase clients and are wired
 * into Deno.serve, so — matching the convention in
 * connect-native-payout-contract.test.ts and withdrawal-validation.test.ts —
 * these are source-level assertions about the shipped code paths. The
 * behavioural half of the coverage lives in payout-state-machine.test.ts,
 * which exercises the real shared module both functions import.
 *
 * What these defend: the money paths in connect/index.ts must never write a
 * terminal success status, and webhooks/index.ts must be the only thing that
 * ever does.
 */
import * as fs from 'fs';
import * as path from 'path';

const FN = path.join(__dirname, '../../supabase/functions');

const connectSource = fs.readFileSync(path.join(FN, 'connect/index.ts'), 'utf8');
const webhooksSource = fs.readFileSync(path.join(FN, 'webhooks/index.ts'), 'utf8');
const reconciliationSource = fs.readFileSync(path.join(FN, 'reconciliation/index.ts'), 'utf8');

/**
 * Slices the source between two unique markers. Both must exist, and the end
 * marker must follow the start — a silently empty region would turn every
 * assertion below into a false pass, which is the one failure mode a
 * regression guard must not have.
 */
function regionBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`start marker not found: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`end marker not found after start: ${endMarker}`);
  return source.slice(start, end);
}

/** Strips line and block comments so prose about the bug is not mistaken for the bug. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// ---------------------------------------------------------------------------
// The failure path from the incident
// ---------------------------------------------------------------------------

// The catch block that handles a failed instant payout. Bounded by two log
// strings unique to this route — `} catch (payoutError) {` alone also matches
// handleConnectNativePayout's own catch further up the file.
const instantFallbackBlock = stripComments(
  regionBetween(
    connectSource,
    '[connect/instant-payout] instant payout failed, creating standard payout instead',
    '[connect/instant-payout] instant payout created'
  )
);

describe('instant-payout fallback — the exact path that caused the incident', () => {
  test('never writes a completed status', () => {
    expect(instantFallbackBlock).not.toMatch(/status:\s*'completed'/);
  });

  test('inserts the withdrawal as pending', () => {
    expect(instantFallbackBlock).toMatch(/status:\s*'pending'/);
  });

  test('creates a real standard payout rather than relying on an automatic sweep', () => {
    expect(instantFallbackBlock).toContain('stripe.payouts.create');
    expect(instantFallbackBlock).toMatch(/method:\s*'standard'/);
  });

  test('creates that payout as the connected account', () => {
    expect(instantFallbackBlock).toContain('stripeAccount: p.stripe_connect_account_id');
  });

  test('persists the payout id it just created', () => {
    expect(instantFallbackBlock).toContain('stripe_payout_id: fallbackPayout?.id');
  });

  test('still records that a fallback happened and why', () => {
    expect(instantFallbackBlock).toContain('instant_payout_attempted_but_fell_back: true');
    expect(instantFallbackBlock).toContain('instant_payout_error');
  });

  test('does not swallow the instant failure', () => {
    expect(instantFallbackBlock).toContain('writePayoutAudit');
    expect(instantFallbackBlock).toMatch(/console\.warn|logCritical/);
  });

  test('uses a deterministic payout idempotency key', () => {
    expect(instantFallbackBlock).toContain('buildPayoutIdempotencyKey');
  });

  test('records a loud failure when the standard payout cannot be created either', () => {
    expect(instantFallbackBlock).toContain('payout_creation_failed');
    expect(instantFallbackBlock).toContain('logCritical');
  });

  test('reports pending, not completed, back to the client', () => {
    expect(instantFallbackBlock).toMatch(/status:\s*'pending'/);
    expect(instantFallbackBlock).not.toMatch(/status:\s*'completed'/);
  });
});

// ---------------------------------------------------------------------------
// Every withdrawal-writing route in connect
// ---------------------------------------------------------------------------

describe('connect Edge Function — no route completes a withdrawal', () => {
  const withdrawalInserts = [
    ...stripComments(connectSource).matchAll(/type:\s*'withdrawal'[\s\S]{0,900}?\}/g),
  ].map(m => m[0]);

  test('there are withdrawal-writing sites to check', () => {
    expect(withdrawalInserts.length).toBeGreaterThan(0);
  });

  test('not one withdrawal write sets status completed', () => {
    for (const site of withdrawalInserts) {
      expect(site).not.toMatch(/status:\s*'completed'/);
    }
  });

  test('the whole function never assigns a completed status', () => {
    // Withdrawals are the only thing this function writes a terminal status
    // for, so every remaining occurrence of the literal would be a regression.
    const completedWrites = [...stripComments(connectSource).matchAll(/status:\s*'completed'/g)];
    expect(completedWrites).toHaveLength(0);
  });

  test('no response defaults an unknown status to completed', () => {
    expect(stripComments(connectSource)).not.toMatch(/\?\?\s*'completed'/);
  });
});

describe('standard /transfer route — the other 13 unverifiable rows', () => {
  const strippedConnect = stripComments(connectSource);
  const transferBlock = stripComments(
    regionBetween(
      connectSource,
      '[connect/transfer] creating Stripe transfer',
      '[connect/transfer] Stripe transfer created'
    )
  );

  test('creates a payout after the transfer instead of stopping at hop one', () => {
    const region = regionBetween(
      strippedConnect,
      '[connect/transfer] Stripe transfer created',
      '[connect/transfer] withdrawal submitted'
    );
    expect(region).toContain('stripe.payouts.create');
    expect(region).toMatch(/method:\s*'standard'/);
    expect(region).toContain('stripe_payout_id: standardPayout?.id');
    expect(region).toMatch(/status:\s*'pending'/);
  });

  test('the transfer step itself still never completes the row', () => {
    expect(transferBlock).not.toMatch(/status:\s*'completed'/);
  });
});

describe('withdrawal serialization pre-check', () => {
  const stripped = stripComments(connectSource);

  test('both money routes check for an in-flight withdrawal before debiting', () => {
    const preChecks = [...stripped.matchAll(/findInFlightWithdrawal\(supabase, userId\)/g)];
    expect(preChecks.length).toBeGreaterThanOrEqual(2);
  });

  test('the pre-check runs before begin_legacy_withdrawal in the transfer route', () => {
    const routeStart = stripped.indexOf('[connect/transfer] blocked');
    const debit = stripped.indexOf("rpc('begin_legacy_withdrawal'", routeStart);
    expect(routeStart).toBeGreaterThan(-1);
    expect(debit).toBeGreaterThan(routeStart);
  });

  test('a lost race refunds rather than stranding a deducted balance', () => {
    expect(stripped).toContain('idx_wallet_tx_one_pending_withdrawal');
    expect(stripped).toContain('inFlightWithdrawalResponse');
  });

  test('both legacy money-moving routes reserve the pending row before the Stripe call', () => {
    const transferRoute = regionBetween(
      stripped,
      "if (subPath === '/transfer')",
      "if (subPath === '/retry-transfer')"
    );
    const instantRoute = regionBetween(
      stripped,
      "if (subPath === '/instant-payout')",
      "if (req.method === 'GET' && subPath === '/bank-accounts')"
    );
    expect(transferRoute.indexOf("rpc('begin_legacy_withdrawal'")).toBeGreaterThan(-1);
    expect(transferRoute.indexOf("rpc('begin_legacy_withdrawal'")).toBeLessThan(
      transferRoute.indexOf('stripe.transfers.create')
    );
    expect(instantRoute.indexOf("rpc('begin_legacy_withdrawal'")).toBeGreaterThan(-1);
    expect(instantRoute.indexOf("rpc('begin_legacy_withdrawal'")).toBeLessThan(
      instantRoute.indexOf('stripe.transfers.create')
    );
  });

  test('retry-transfer re-reserves the failed row before creating a new transfer', () => {
    const retryRoute = regionBetween(
      stripped,
      "if (subPath === '/retry-transfer')",
      "if (subPath === '/instant-payout')"
    );
    expect(retryRoute.indexOf("rpc('retry_failed_withdrawal'")).toBeGreaterThan(-1);
    expect(retryRoute.indexOf("rpc('retry_failed_withdrawal'")).toBeLessThan(
      retryRoute.indexOf('stripe.transfers.create')
    );
  });

  test('retry-transfer does not swallow a post-payout history update failure', () => {
    const retryRoute = regionBetween(
      stripped,
      "if (subPath === '/retry-transfer')",
      "if (subPath === '/instant-payout')"
    );
    expect(retryRoute).toContain('retry transfer succeeded but transaction record failed');
    expect(retryRoute).toContain('Transaction history may take a moment to update.');
    expect(retryRoute).toContain('.select()');
    expect(retryRoute).toContain('.single()');
  });
});

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

describe('webhooks — payout.paid is the sole completion authority', () => {
  const strippedWebhooks = stripComments(webhooksSource);
  const paidBlock = regionBetween(
    strippedWebhooks,
    "case 'payout.paid'",
    "case 'payout.updated'"
  );

  test('payout.paid promotes the withdrawal to completed', () => {
    expect(paidBlock).toMatch(/status:\s*'completed'/);
    expect(paidBlock).toContain("from('wallet_transactions')");
  });

  test('the promotion is a compare-and-set on pending, making replay a no-op', () => {
    expect(paidBlock).toMatch(/\.eq\('status',\s*'pending'\)/);
  });

  test('completion sets completed_at', () => {
    expect(paidBlock).toContain('completed_at');
  });

  test('the shared decision function gates every payout event', () => {
    expect(strippedWebhooks).toContain('decidePayoutEventAction');
    expect(strippedWebhooks).toContain("from '../_shared/payout-state.ts'");
  });
});

describe('webhooks — payout matching is identifier-based only', () => {
  const matcher = stripComments(
    regionBetween(
      webhooksSource,
      'async function findCandidateWithdrawalTx(',
      'async function reconcileInstantPayoutFee('
    )
  );

  test('matches on stripe_payout_id', () => {
    expect(matcher).toContain("eq('stripe_payout_id', payout.id)");
  });

  test('no longer guesses a row by amount', () => {
    // The removed heuristic attached dashboard-initiated payouts to unrelated
    // withdrawals and could refund balance against an already-delivered one.
    expect(matcher).not.toContain("eq('amount'");
    expect(matcher).not.toContain('payoutAmountDollars');
    expect(matcher).not.toContain("order('created_at'");
  });

  test('a lookup error is raised rather than treated as "no match"', () => {
    expect(matcher).toContain('throw byPayoutIdError');
  });
});

describe('webhooks — payouts never correlate a withdrawal heuristically', () => {
  const strippedWebhooks = stripComments(webhooksSource);

  test('the webhook code no longer includes the two-hop fallback matcher', () => {
    expect(strippedWebhooks).not.toContain('findWithdrawalAwaitingPayoutId');
    expect(strippedWebhooks).not.toContain('selectTwoHopWithdrawalMatch');
  });

  test('both payout.created and payout.paid stay on strict payout-id lookup', () => {
    const created = stripComments(
      regionBetween(webhooksSource, "case 'payout.created':", "case 'payout.paid':")
    );
    const paid = stripComments(
      regionBetween(webhooksSource, "case 'payout.paid':", "case 'payout.updated':")
    );
    expect(created).toContain('findCandidateWithdrawalTx');
    expect(created).not.toContain('findWithdrawalAwaitingPayoutId');
    expect(paid).toContain('findCandidateWithdrawalTx');
    expect(paid).not.toContain('findWithdrawalAwaitingPayoutId');
  });
});

describe('webhooks — failed and canceled payouts never complete a withdrawal', () => {
  const undelivered = stripComments(
    regionBetween(
      webhooksSource,
      'async function handleUndeliveredPayout(',
      'async function handlePayoutStatusUpdate('
    )
  );

  test('routes the failed transition through the atomic refund RPC', () => {
    expect(undelivered).toContain("rpc('fail_legacy_withdrawal'");
    expect(undelivered).not.toMatch(/status:\s*'completed'/);
  });

  test('duplicate or out-of-order deliveries still no-op instead of refunding twice', () => {
    expect(undelivered).toContain('Skipping duplicate refund');
    expect(undelivered).not.toMatch(/\.eq\('status',\s*'completed'\)/);
  });

  test('refunds are routed through the shared decision function', () => {
    expect(undelivered).toContain('decidePayoutEventAction');
  });

  test('an unmatched payout takes no ledger action', () => {
    expect(undelivered).toContain('matches no withdrawal by payout id');
  });
});

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

describe('reconciliation — the blind spot is closed', () => {
  const stripped = stripComments(reconciliationSource);

  test('a completed withdrawal with no payout id is reported as CRITICAL', () => {
    expect(stripped).toContain('completed_withdrawal_without_payout');
  });

  test('the null-payout branch is no longer gated on pending alone', () => {
    // The pre-fix code reached the null-payout check only when
    // status === 'pending', so completed rows fell off the end of the loop.
    // Bounds come from the raw source: the markers are comments.
    const loopRegion = stripComments(
      regionBetween(reconciliationSource, 'Ledger-side sweep', 'Invariant sweep')
    );
    expect(loopRegion).toContain("status === 'completed'");
    expect(loopRegion).toContain('completed_withdrawal_without_payout');
  });

  test('the invariant sweep is not limited to the reconcile window', () => {
    expect(stripped).toContain("is('stripe_payout_id', null)");
    expect(stripped).toContain('completed_withdrawal_without_payout_total');
  });

  test('the reverse divergence (paid in Stripe, pending in the ledger) is reported', () => {
    expect(stripped).toContain('pending_withdrawal_past_payout_deadline');
  });

  test('findings are written with the lowercase severity the table accepts', () => {
    // reconciliation_findings has CHECK (severity IN ('info','warning',
    // 'critical')) but this file's Severity type is uppercase. Without the
    // fold, every insert fails the constraint and is swallowed — the job
    // reports counts while persisting nothing.
    expect(stripped).toContain('severity: f.severity.toLowerCase()');
  });

  test('a failed findings insert is logged as CRITICAL, not swallowed quietly', () => {
    expect(stripped).toContain('findings_persist_failed');
  });

  test('the sweep reports and never repairs', () => {
    // Bounds from the raw source — the closing marker is a comment.
    const sweep = stripComments(
      regionBetween(reconciliationSource, 'invariantRows', 'Repeated webhook failures')
    );
    expect(sweep).not.toContain('.update(');
    expect(sweep).not.toContain('.insert(');
  });
});

// ---------------------------------------------------------------------------
// The database constraint
// ---------------------------------------------------------------------------

describe('database invariant', () => {
  const migrationsDir = path.join(FN, '../migrations');
  const constraintMigration = fs.readFileSync(
    path.join(migrationsDir, '20260816120100_enforce_completed_withdrawal_requires_payout.sql'),
    'utf8'
  );

  test('a CHECK constraint enforces completion requires a payout id', () => {
    expect(constraintMigration).toContain(
      'wallet_transactions_completed_withdrawal_requires_payout'
    );
    expect(constraintMigration).toContain('stripe_payout_id IS NOT NULL');
  });

  test('the constraint is scoped to withdrawals', () => {
    expect(constraintMigration).toMatch(/type\s*<>\s*'withdrawal'/);
  });

  test('historical rows are grandfathered by date, not deleted or rewritten', () => {
    expect(constraintMigration).toContain('created_at <');
    expect(constraintMigration).not.toMatch(/\bUPDATE\s+public\.wallet_transactions/i);
    expect(constraintMigration).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  test('the grandfather cutoff is in the past, so the constraint actually bites', () => {
    // A future-dated cutoff makes the whole CHECK inert without failing
    // anything: every new row satisfies the escape clause. The first draft of
    // this migration used 2026-08-17 while running on 2026-08-16 and was
    // silently a no-op until a live probe caught it.
    const match = constraintMigration.match(
      /created_at\s*<\s*TIMESTAMPTZ\s*'([^']+)'/i
    );
    expect(match).not.toBeNull();
    const cutoff = new Date(match![1]);
    expect(Number.isNaN(cutoff.getTime())).toBe(false);
    expect(cutoff.getTime()).toBeLessThan(Date.now());
  });

  test('the cutoff is after the newest known historical violation', () => {
    // The 25 grandfathered rows end at 2026-08-14 14:44 UTC. A cutoff earlier
    // than that would make the migration fail to apply against live data.
    const match = constraintMigration.match(/created_at\s*<\s*TIMESTAMPTZ\s*'([^']+)'/i);
    const cutoff = new Date(match![1]);
    expect(cutoff.getTime()).toBeGreaterThan(new Date('2026-08-14T14:44:08Z').getTime());
  });

  test('one Stripe payout cannot settle two withdrawals', () => {
    expect(constraintMigration).toContain('idx_wallet_tx_stripe_payout_id_unique');
    expect(constraintMigration).toContain('UNIQUE INDEX');
  });

  test('the audit log table the code writes to is created', () => {
    const auditMigration = fs.readFileSync(
      path.join(migrationsDir, '20260816120000_create_payout_audit_log.sql'),
      'utf8'
    );
    expect(auditMigration).toContain('CREATE TABLE IF NOT EXISTS public.payout_audit_log');
    expect(auditMigration).toContain('ENABLE ROW LEVEL SECURITY');
  });
});

// ---------------------------------------------------------------------------
// Analytics taxonomy — the 2026-08-24 payout_failed misclassification
//
// A single hunter with a stuck $96 pending withdrawal retried 36 times over
// six days. Every retry hit the exact 409 this section pins, and the client
// tracked every one of them as `payout_failed` because the response carried
// no signal distinguishing "the backend refused to call Stripe" from "Stripe
// was called and failed". These tests pin the `stripeAttempted` contract that
// fixes it: `false` (or absent) on every pre-flight rejection, `true` only on
// the handful of catch blocks that follow an actual
// stripe.transfers.create()/payouts.create() call. See
// classifyPayoutFailure() in lib/utils/payout-analytics.ts, which both
// withdrawal paths key off of.
// ---------------------------------------------------------------------------

describe('connect Edge Function — stripeAttempted marks genuine provider failures only', () => {
  const stripped = stripComments(connectSource);

  test('the in-flight-withdrawal 409 is explicitly marked as not having called Stripe', () => {
    const fn = regionBetween(
      stripped,
      'function inFlightWithdrawalResponse(',
      'function normalizePayoutStatusForLedger('
    );
    expect(fn).toContain('stripeAttempted: false');
    expect(fn).toContain('pendingAmount');
  });

  // Bounded by route-dispatch tokens (`if (subPath === '...')`), not by log
  // strings — a route's console.log/console.error wording can change for
  // purely cosmetic reasons and must not be able to break these contract
  // tests. This mirrors the boundary style the pre-existing "both legacy
  // money-moving routes reserve..." test above already uses.
  test('the legacy /transfer route marks its post-transfer-attempt failures as stripeAttempted', () => {
    const transferRoute = regionBetween(
      stripped,
      "if (subPath === '/transfer')",
      "if (subPath === '/retry-transfer')"
    );
    const stripeAttemptedFlags = transferRoute.match(/stripeAttempted:\s*true/g) ?? [];
    // Two exits from the stripe.transfers.create() catch block are
    // client-facing failure responses: the refund-also-failed case and the
    // mapped Stripe error case. Nothing else in this route may carry the flag.
    expect(stripeAttemptedFlags.length).toBe(2);
  });

  test('the same contract holds for /retry-transfer', () => {
    const retryRoute = regionBetween(
      stripped,
      "if (subPath === '/retry-transfer')",
      "if (subPath === '/payout')"
    );
    const stripeAttemptedFlags = retryRoute.match(/stripeAttempted:\s*true/g) ?? [];
    expect(stripeAttemptedFlags.length).toBe(2);
  });

  test('the /instant-payout platform-transfer step marks its failures as stripeAttempted', () => {
    const instantRoute = regionBetween(
      stripped,
      "if (subPath === '/instant-payout')",
      "if (req.method === 'GET' && subPath === '/bank-accounts')"
    );
    const stripeAttemptedFlags = instantRoute.match(/stripeAttempted:\s*true/g) ?? [];
    // The platform-transfer step's catch block accounts for both of these;
    // the later instant-payout-falls-back-to-standard path never returns a
    // client-facing error (it always leaves the row pending), so it must not
    // add any more.
    expect(stripeAttemptedFlags.length).toBe(2);
  });

  test('handleConnectNativePayout marks only its post-payouts.create() catch as stripeAttempted', () => {
    const handlerBody = (() => {
      const start = stripped.indexOf('async function handleConnectNativePayout(');
      const bodyStart = stripped.indexOf('{', start);
      let depth = 0;
      for (let i = bodyStart; i < stripped.length; i++) {
        if (stripped[i] === '{') depth++;
        if (stripped[i] === '}') {
          depth--;
          if (depth === 0) return stripped.slice(bodyStart, i + 1);
        }
      }
      throw new Error('unterminated handleConnectNativePayout body');
    })();
    const stripeAttemptedFlags = handlerBody.match(/stripeAttempted:\s*true/g) ?? [];
    // Every other error exit in this function (validation, eligibility,
    // insufficient balance, no in-flight check needed here since the caller
    // does it, account/balance read failures) is pre-flight and must not
    // carry the flag — only the payouts.create() catch does.
    expect(stripeAttemptedFlags.length).toBe(1);
  });
});
