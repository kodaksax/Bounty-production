import { resolveMaybeAsyncRegistration, safeCleanup } from './lifecycle';

export interface SupabaseAuthSubscription {
  unsubscribe?: () => void;
}

interface SupabaseAuthRegistrationResult {
  data?: {
    subscription?: SupabaseAuthSubscription;
  };
  subscription?: SupabaseAuthSubscription;
}

export function extractSupabaseAuthSubscription(
  registration: unknown
): SupabaseAuthSubscription | undefined {
  const maybe = registration as SupabaseAuthRegistrationResult | undefined;
  return maybe?.data?.subscription ?? maybe?.subscription;
}

export function safeUnsubscribe(
  subscription: SupabaseAuthSubscription | undefined,
  onError?: (error: unknown) => void
): void {
  safeCleanup(subscription, onError);
}

export function resolveSupabaseAuthSubscription(
  registration: unknown,
  onResolved: (subscription: SupabaseAuthSubscription | undefined) => void,
  onError?: (error: unknown) => void
): void {
  const applyResolvedSubscription = (resolvedValue: unknown) => {
    onResolved(extractSupabaseAuthSubscription(resolvedValue));
  };

  resolveMaybeAsyncRegistration(registration, applyResolvedSubscription, onError);
}
