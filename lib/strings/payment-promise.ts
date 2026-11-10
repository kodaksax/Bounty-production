/**
 * Every string behind the `payment-promise-copy` flag, in one place for founder
 * and finance approval. Each claim was checked against the payment code:
 *
 *   - Posting charges nothing. Paid bounties fund when a hunter is hired.
 *   - At hire the Bounty balance is used first; the card is charged the rest.
 *   - The poster pays exactly the reward. The platform fee is deducted from the
 *     hunter's share at release (lib/constants/fees.ts).
 *   - Money is released when the poster approves, or by a dispute ruling.
 *   - Refunds credit the Bounty balance, not the card.
 *
 * If any of those change, this copy has to change with them.
 */

/** The hire sheet's money amounts, already formatted for display ("$30.00"). */
export interface FundingLineAmounts {
  /** The bounty reward. */
  reward: string;
  /** What leaves the Bounty balance. */
  fromBalance: string;
  /** What is charged to the card. */
  charged: string;
}

export const paymentPromiseStrings = {
  /** Step 1, under the hero subtitle. */
  stepTaskLine:
    'Free to post. You pay only when you hire someone, and we hold the payment while the work gets done.',
  /** Step 3, the title of the reassurance card. */
  stepPayLine:
    'Free to post. You pay only when you hire someone, and we hold the payment until you approve the work or a dispute is settled.',

  /** Hire sheet, line 1. */
  fundingSummary: (reward: string) => `Reward ${reward} · You pay ${reward} · No fees for you`,
  /** Hire sheet, line 2: the poster's wallet is empty. */
  fundingCardOnly: ({ charged }: Pick<FundingLineAmounts, 'charged'>) =>
    `Your card is charged ${charged} now.`,
  /** Hire sheet, line 2: the balance covers the whole reward. */
  fundingBalanceOnly: ({ fromBalance }: Pick<FundingLineAmounts, 'fromBalance'>) =>
    `${fromBalance} comes from your Bounty balance now.`,
  /** Hire sheet, line 2: the balance covers part of it. */
  fundingBalanceAndCard: ({ fromBalance, charged }: Omit<FundingLineAmounts, 'reward'>) =>
    `${fromBalance} from your Bounty balance and ${charged} charged to your card now.`,
  /** Hire sheet, line 3. */
  fundingHold:
    'We hold it until you approve the work. If something goes wrong, tap Report a problem and Bounty support decides; any refund goes to your Bounty balance.',

  fundAndHire: 'Fund and hire',
  notYet: 'Not yet',

  /** Screen reader labels for the two buttons. */
  fundAndHireA11y: (hunterName: string) => `Fund and hire ${hunterName}`,
  notYetA11y: 'Not yet, go back without hiring',

  /** how-it-works, the "No fee to post" section. The only place the fee split is explained. */
  howItWorksFees: (feeDisplay: string) =>
    `Posting is free. You pay the reward when you hire someone: any Bounty balance is used first, and your card is charged for the rest at that moment. Bounty's ${feeDisplay} comes out of the hunter's share when the payment is released, so you pay exactly the reward and the hunter takes home the rest.`,
} as const;

/**
 * Line 2 of the hire sheet.
 *
 * `chargeAmount` is what the card is really charged, which can be more than the
 * shortfall: a shortfall under Stripe's $0.50 minimum is charged at $0.50 and the
 * excess stays in the wallet. So the balance's part is reward minus charge, not
 * the balance itself, and the two figures always add up to the reward.
 */
export function fundingSourceLine(
  amount: number,
  chargeAmount: number,
  money: (n: number) => string
): string {
  if (chargeAmount <= 0) {
    return paymentPromiseStrings.fundingBalanceOnly({ fromBalance: money(amount) });
  }
  const fromBalance = Number(Math.max(0, amount - chargeAmount).toFixed(2));
  if (fromBalance <= 0) {
    return paymentPromiseStrings.fundingCardOnly({ charged: money(chargeAmount) });
  }
  return paymentPromiseStrings.fundingBalanceAndCard({
    fromBalance: money(fromBalance),
    charged: money(chargeAmount),
  });
}
