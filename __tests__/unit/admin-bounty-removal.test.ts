// Regression tests for the admin bounty-removal flow.
//
// Root cause: adminDataClient.removeBountyForViolation used to write directly
// to `bounties` with the ordinary Supabase client. The only UPDATE policy on
// that table is ownership-based (auth.uid() = poster_id), so RLS silently
// dropped the row for any admin who was not also the bounty's poster, and the
// client reported that as "Bounty not found, or you do not have permission to
// remove it" -- even though the bounty existed and the caller was a genuine
// admin. The fix routes removal through admin_moderation_transition(), a
// SECURITY DEFINER RPC that re-checks admin role server-side instead of
// relying on RLS ownership (see
// supabase/migrations/20260904010000_admin_bounty_removal_authorization_fix.sql
// for the DB-level proof of the same scenarios against a real schema).
//
// This suite covers the client layer: that each RPC outcome (success,
// idempotent repeat, not-admin, not-found, generic failure) maps to the
// correct typed result/error, and that removal never depends on anything the
// caller could get wrong or that RLS ownership would gate.
//
// Also covers updateBountyStatus (the "Status actions" buttons on the same
// screen -- Archive/Cancel/Mark completed/Reopen), which had the identical
// root cause and is fixed the same way via admin_set_bounty_status(); see
// supabase/migrations/20260904020000_admin_bounty_status_authorization_fix.sql.

const rpc = jest.fn();
const from = jest.fn();
const getSession = jest.fn();

jest.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
    functions: { invoke: jest.fn() },
    auth: { getSession: (...args: unknown[]) => getSession(...args) },
  },
  isSupabaseConfigured: true,
}));

import { AdminModerationError, adminDataClient } from '../../lib/admin/adminDataClient';

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
  getSession.mockReset();
});

describe('removeBountyForViolation', () => {
  test('1. an authorized admin removes an existing bounty successfully', async () => {
    rpc.mockResolvedValue({
      data: { bounty_id: 'b1', from_state: 'active', to_state: 'removed', bounty_status: 'archived' },
      error: null,
    });

    const result = await adminDataClient.removeBountyForViolation('b1', 'Community guideline violation: Spam');

    expect(result).toEqual({ status: 'removed', bountyStatus: 'archived' });
  });

  test('3 & 4. the call never carries poster/ownership info -- authorization is server-side, not RLS ownership', async () => {
    rpc.mockResolvedValue({
      data: { bounty_id: 'b1', from_state: 'active', to_state: 'removed', bounty_status: 'archived' },
      error: null,
    });

    await adminDataClient.removeBountyForViolation('b1', 'Community guideline violation: Fraud / Scam');

    expect(rpc).toHaveBeenCalledWith('admin_moderation_transition', {
      p_bounty_id: 'b1',
      p_new_state: 'removed',
      p_reason: 'Community guideline violation: Fraud / Scam',
      p_notes: null,
    });
    // No poster id, current admin id, or bounty snapshot is sent -- the admin
    // does not need to (and cannot) prove ownership to remove a listing.
    const [, args] = rpc.mock.calls[0];
    expect(Object.keys(args)).toEqual(['p_bounty_id', 'p_new_state', 'p_reason', 'p_notes']);
  });

  test('2. non-admin is rejected with a safe, specific message (RPC raises 42501)', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'admin role required', code: '42501' },
    });

    await expect(adminDataClient.removeBountyForViolation('b1', 'reason')).rejects.toMatchObject({
      code: 'NOT_ADMIN',
      message: "You don't have permission to perform this action.",
    });
  });

  test('6. a genuinely nonexistent bounty returns a distinct not-found state (RPC raises P0002)', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'bounty ffff not found', code: 'P0002' },
    });

    await expect(adminDataClient.removeBountyForViolation('ffff', 'reason')).rejects.toMatchObject({
      code: 'BOUNTY_NOT_FOUND',
      message: 'This bounty no longer exists.',
    });
  });

  test('5. an already-removed bounty is treated as an idempotent success, not a failure', async () => {
    rpc.mockResolvedValue({
      data: {
        bounty_id: 'b1',
        from_state: 'removed',
        to_state: 'removed',
        bounty_status: 'archived',
        idempotent: true,
      },
      error: null,
    });

    const result = await adminDataClient.removeBountyForViolation('b1', 'reason');

    expect(result).toEqual({ status: 'already_removed', bountyStatus: 'archived' });
  });

  test('7. stale admin-list data cannot cause a false not-found: only the id is sent, always looked up fresh', async () => {
    // The client has no local "does this bounty still exist" check -- it
    // always asks the server, so a list screen that has not refetched yet
    // cannot make removal appear to fail.
    rpc.mockResolvedValue({
      data: { bounty_id: 'b1', from_state: 'active', to_state: 'removed', bounty_status: 'archived' },
      error: null,
    });

    await adminDataClient.removeBountyForViolation('b1', 'reason');
    expect(rpc.mock.calls[0][1].p_bounty_id).toBe('b1');
  });

  test('10. a database/network failure produces a safe generic message, not the raw error', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'connection to server was lost, leaked internal detail xyz', code: '57P03' },
    });

    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(adminDataClient.removeBountyForViolation('b1', 'reason')).rejects.toMatchObject({
        code: 'DATABASE_ERROR',
        message: "We couldn't remove this bounty. Please try again.",
      });
      // The raw error text is logged for debugging, not thrown to the UI.
      expect(consoleError).toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  test('an illegal transition (e.g. a completed bounty) also falls back to a safe generic message', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'illegal moderation transition: completed -> removed', code: '22023' },
    });

    await expect(adminDataClient.removeBountyForViolation('b1', 'reason')).rejects.toBeInstanceOf(
      AdminModerationError
    );
  });
});

