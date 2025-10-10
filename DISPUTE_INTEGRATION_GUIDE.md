# Dispute Integration Guide

This guide explains how to integrate the dispute modal for handling bounty conflicts.

## Overview

The dispute system allows users to open disputes for bounties where there's a disagreement. The `DisputeModal` provides guidance and marks the transaction as pending dispute.

## Components

### DisputeModal

Located in `components/dispute-modal.tsx`

**Props:**
- `visible: boolean` - Controls modal visibility
- `onClose: () => void` - Called when modal is dismissed
- `onSubmit: () => Promise<void>` - Called when user confirms dispute
- `bountyTitle: string` - Title of the bounty in dispute
- `transactionId?: string` - Optional transaction ID to update

## Integration Steps

### 1. Import Required Modules

```tsx
import { DisputeModal } from "components/dispute-modal";
import { useWallet } from "lib/wallet-context";
```

### 2. Add State Management

```tsx
const [showDisputeModal, setShowDisputeModal] = useState(false);
const [disputeContext, setDisputeContext] = useState<{
  bountyId: string;
  bountyTitle: string;
  transactionId?: string;
} | null>(null);
```

### 3. Open Dispute from Bounty Detail

Add an "Open Dispute" button in your bounty detail view:

```tsx
import { MaterialIcons } from "@expo/vector-icons";

function BountyDetailActions({ bounty }: { bounty: Bounty }) {
  const handleOpenDispute = () => {
    setDisputeContext({
      bountyId: bounty.id.toString(),
      bountyTitle: bounty.title,
      transactionId: undefined, // Will be set if linked to a transaction
    });
    setShowDisputeModal(true);
  };

  return (
    <TouchableOpacity
      style={styles.disputeButton}
      onPress={handleOpenDispute}
    >
      <MaterialIcons name="report-problem" size={20} color="#ef4444" />
      <Text style={styles.disputeButtonText}>Open Dispute</Text>
    </TouchableOpacity>
  );
}
```

### 4. Open Dispute from Transaction

Add dispute option in transaction detail view:

```tsx
function TransactionActions({ transaction }: { transaction: WalletTransactionRecord }) {
  const { updateDisputeStatus } = useWallet();

  const handleOpenDispute = () => {
    setDisputeContext({
      bountyId: transaction.details.bounty_id?.toString() || "",
      bountyTitle: transaction.details.title || "Transaction",
      transactionId: transaction.id,
    });
    setShowDisputeModal(true);
  };

  // Only show if transaction is related to a bounty and not already in dispute
  if (!transaction.details.bounty_id || transaction.disputeStatus === "pending") {
    return null;
  }

  return (
    <TouchableOpacity
      style={styles.disputeLink}
      onPress={handleOpenDispute}
    >
      <MaterialIcons name="gavel" size={16} color="#f59e0b" />
      <Text style={styles.disputeLinkText}>Report Issue</Text>
    </TouchableOpacity>
  );
}
```

### 5. Handle Dispute Submission

```tsx
const { updateDisputeStatus } = useWallet();

const handleSubmitDispute = async () => {
  if (!disputeContext) return;

  try {
    // Update transaction status if available
    if (disputeContext.transactionId) {
      await updateDisputeStatus(disputeContext.transactionId, "pending");
    }

    // Optionally notify backend/support
    // await notifySupport({
    //   bountyId: disputeContext.bountyId,
    //   userId: getCurrentUserId(),
    //   type: "dispute_opened",
    // });

    // Close modal and clear context
    setShowDisputeModal(false);
    setDisputeContext(null);

    // Show success feedback
    alert("Dispute opened. Our support team will review your case.");
  } catch (error) {
    console.error("Failed to open dispute:", error);
    throw error; // DisputeModal will show error
  }
};
```

### 6. Render the Modal

Add the modal to your component's JSX:

```tsx
{disputeContext && (
  <DisputeModal
    visible={showDisputeModal}
    onClose={() => {
      setShowDisputeModal(false);
      setDisputeContext(null);
    }}
    onSubmit={handleSubmitDispute}
    bountyTitle={disputeContext.bountyTitle}
    transactionId={disputeContext.transactionId}
  />
)}
```

## Complete Example

Here's a complete integration example:

```tsx
import { useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { DisputeModal } from "components/dispute-modal";
import { useWallet } from "lib/wallet-context";
import type { Bounty } from "lib/services/database.types";

export function BountyDetailWithDispute({ bounty }: { bounty: Bounty }) {
  const [showDisputeModal, setShowDisputeModal] = useState(false);
  const [disputeContext, setDisputeContext] = useState<{
    bountyId: string;
    bountyTitle: string;
    transactionId?: string;
  } | null>(null);
  const { updateDisputeStatus, transactions } = useWallet();

  const handleOpenDispute = () => {
    // Find associated transaction
    const relatedTransaction = transactions.find(
      (tx) => tx.details.bounty_id === bounty.id
    );

    setDisputeContext({
      bountyId: bounty.id.toString(),
      bountyTitle: bounty.title,
      transactionId: relatedTransaction?.id,
    });
    setShowDisputeModal(true);
  };

  const handleSubmitDispute = async () => {
    if (!disputeContext) return;

    try {
      // Update transaction status if available
      if (disputeContext.transactionId) {
        await updateDisputeStatus(disputeContext.transactionId, "pending");
      }

      // Close modal
      setShowDisputeModal(false);
      setDisputeContext(null);

      // Show success
      Alert.alert(
        "Dispute Opened",
        "Our support team has been notified and will review your case within 24-48 hours.",
        [{ text: "OK" }]
      );
    } catch (error) {
      console.error("Failed to open dispute:", error);
      throw error;
    }
  };

  return (
    <View style={styles.container}>
      {/* Bounty details */}
      <View style={styles.details}>
        <Text style={styles.title}>{bounty.title}</Text>
        <Text style={styles.description}>{bounty.description}</Text>
      </View>

      {/* Action buttons */}
      <View style={styles.actions}>
        {/* Only show dispute button for in-progress or completed bounties */}
        {(bounty.status === "in_progress" || bounty.status === "completed") && (
          <TouchableOpacity
            style={styles.disputeButton}
            onPress={handleOpenDispute}
          >
            <MaterialIcons name="report-problem" size={20} color="#ef4444" />
            <Text style={styles.disputeButtonText}>Report Issue</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Dispute Modal */}
      {disputeContext && (
        <DisputeModal
          visible={showDisputeModal}
          onClose={() => {
            setShowDisputeModal(false);
            setDisputeContext(null);
          }}
          onSubmit={handleSubmitDispute}
          bountyTitle={disputeContext.bountyTitle}
          transactionId={disputeContext.transactionId}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#059669",
  },
  details: {
    padding: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: "#fff",
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    color: "#d1fae5",
    lineHeight: 20,
  },
  actions: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "rgba(16, 185, 129, 0.2)",
  },
  disputeButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(239, 68, 68, 0.2)",
    padding: 12,
    borderRadius: 12,
    gap: 8,
  },
  disputeButtonText: {
    color: "#fca5a5",
    fontSize: 14,
    fontWeight: "600",
  },
});
```

## Transaction Badge Display

The dispute status is automatically shown on transactions in the history:

```tsx
// This is already implemented in transaction-history-screen.tsx
{transaction.disputeStatus === "pending" && (
  <View className="flex-row items-center bg-red-500/80 px-2 py-0.5 rounded-full">
    <MaterialIcons name="warning" size={10} color="#fff" />
    <Text className="text-[10px] text-white font-bold ml-1">DISPUTE</Text>
  </View>
)}
```

## Dispute Resolution Flow

When a dispute is opened:

1. **User opens dispute** → Status set to "pending"
2. **Transaction frozen** → Funds remain in escrow
3. **Support notified** → Email sent to support team
4. **Review process** → Support team investigates
5. **Resolution** → Status updated to "resolved" with outcome

### Handling Resolution

```tsx
const resolveDispute = async (
  transactionId: string,
  resolution: "release" | "refund"
) => {
  const { updateDisputeStatus } = useWallet();
  
  // Update dispute status
  await updateDisputeStatus(transactionId, "resolved");
  
  // Process the resolution
  if (resolution === "release") {
    // Release funds to recipient
    await bountyService.completeBounty(bountyId);
  } else {
    // Refund to poster
    await bountyService.refundBounty(bountyId);
  }
};
```

## Best Practices

1. **Only allow disputes for valid states**
   - In-progress bounties
   - Recently completed bounties (within dispute window)
   - Not for open or archived bounties

2. **Provide clear guidance**
   - The modal explains the process
   - Shows support contact information
   - Sets expectations for timeline

3. **Prevent duplicate disputes**
   - Check transaction status before showing option
   - Don't show dispute button if already pending

4. **Track dispute history**
   - Log all dispute events
   - Maintain audit trail
   - Show resolution in transaction detail

## Support Email Configuration

Update the support email in the DisputeModal:

```tsx
// In dispute-modal.tsx
const SUPPORT_EMAIL = "Support@bountyfinder.app";

// Can be configured via environment variable:
const SUPPORT_EMAIL = process.env.EXPO_PUBLIC_SUPPORT_EMAIL || "Support@bountyfinder.app";
```

## Backend Requirements

1. **Wallet Transaction Updates**
   - Add `disputeStatus` field to wallet_transactions table
   - Default to "none"
   - Allow transitions: none → pending → resolved

2. **Notification System**
   - Send email to support team when dispute opened
   - Notify both parties when dispute is resolved
   - Optional: In-app notifications

3. **Admin Dashboard**
   - View pending disputes
   - Access dispute details and conversation
   - Ability to resolve disputes

## Testing

1. **Open Dispute Flow**
   - Click "Report Issue" on bounty/transaction
   - View guidance modal
   - Confirm dispute
   - Verify status updated to "pending"
   - Check badge appears on transaction

2. **Email Notification**
   - Verify support email sent
   - Check email contains bounty details

3. **Resolution Flow**
   - Admin resolves dispute
   - Verify status changes to "resolved"
   - Check funds are released/refunded appropriately

## Notes

- Disputes are non-blocking - users can still interact with other bounties
- Funds remain in escrow during dispute
- Support email link opens default email client
- Resolution typically takes 24-48 hours
- Multiple disputes on same bounty are tracked separately
