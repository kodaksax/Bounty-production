import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { trustSafetyStrings } from '../../lib/strings/trust-safety';

const root = path.resolve(__dirname, '../..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const payoutSource = read('app/postings/[bountyId]/payout.tsx');
const payoutAst = ts.createSourceFile('payout.tsx', payoutSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

// 2026-11-16 (second-pass senior audit): the payout page used to release
// money from a switch + button, and complete unpaid ("for honor") jobs from a
// "Mark as complete" button, both WITHOUT approving the helper's submission.
// Any job that isn't completed is now handed to the job page's one review
// flow (PosterReviewModal: "cannot be undone" + slide-to-confirm, and "Slide to
// mark complete" for unpaid jobs). These pin that the payout page can no
// longer change a job's state or move money at all.
function hasCall(name: string): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(node) && node.expression.getText(payoutAst).endsWith(name)) found = true;
    ts.forEachChild(node, visit);
  };
  visit(payoutAst);
  return found;
}

describe('poster completion payment safety', () => {
  it('the payout page has no release or completion path of its own', () => {
    for (const call of ['releaseFunds', 'releaseBountyPayment', 'approveAndRelease', 'logTransaction']) {
      expect(hasCall(call)).toBe(false);
    }
    expect(payoutSource).not.toContain('handleMarkComplete');
    expect(payoutSource).not.toContain('handleReleasePayout');
    expect(payoutSource).not.toMatch(/status:\s*'completed'/);
  });

  it('hands every unfinished job to the job page review before rendering anything', () => {
    expect(payoutSource).toContain("if (data.status !== 'completed')");
    expect(payoutSource).toContain("openReview: 'work'");
  });

  it('unpaid jobs are completed through the review sheet, behind its own confirmation', () => {
    const modal = read('components/poster-review-modal.tsx');
    expect(modal).toContain("'Slide to mark complete'");
    expect(modal).toContain('Once you approve, this cannot be undone.');
  });
});

describe('payment safety notice placement and bounded copy', () => {
  it.each([
    'components/accept-funding-gate.tsx',
    'app/tabs/wallet-screen.tsx',
    'app/postings/[bountyId]/payout.tsx',
    'app/in-progress/[bountyId]/hunter/payout.tsx',
    'components/transaction-detail-modal.tsx',
  ])('shows one payment scope notice on %s, not one per row', file => {
    expect(read(file).match(/trustSafetyStrings\.paymentProtection/g)).toHaveLength(1);
  });

  it('keeps hire and cancellation scope visible even on a compact funding gate', () => {
    const source = read('components/accept-funding-gate.tsx');
    expect(source).toContain('<TrustSafetyNotice message={trustSafetyStrings.posterHire} />');
    expect(source).toContain('Refunds and releases depend on the bounty’s state and any dispute review.');
    expect(source).not.toContain("the money comes back to your wallet");
  });

  it('does not depict open listings as funded or promise refund/payment outcomes', () => {
    const explainer = read('components/ui/escrow-explainer.tsx');
    const badges = read('components/ui/trust-badges.tsx');
    expect(explainer).toContain('An open listing is not proof of funding');
    expect(badges).toContain('An open listing does not prove funding');
    expect(`${explainer}\n${badges}`).not.toMatch(/Full refund|Refund Guarantee|always secure|instantly transferred|never released without/i);
  });
});
