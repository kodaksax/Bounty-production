/**
 * Regression tests: blocked-user enforcement on the messaging RPC client paths.
 *
 * The actual block check lives server-side (see
 * supabase/migrations/20260725150000_trust_safety_hardening.sql --
 * is_blocked_pair / conversation_has_block, wired into
 * rpc_get_or_create_dm_conversation and rpc_create_conversation). Jest can't
 * exercise real Postgres RLS/RPC logic, so these tests instead pin down the
 * client contract that makes that server-side enforcement effective: when
 * Supabase returns an error from either RPC (e.g. the new "cannot create or
 * reopen a conversation with a blocked user" exception), the client must
 * propagate it as a rejected promise rather than silently swallowing it or
 * falling through to create a conversation/local fallback anyway.
 */

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    from: jest.fn(),
    auth: { getUser: jest.fn() },
  },
}));

jest.mock('../../../lib/services/monitoring', () => ({
  logClientError: jest.fn(),
}));

import { createConversation, getOrCreateConversation } from '../../../lib/services/supabase-messaging';
import { supabase } from '../../../lib/supabase';

describe('supabase-messaging block enforcement', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('getOrCreateConversation', () => {
    it('propagates a block-rejection error from rpc_get_or_create_dm_conversation instead of succeeding', async () => {
      const blockError = { message: 'cannot create or reopen a conversation with a blocked user', code: '42501' };
      (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: blockError });

      await expect(getOrCreateConversation('me', 'blocked-user')).rejects.toEqual(blockError);

      expect(supabase.rpc).toHaveBeenCalledWith(
        'rpc_get_or_create_dm_conversation',
        expect.objectContaining({ p_user_id: 'me', p_other_user_id: 'blocked-user' })
      );
      // Must never fall through to reading conversations after a rejected RPC.
      expect(supabase.from).not.toHaveBeenCalled();
    });
  });

  describe('createConversation', () => {
    it('propagates a block-rejection error from rpc_create_conversation instead of creating a conversation', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({ data: { user: { id: 'me' } } });
      const blockError = { message: 'cannot start a conversation that includes a blocked relationship', code: '42501' };
      (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: blockError });

      await expect(createConversation(['blocked-user'], false)).rejects.toEqual(blockError);

      expect(supabase.rpc).toHaveBeenCalledWith(
        'rpc_create_conversation',
        expect.objectContaining({ p_participant_ids: expect.arrayContaining(['blocked-user', 'me']) })
      );
      // Must never fall through to fetching/naming the (non-existent) conversation row.
      expect(supabase.from).not.toHaveBeenCalled();
    });
  });
});
