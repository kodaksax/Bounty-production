/**
 * A wallet top-up whose result isn't known yet, remembered on the device so
 * the poster can leave the pay screen (E.3) without any later screen charging
 * them again. One per user: while it is unresolved no new top-up is offered.
 *
 * It is cleared only by a definite answer from the server, which reads the
 * PaymentIntent from Stripe (POST /wallet/deposit: idempotent, credits only a
 * succeeded payment):
 *   credited     Stripe captured it and the wallet has the money
 *   not_charged  Stripe says no money moved, so paying again is safe
 *   pending      anything else, including "couldn't ask"
 * Nothing is inferred from balances or from how long it has been, with one
 * exception: a bank check (3-D Secure) the payer walked away from stays
 * requires_action / requires_confirmation for good, so after an hour, with
 * Stripe itself still saying so, it counts as not charged.
 */
import { config } from 'lib/config';
import { API_BASE_URL } from 'lib/config/api';
import { storage } from 'lib/storage';
import { supabase } from 'lib/supabase';
import { logger } from 'lib/utils/error-logger';

export interface UnresolvedDepositRecord {
  paymentIntentId: string;
  amount: number;
  bountyId: string;
  hunterName: string;
  savedAt: string;
}

export type DepositVerdict = 'credited' | 'not_charged' | 'pending';

export const ABANDONED_AUTH_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

/** This session's copy, so a failed disk write still guards until the app closes. */
const memory = new Map<string, UnresolvedDepositRecord>();
let lastSave: Promise<void> = Promise.resolve();

const storageKey = (userId: string) => `@bounty/unresolved_deposit/${userId}`;
/** Used in memory only, when the session can't be read. */
const ANY_USER = '*';

async function currentSession(): Promise<{ userId: string; token: string } | null> {
  try {
    const { data } = await supabase.auth.getSession();
    const s = data?.session;
    return s?.user?.id && s.access_token ? { userId: String(s.user.id), token: s.access_token } : null;
  } catch {
    return null;
  }
}

function parse(raw: string | null): UnresolvedDepositRecord | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw);
    return typeof r?.paymentIntentId === 'string' && typeof r?.bountyId === 'string' && Number.isFinite(r?.amount) ? r : null;
  } catch {
    return null;
  }
}

export function saveUnresolvedDeposit(record: Omit<UnresolvedDepositRecord, 'savedAt'>): Promise<void> {
  const full = { ...record, savedAt: new Date().toISOString() };
  // Guards from this instant; moved under the user's own key below.
  memory.set(ANY_USER, full);
  lastSave = (async () => {
    const session = await currentSession();
    if (!session) return;
    memory.set(session.userId, full);
    memory.delete(ANY_USER);
    await storage.setItem(storageKey(session.userId), JSON.stringify(full));
  })();
  return lastSave;
}

export async function loadUnresolvedDeposit(): Promise<UnresolvedDepositRecord | null> {
  await lastSave.catch(() => {});
  const session = await currentSession();
  if (!session) return memory.get(ANY_USER) ?? null;
  const held = memory.get(session.userId) ?? memory.get(ANY_USER);
  if (held) return held;
  return parse(await storage.getItem(storageKey(session.userId)));
}

async function clearUnresolvedDeposit(record: UnresolvedDepositRecord): Promise<void> {
  for (const [key, held] of memory) if (held.paymentIntentId === record.paymentIntentId) memory.delete(key);
  const session = await currentSession();
  if (!session) return;
  const key = storageKey(session.userId);
  // Never drop a newer payment's record.
  if (parse(await storage.getItem(key))?.paymentIntentId === record.paymentIntentId) await storage.removeItem(key);
}

async function askServer(record: UnresolvedDepositRecord, now: number): Promise<DepositVerdict> {
  const session = await currentSession();
  if (!session) return 'pending';
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE_URL}/wallet/deposit`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.token}`,
        'Content-Type': 'application/json',
        ...(config.supabase.anonKey ? { apikey: config.supabase.anonKey } : {}),
      },
      body: JSON.stringify({ amount: record.amount, paymentIntentId: record.paymentIntentId }),
      signal: abort.signal,
    });
    if (res.ok) return 'credited';
    const code = (await res.json().catch(() => null))?.code;
    if (res.status === 409) {
      if (code === 'status_canceled' || code === 'status_requires_payment_method') return 'not_charged';
      if (code === 'status_requires_action' || code === 'status_requires_confirmation') {
        const age = now - new Date(record.savedAt).getTime();
        return age >= ABANDONED_AUTH_MS ? 'not_charged' : 'pending';
      }
    }
    logger.warning('Unresolved deposit is still unresolved', {
      operation: 'unresolved_deposit',
      paymentIntentId: record.paymentIntentId,
      status: res.status,
      code,
    });
    return 'pending';
  } catch {
    return 'pending';
  } finally {
    clearTimeout(timer);
  }
}

/** Asks what happened and clears the record on a definite answer. Never throws. */
export async function reconcileUnresolvedDeposit(
  record: UnresolvedDepositRecord,
  now: number = Date.now()
): Promise<DepositVerdict> {
  const verdict = await askServer(record, now);
  if (verdict !== 'pending') await clearUnresolvedDeposit(record).catch(() => {});
  return verdict;
}

/** Test seam. */
export function resetUnresolvedDepositMemory(): void {
  memory.clear();
  lastSave = Promise.resolve();
}
