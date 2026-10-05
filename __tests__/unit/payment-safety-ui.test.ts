import fs from 'fs';
import path from 'path';
import vm from 'vm';
import ts from 'typescript';
import { trustSafetyStrings } from '../../lib/strings/trust-safety';

const root = path.resolve(__dirname, '../..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const payoutSource = read('app/postings/[bountyId]/payout.tsx');
const payoutAst = ts.createSourceFile('payout.tsx', payoutSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function findNode(predicate: (node: ts.Node) => boolean): ts.Node {
  let found: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if (predicate(node)) found = node;
    if (!found) ts.forEachChild(node, visit);
  };
  visit(payoutAst);
  if (!found) throw new Error('Expected payout control was not found');
  return found;
}

// Execute the actual handler in isolation: no native modules or payment SDKs
// are needed to prove the unpaid completion path cannot mutate paid bounties.
function completionHarness(isForHonor: unknown) {
  const declaration = findNode(
    node => ts.isVariableDeclaration(node) && node.name.getText(payoutAst) === 'handleMarkComplete'
  ) as ts.VariableDeclaration;
  const handler = ts.transpileModule(`(${declaration.initializer!.getText(payoutAst)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const context = {
    bounty: { id: 'bounty-1', title: 'Test bounty', amount: 100, is_for_honor: isForHonor },
    bountyId: 'bounty-1',
    Alert: { alert: jest.fn() },
    bountyService: { update: jest.fn().mockResolvedValue({ status: 'completed' }) },
    analyticsService: { trackEvent: jest.fn().mockResolvedValue(undefined) },
    getHoursSinceClaimed: jest.fn().mockResolvedValue(1),
    logTransaction: jest.fn().mockResolvedValue(undefined),
    setIsProcessing: jest.fn(),
    setShowSuccessAnimation: jest.fn(),
    setTimeout: jest.fn(),
    router: { replace: jest.fn() },
    trustSafetyStrings,
  };
  return { context, complete: vm.runInNewContext(handler, context) as () => Promise<void> };
}

describe('poster completion payment safety', () => {
  it.each([false, undefined, null, 'true', 1])(
    'rejects non-honor completion (%s) before confirmation or mutation',
    async honor => {
      const { context, complete } = completionHarness(honor);
      await complete();
      expect(context.Alert.alert).toHaveBeenCalledTimes(1);
      expect(context.Alert.alert).toHaveBeenCalledWith('Use Payout Release', trustSafetyStrings.paidCompletion);
      expect(context.bountyService.update).not.toHaveBeenCalled();
      expect(context.logTransaction).not.toHaveBeenCalled();
      expect(context.setIsProcessing).not.toHaveBeenCalled();
    }
  );

  it('preserves confirmed honor completion and its zero-value history record', async () => {
    const { context, complete } = completionHarness(true);
    await complete();
    expect(context.Alert.alert.mock.calls[0][0]).toBe('Mark as Complete');
    expect(context.bountyService.update).not.toHaveBeenCalled();
    const buttons = context.Alert.alert.mock.calls[0][2];
    await buttons.find((button: { text: string }) => button.text === 'Confirm').onPress();
    expect(context.bountyService.update).toHaveBeenCalledWith('bounty-1', {
      status: 'completed',
      completed_at: expect.any(String),
    });
    expect(context.logTransaction).toHaveBeenCalledWith({
      type: 'bounty_completed',
      amount: 0,
      details: { title: 'Test bounty', status: 'completed_for_honor', bounty_id: 'bounty-1' },
    });
    expect(context.setIsProcessing).toHaveBeenLastCalledWith(false);
  });

  it('renders the manual completion button only behind the explicit honor guard', () => {
    const attribute = findNode(
      node => ts.isJsxAttribute(node) && node.name.getText(payoutAst) === 'onPress' &&
        node.initializer?.getText(payoutAst) === '{handleMarkComplete}'
    );
    let parent = attribute.parent;
    while (parent && !ts.isBinaryExpression(parent)) parent = parent.parent;
    expect(parent && ts.isBinaryExpression(parent) && parent.operatorToken.kind).toBe(ts.SyntaxKind.AmpersandAmpersandToken);
    expect(parent && ts.isBinaryExpression(parent) && parent.left.getText(payoutAst)).toBe('bounty.is_for_honor === true');
    expect(payoutSource).toContain('onPress={handleReleasePayout}');
    expect(payoutSource).toContain('{trustSafetyStrings.paidCompletion}');
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
