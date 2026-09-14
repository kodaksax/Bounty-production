import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import type { BountyRequestWithDetails } from 'lib/services/bounty-request-service';
import { messageService } from 'lib/services/message-service';
import { analyticsService } from 'lib/services/analytics-service';
import { logClientError } from 'lib/services/monitoring';
import { supabase } from 'lib/supabase';

interface UseAskApplicantParams {
  /** The applicant list currently on screen, used to resolve a request id. */
  bountyRequests: BountyRequestWithDetails[];
}

/**
 * Open a conversation with an applicant *before* deciding on them.
 *
 * Why this exists: accepting is irreversible and, under pay-at-accept, is the
 * moment money moves. Until now the only way to talk to a hunter was to accept
 * them first — `app/postings/[bountyId]/index.tsx`'s message action refuses
 * outright ("You can message a hunter once you have selected one for this
 * bounty") and only renders once `accepted_by` is set. So a poster had to
 * commit to a stranger, usually unverified and usually photoless, that they
 * could not ask a single question. Freezing is the rational response, and the
 * production numbers show posters doing exactly that.
 *
 * `ApplicantCard` has always had the affordance for this — an `onRequestMoreInfo`
 * prop rendering an "Ask a question" button — but neither screen that renders
 * the card passed the handler, so the button never appeared. This hook is that
 * missing handler.
 *
 * The thread is scoped to the bounty (`bountyId` is passed through to
 * `rpc_get_or_create_dm_conversation`) so the conversation carries the job it
 * is about. Note the live RPC still matches an existing 1:1 thread on
 * participants only and ignores `p_bounty_id` in its lookup, so today a
 * poster/hunter pair who have spoken before will land back in their existing
 * thread rather than a per-bounty one. That is tracked separately; passing the
 * id here is correct regardless and is what makes the per-bounty fix a
 * server-side change only.
 */
/**
 * How long taps stay ignored after the messenger push, so taps landing during
 * the screen transition can't stack a second conversation screen.
 */
export const ASK_APPLICANT_NAV_LOCK_MS = 1000;

export function useAskApplicant({ bountyRequests }: UseAskApplicantParams) {
  const router = useRouter();
  const [askingRequestId, setAskingRequestId] = useState<string | null>(null);
  // Synchronous guard. Opening the thread awaits an RPC before navigating, and
  // `askingRequestId` state can't block taps that arrive before the next
  // render, so every tap during that round-trip used to push its own messenger
  // screen (GitHub #810).
  const inFlightRef = useRef(false);
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (releaseTimerRef.current) clearTimeout(releaseTimerRef.current);
    },
    []
  );

  const handleAskApplicant = useCallback(
    async (requestId: string | number) => {
      if (inFlightRef.current) return;

      const request = bountyRequests.find((r) => String(r.id) === String(requestId));
      const hunterId = request?.hunter_id ? String(request.hunter_id) : null;

      if (!request || !hunterId) {
        Alert.alert(
          "Couldn't open the conversation",
          "We couldn't work out who this application belongs to. Pull to refresh and try again."
        );
        return;
      }

      inFlightRef.current = true;
      setAskingRequestId(String(requestId));
      let navigated = false;
      try {
        const conversation = await messageService.getOrCreateConversation(
          [hunterId],
          '',
          request.bounty_id ? String(request.bounty_id) : undefined
        );

        if (!conversation?.id) throw new Error('no conversation id returned');

        // Sizes the fix: how often a poster talks to an applicant before
        // deciding, and whether doing so converts into an acceptance.
        analyticsService.trackEvent('applicant_question_opened', {
          surface: 'applicant_card',
          bountyId: request.bounty_id ? String(request.bounty_id) : undefined,
          requestId: String(requestId),
          hunterId,
        });

        // Mark this specific application as one the poster engaged with
        // before deciding, so the request-expiry sweep never auto-closes it
        // out from under an active conversation. Stamped via RPC (server's
        // now()), not a client timestamp -- a skewed device clock must never
        // be able to move the expiry watermark. Best-effort and silent:
        // missing this stamp only costs the (unlikely) case of this exact
        // request also going unanswered for request_expiry_hours, never a
        // user-facing failure.
        void supabase
          .rpc('fn_mark_poster_interacted', { p_request_id: String(requestId) })
          .then(({ error }) => {
            if (error) {
              logClientError('Failed to stamp poster_interacted_at', { error, requestId });
            }
          });

        router.push(`/tabs/messenger/${encodeURIComponent(String(conversation.id))}` as never);
        navigated = true;
      } catch (error) {
        logClientError('Failed to open pre-acceptance conversation with applicant', {
          error,
          requestId: String(requestId),
          hunterId,
        });
        Alert.alert(
          "Couldn't open the conversation",
          'Check your connection and try again. Your bounty and this application are unaffected.'
        );
      } finally {
        const release = () => {
          releaseTimerRef.current = null;
          inFlightRef.current = false;
          setAskingRequestId(null);
        };
        if (navigated) {
          releaseTimerRef.current = setTimeout(release, ASK_APPLICANT_NAV_LOCK_MS);
        } else {
          release();
        }
      }
    },
    [bountyRequests, router]
  );

  return { handleAskApplicant, askingRequestId };
}

export default useAskApplicant;
