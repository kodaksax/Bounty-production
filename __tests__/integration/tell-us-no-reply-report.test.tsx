/**
 * E2E-04, item 4: "Tell us Ana hasn't replied" opens the existing report flow
 * with the job attached and "hasn't responded" preselected, and files a
 * report row for this job, from the poster, with reason_code
 * hunter_unresponsive.
 *
 * The live end-to-end check on staging was not run: filing a report there
 * pages a real admin by email and push (fn_trust_review_page_admins, 'high').
 * This runs the real report screen and the real dispute service against a
 * fake database client instead, and checks the client itself never calls an
 * admin-paging function (that happens only in the database trigger).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';

const POSTER = 'poster-1';
const HELPER = 'helper-1';
const JOB = { id: 'job-a', title: '[shoal] hired-silent', status: 'in_progress', poster_id: POSTER, user_id: POSTER, accepted_by: HELPER, amount: 30 };

// ── A chainable fake Supabase client that records every call ──────────────
const calls: { table: string; op: string; args: unknown[] }[] = [];
const mockRpc = jest.fn(async () => ({ data: null, error: null }));
function mockBuilder(table: string) {
  const b: any = {};
  const record = (op: string) => (...args: unknown[]) => {
    calls.push({ table, op, args });
    return b;
  };
  for (const op of ['select', 'eq', 'in', 'or', 'order', 'limit', 'insert', 'update', 'neq', 'is']) b[op] = record(op);
  const inserted = () => calls.filter((c) => c.table === table && c.op === 'insert').pop()?.args[0] as any;
  const result = () =>
    table === 'bounty_disputes' && inserted()
      ? { data: { id: 'dispute-1', status: 'open', created_at: '2026-11-25T17:00:00Z', ...inserted() }, error: null }
      : { data: null, error: null };
  b.single = async () => result();
  b.maybeSingle = async () => result();
  b.then = (resolve: (r: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject);
  return b;
}
jest.mock('lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { from: (t: string) => mockBuilder(t), rpc: (...a: unknown[]) => (mockRpc as any)(...a) },
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'job-a', reason: 'hunter_unresponsive' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
}));
jest.mock('hooks/use-auth-context', () => ({ useAuthContext: () => ({ session: { user: { id: POSTER } } }) }));
jest.mock('lib/services/bounty-service', () => ({ bountyService: { getById: jest.fn(async () => JOB) } }));
jest.mock('lib/services/cancellation-service', () => ({
  cancellationService: { getCancellationByBountyId: jest.fn(async () => null) },
}));
jest.mock('lib/services/completion-service', () => ({ completionService: { getSubmission: jest.fn(async () => null) } }));
jest.mock('lib/services/analytics-service', () => ({ analyticsService: { trackEvent: jest.fn() } }));
jest.mock('lib/services/attachment-service', () => ({ attachmentService: {} }));
jest.mock('expo-document-picker', () => ({}));
jest.mock('expo-image-picker', () => ({}));
jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return { AlertCircle: Icon, ArrowLeft: Icon, HelpCircle: Icon, Mail: Icon, Phone: Icon };
});

import DisputeScreen from '../../app/bounty/[id]/dispute';

beforeEach(() => {
  calls.length = 0;
  mockRpc.mockClear();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

// The screen is wrapped in withReplayMask (importantForAccessibility="no"),
// so its inputs are hidden from the default queries.
const ALL = { includeHiddenElements: true } as const;

it('opens with the job and "hasn\'t responded" preselected, and files the report row', async () => {
  render(<DisputeScreen />);
  // The job is attached and the reason preselected (its chip selected, its text prefilled).
  const chip = await screen.findByText("Hunter hasn't responded", ALL);
  await waitFor(() => expect(screen.getByDisplayValue(/^Hunter hasn't responded:/, ALL)).toBeTruthy());
  expect(chip).toBeTruthy();

  fireEvent.changeText(screen.getByDisplayValue(/^Hunter hasn't responded:/, ALL), "Hunter hasn't responded: no word since Saturday.");
  fireEvent.press(screen.getByText('Submit Dispute', ALL));

  await waitFor(() => expect(calls.some((c) => c.table === 'bounty_disputes' && c.op === 'insert')).toBe(true));
  const row = calls.find((c) => c.table === 'bounty_disputes' && c.op === 'insert')!.args[0] as Record<string, unknown>;
  expect(row).toEqual(
    expect.objectContaining({
      bounty_id: 'job-a',
      initiator_id: POSTER,
      respondent_id: HELPER,
      reason_code: 'hunter_unresponsive',
      dispute_stage: 'in_progress',
      status: 'open',
    })
  );
  expect(String(row.reason)).toMatch(/^Hunter hasn't responded: /);

  // The client pages nobody: its only RPC is the helper's in-app notification.
  const rpcNames = mockRpc.mock.calls.map((c: unknown[]) => c[0]);
  expect(rpcNames.filter((n) => /admin|page|trust_review/i.test(String(n)))).toEqual([]);
});
