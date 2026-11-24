import * as fs from 'fs';
import * as path from 'path';

const source = fs.readFileSync(
  path.join(__dirname, '../../components/withdraw-with-bank-screen.tsx'),
  'utf8'
);

describe('withdraw-with-bank-screen success handling', () => {
  test('does not treat a failed replay status as success', () => {
    expect(source).toContain("const FAILED_WITHDRAWAL_STATUSES = new Set(['failed', 'canceled', 'cancelled'])");
    expect(source).toContain('if (payoutStatus && FAILED_WITHDRAWAL_STATUSES.has(payoutStatus))');
    expect(source).toContain("replayError.code = 'transfer_failed'");
  });

  test('passes the server duplicate flag to classifyPayoutFailure so a replay is not a second payout_failed', () => {
    expect(source).toContain('replayError.duplicate = successData?.duplicate === true');
    expect(source).toContain('duplicate: error?.duplicate,');
  });
});
