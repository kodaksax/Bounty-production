import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import type { BountyRequestWithDetails } from 'lib/services/bounty-request-service';
import { messageService } from 'lib/services/message-service';
import { analyticsService } from 'lib/services/analytics-service';
import { logClientError } from 'lib/services/monitoring';

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
export function useAskApplicant({ bountyRequests }: UseAskApplicantParams) {
  const router = useRouter();
  const [askingRequestId, setAskingRequestId] = useState<string | null>(null);

  const handleAskApplicant = useCallback(
    async (requestId: string | number) => {
      const request = bountyRequests.find((r) => String(r.id) === String(requestId));
      const hunterId = request?.hunter_id ? String(request.hunter_id) : null;

      if (!request || !hunterId) {
        Alert.alert(
          "Couldn't open the conversation",
          "We couldn't work out who this application belongs to. Pull to refresh and try again."
        );
        return;
      }

      setAskingRequestId(String(requestId));
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

        router.push(`/tabs/messenger/${encodeURIComponent(String(conversation.id))}` as never);
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
        setAskingRequestId(null);
      }
    },
    [bountyRequests, router]
  );

  return { handleAskApplicant, askingRequestId };
}

export default useAskApplicant;
