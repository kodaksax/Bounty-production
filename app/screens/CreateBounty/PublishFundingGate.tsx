import type { BountyPublishFunding } from 'app/screens/CreateBounty/useBountyPublish';
import { AddMoneyScreen } from 'components/add-money-screen';
import { InsufficientBalanceScreen } from 'components/insufficient-balance-screen';
import React from 'react';

interface PublishFundingGateProps {
  funding: BountyPublishFunding;
}

/**
 * Dumb presentational wrapper around the two screens useBountyPublish's
 * `funding` object drives — no logic of its own, so both the control and
 * two-step orchestrators render it identically:
 *
 *   if (funding.showTopUp || funding.showInsufficientBalance)
 *     return <PublishFundingGate funding={funding} />;
 */
export function PublishFundingGate({ funding }: PublishFundingGateProps) {
  if (funding.showTopUp) {
    return (
      <AddMoneyScreen
        initialAmount={funding.initialAmount}
        headerLabel={funding.headerLabel}
        primaryCtaLabel={funding.primaryCtaLabel}
        onBack={funding.onBack}
        onAddMoney={funding.onAddMoney}
      />
    );
  }

  return (
    <InsufficientBalanceScreen
      walletBalance={funding.walletBalance}
      bountyAmount={funding.bountyAmount}
      onAddFunds={funding.onAddFunds}
      onEditAmount={funding.onEditAmount}
      onCancel={funding.onCancel}
    />
  );
}

export default PublishFundingGate;