describe('updateBountyStatus (the "Status actions" buttons -- Archive/Cancel/Complete/Reopen)', () => {
  // Same root-cause bug, same fix shape, as removeBountyForViolation --
  // covered in 20260904020000_admin_bounty_status_authorization_fix.sql at
  // the DB level. This suite covers the equivalent client-layer mapping.

  test('an authorized admin updates a bounty they do not own via the RPC, not a direct table write', async () => {
    rpc.mockResolvedValue({ data: { id: 'b1', poster_id: 'someone-else', status: 'archived' }, error: null });

    const result = await adminDataClient.updateBountyStatus('b1', 'archived');

    expect(rpc).toHaveBeenCalledWith('admin_set_bounty_status', {
      p_bounty_id: 'b1',
      p_status: 'archived',
      p_reason: null,
    });
    expect(from).not.toHaveBeenCalled();
    expect(result.status).toBe('archived');
  });

  test('non-admin is rejected with a safe, specific message (RPC raises 42501)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'admin role required', code: '42501' } });

    await expect(adminDataClient.updateBountyStatus('b1', 'archived')).rejects.toMatchObject({
      code: 'NOT_ADMIN',
      message: "You don't have permission to perform this action.",
    });
  });

  test('a genuinely nonexistent bounty returns a distinct not-found state (RPC raises P0002)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'bounty ffff not found', code: 'P0002' } });

    await expect(adminDataClient.updateBountyStatus('ffff', 'archived')).rejects.toMatchObject({
      code: 'BOUNTY_NOT_FOUND',
      message: 'This bounty no longer exists.',
    });
  });

  test('an illegal transition (e.g. completed -> in_progress) falls back to a safe generic message', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'illegal bounty status transition: completed -> in_progress', code: '22023' },
    });

    await expect(adminDataClient.updateBountyStatus('b1', 'in_progress')).rejects.toMatchObject({
      code: 'DATABASE_ERROR',
    });
  });

  test('a database/network failure produces a safe generic message, not the raw error', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'connection to server was lost, leaked internal detail xyz', code: '57P03' },
    });

    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(adminDataClient.updateBountyStatus('b1', 'archived')).rejects.toMatchObject({
        code: 'DATABASE_ERROR',
        message: "We couldn't update this bounty. Please try again.",
      });
      expect(consoleError).toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe('sendWarning (the "warn poster" side effect of removal)', () => {
  function insertSuccess() {
    const single = jest.fn().mockResolvedValue({ data: { id: 'w1' }, error: null });
    const select = jest.fn().mockReturnValue({ single });
    const insert = jest.fn().mockReturnValue({ select });
    from.mockReturnValue({ insert });
    return { insert, select, single };
  }

  test('a real admin (app_metadata.role) can send a warning', async () => {
    getSession.mockResolvedValue({
      data: { session: { user: { id: 'admin-1', app_metadata: { role: 'admin' } } } },
    });
    const { insert } = insertSuccess();

    await adminDataClient.sendWarning({
      userId: 'poster-1',
      bountyId: 'b1',
      violationType: 'spam',
      message: 'msg',
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ admin_id: 'admin-1', user_id: 'poster-1', bounty_id: 'b1' })
    );
  });

  test('does not use the dead profiles.role check -- a session with no admin claim is rejected before any query', async () => {
    getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1', app_metadata: {} } } },
    });

    await expect(
      adminDataClient.sendWarning({ userId: 'poster-1', violationType: 'spam', message: 'msg' })
    ).rejects.toThrow('Insufficient privileges');

    // Rejected client-side before ever touching admin_warnings.
    expect(from).not.toHaveBeenCalled();
  });
});
