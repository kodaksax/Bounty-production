import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export class AccountOperationBlockedError extends Error {
  readonly code = 'account_operation_blocked';
}
/**
 * Durable reservation, not a lease: a crashed or uncertain financial request
 * must be reconciled before this account can be replaced or used again.
 */
export async function reserveAccountOperation(
  db: SupabaseClient,
  userId: string,
  accountId: string | null,
  kind: string,
  operationKey: string
): Promise<string> {
  const { data, error } = await db.rpc('reserve_connect_account_operation', {
    p_user_id: userId,
    p_account_id: accountId,
    p_kind: kind,
    p_operation_key: operationKey,
  });
  if (error || typeof data !== 'string') {
    throw new AccountOperationBlockedError(
      'Payout account is busy, has changed, or requires reconciliation. Refresh and retry; if this persists, contact support.'
    );
  }
  return data;
}

export async function finishAccountOperation(db: SupabaseClient, operationId: string): Promise<void> {
  const { error } = await db.rpc('finish_connect_account_operation', {
    p_operation_id: operationId,
  });
  if (error) throw new AccountOperationBlockedError('Could not confirm the account operation. Contact support before retrying.');
}

export function isDefinitiveStripeRejection(error: unknown): boolean {
  const type = (error as { type?: string } | null)?.type;
  return type === 'StripeInvalidRequestError' || type === 'StripePermissionError' ||
    type === 'StripeAuthenticationError' || type === 'StripeCardError';
}

export function isDefinitiveDatabaseRejection(error: unknown): boolean {
  return ['23505', '23514', 'P0001', 'P0002'].includes(
    (error as { code?: string } | null)?.code ?? ''
  );
}

/** Checks every currency and nested balance component, including negatives. */
export function hasNonzeroStripeBalance(value: unknown): boolean {
  if (!value || typeof value !== 'object') return true;
  const visit = (node: unknown): boolean => {
    if (Array.isArray(node)) return node.some(visit);
    if (!node || typeof node !== 'object') return false;
    return Object.entries(node).some(([key, component]) =>
      key === 'amount'
        ? typeof component !== 'number' || !Number.isFinite(component) || component !== 0
        : key === 'source_types'
          ? !component || typeof component !== 'object' ||
            Object.values(component).some(amount => typeof amount !== 'number' || amount !== 0)
          : visit(component)
    );
  };
  const balance = value as Record<string, unknown>;
  if (!Array.isArray(balance.available) || !Array.isArray(balance.pending)) return true;
  if ([...balance.available, ...balance.pending].some(bucket =>
    !bucket || typeof bucket !== 'object' || typeof bucket.amount !== 'number' ||
    !Number.isFinite(bucket.amount)
  )) return true;
  return visit(balance);
}
