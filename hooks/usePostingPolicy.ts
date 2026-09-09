import { useEffect, useState } from 'react';
import { supabase } from 'lib/supabase';

export interface PostingPolicy {
  /** Whether the composer may offer the "post for honor" ($0) option. */
  honorPostsEnabled: boolean;
  /** Minimum paid bounty amount, in dollars. */
  minimumAmount: number;
}

/**
 * Defaults are the CLOSED state, deliberately.
 *
 * This hook mirrors `public.posting_policy_config`, which the
 * `trg_bounties_enforce_posting_policy` trigger reads when it decides whether
 * to accept a bounty. The server is the enforcement point — it has to be,
 * because `post_switched_to_honor` fired on three different shipped builds in
 * a two-week window and a client-side gate reaches only the users who update.
 *
 * The client's job is just to avoid showing a control the server will refuse.
 * So on a slow network, a failed read, or a signed-out render, we show the
 * restricted UI rather than optimistically offering an option that would then
 * fail at publish. Being briefly stricter than the server is a non-event;
 * being briefly looser is the bug this exists to prevent.
 */
const CLOSED_DEFAULT: PostingPolicy = {
  honorPostsEnabled: false,
  minimumAmount: 5,
};

/**
 * PostgREST serialises `numeric` columns as JSON strings ('5', '2.50'), not
 * numbers — the wire type depends on the column type, so a `typeof === 'number'`
 * check alone would reject every real value `posting_policy_config.minimum_amount`
 * returns and silently fall back to the default. Accept both, and reject
 * anything that is not a finite, non-negative number.
 */
function parseMinimumAmount(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN;

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function usePostingPolicy(): PostingPolicy {
  const [policy, setPolicy] = useState<PostingPolicy>(CLOSED_DEFAULT);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data, error } = await supabase
          .from('posting_policy_config')
          .select('honor_posts_enabled, minimum_amount')
          .maybeSingle();

        if (cancelled || error || !data) return;

        setPolicy({
          honorPostsEnabled: data.honor_posts_enabled === true,
          minimumAmount:
            parseMinimumAmount(data.minimum_amount) ?? CLOSED_DEFAULT.minimumAmount,
        });
      } catch {
        // Keep the closed default.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return policy;
}

export default usePostingPolicy;
