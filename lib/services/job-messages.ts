/**
 * Sends a message in the pair's existing job conversation from a workspace
 * (the time picks in poster stage F and hunter H.5). It is an ordinary chat
 * message — the same getOrCreateConversation + sendMessage path the chat
 * screens use — not a booking: nothing is stored about the time.
 */
import { analyticsService } from './analytics-service';
import * as supabaseMessaging from './supabase-messaging';

export async function sendJobMessage(args: {
  viewerId: string;
  otherId: string;
  bountyId: string;
  text: string;
}): Promise<{ conversationId: string }> {
  const conversation = await supabaseMessaging.getOrCreateConversation(args.viewerId, args.otherId, args.bountyId);
  if (!conversation?.id) throw new Error('No conversation was returned');
  await supabaseMessaging.sendMessage(String(conversation.id), args.text, args.viewerId);
  analyticsService
    .trackEvent('message_sent', {
      conversationId: String(conversation.id),
      messageLength: args.text.length,
      source: 'workspace_time_pick',
    })
    .catch(() => {});
  return { conversationId: String(conversation.id) };
}
