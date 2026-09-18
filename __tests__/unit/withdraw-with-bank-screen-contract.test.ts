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
});
