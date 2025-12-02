import * as Sharing from 'expo-sharing';
import type { WalletTransactionRecord } from '../wallet-context';

/**
 * Receipt Service
 * Generates shareable receipts for wallet transactions
 */
export class ReceiptService {
  /**
   * Generate a text-based receipt for a transaction
   */
  generateReceiptText(transaction: WalletTransactionRecord): string {
    const date = new Date(transaction.date);
    const formattedDate = date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const formattedTime = date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });

    const typeLabel = this.getTypeLabel(transaction.type);
    const amount = Math.abs(transaction.amount);
    const sign = transaction.amount >= 0 ? '+' : '-';

    return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       BOUNTY RECEIPT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Transaction Type: ${typeLabel}
Amount: ${sign}$${amount.toFixed(2)}

Date: ${formattedDate}
Time: ${formattedTime}

Transaction ID: ${transaction.id}

${transaction.details.title ? `Description: ${transaction.details.title}\n` : ''}${transaction.details.method ? `Method: ${transaction.details.method}\n` : ''}${transaction.details.status ? `Status: ${transaction.details.status}\n` : ''}${transaction.details.counterparty ? `Counterparty: ${transaction.details.counterparty}\n` : ''}${transaction.escrowStatus ? `Escrow Status: ${transaction.escrowStatus}\n` : ''}${transaction.disputeStatus && transaction.disputeStatus !== 'none' ? `Dispute Status: ${transaction.disputeStatus}\n` : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Thank you for using BOUNTY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `.trim();
  }

  /**
   * Get human-readable label for transaction type
   */
  private getTypeLabel(type: WalletTransactionRecord['type']): string {
    switch (type) {
      case 'deposit':
        return 'Deposit';
      case 'withdrawal':
        return 'Withdrawal';
      case 'bounty_posted':
        return 'Bounty Posted';
      case 'bounty_completed':
        return 'Bounty Completed';
      case 'bounty_received':
        return 'Bounty Payment Received';
      case 'escrow':
        return 'Escrow Hold';
      case 'release':
        return 'Escrow Released';
      case 'refund':
        return 'Refund';
      default:
        return 'Transaction';
    }
  }

  /**
   * Share receipt as text (can be expanded to PDF/image in future)
   */
  async shareReceipt(transaction: WalletTransactionRecord): Promise<boolean> {
    try {
      const receiptText = this.generateReceiptText(transaction);
      
      // Check if sharing is available
      const isAvailable = await Sharing.isAvailableAsync();
      
      if (isAvailable) {
        // For now, we'll use a simple text share
        // In production, this could generate a PDF or image
        const { Share } = await import('react-native');
        await Share.share({
          message: receiptText,
          title: 'Transaction Receipt',
        });
        return true;
      } else {
        console.warn('Sharing is not available on this device');
        return false;
      }
    } catch (error) {
      console.error('Error sharing receipt:', error);
      return false;
    }
  }

  /**
   * Generate a simple HTML receipt (for web or PDF generation)
   */
  generateReceiptHTML(transaction: WalletTransactionRecord): string {
    const date = new Date(transaction.date);
    const formattedDate = date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const formattedTime = date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });

    const typeLabel = this.getTypeLabel(transaction.type);
    const amount = Math.abs(transaction.amount);
    const sign = transaction.amount >= 0 ? '+' : '-';
    const amountColor = transaction.amount >= 0 ? '#008e2a' : '#ef4444';

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>BOUNTY Receipt</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      max-width: 600px;
      margin: 40px auto;
      padding: 20px;
      background: #f3f4f6;
    }
    .receipt {
      background: white;
      border-radius: 8px;
      padding: 30px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .header {
      text-align: center;
      border-bottom: 2px solid #008e2a;
      padding-bottom: 20px;
      margin-bottom: 20px;
    }
    .title {
      font-size: 24px;
      font-weight: bold;
      color: #008e2a;
      margin: 0;
    }
    .amount {
      font-size: 32px;
      font-weight: bold;
      color: ${amountColor};
      text-align: center;
      margin: 20px 0;
    }
    .details {
      margin-top: 20px;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      padding: 10px 0;
      border-bottom: 1px solid #e5e7eb;
    }
    .label {
      color: #6b7280;
      font-weight: 500;
    }
    .value {
      color: #111827;
      font-weight: 600;
    }
    .footer {
      text-align: center;
      margin-top: 30px;
      padding-top: 20px;
      border-top: 2px solid #008e2a;
      color: #6b7280;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="receipt">
    <div class="header">
      <h1 class="title">BOUNTY</h1>
      <p>Transaction Receipt</p>
    </div>
    
    <div class="amount">${sign}$${amount.toFixed(2)}</div>
    
    <div class="details">
      <div class="detail-row">
        <span class="label">Transaction Type</span>
        <span class="value">${typeLabel}</span>
      </div>
      <div class="detail-row">
        <span class="label">Date</span>
        <span class="value">${formattedDate}</span>
      </div>
      <div class="detail-row">
        <span class="label">Time</span>
        <span class="value">${formattedTime}</span>
      </div>
      <div class="detail-row">
        <span class="label">Transaction ID</span>
        <span class="value">${transaction.id}</span>
      </div>
      ${transaction.details.title ? `
      <div class="detail-row">
        <span class="label">Description</span>
        <span class="value">${transaction.details.title}</span>
      </div>
      ` : ''}
      ${transaction.details.method ? `
      <div class="detail-row">
        <span class="label">Method</span>
        <span class="value">${transaction.details.method}</span>
      </div>
      ` : ''}
      ${transaction.details.status ? `
      <div class="detail-row">
        <span class="label">Status</span>
        <span class="value">${transaction.details.status}</span>
      </div>
      ` : ''}
      ${transaction.escrowStatus ? `
      <div class="detail-row">
        <span class="label">Escrow Status</span>
        <span class="value">${transaction.escrowStatus}</span>
      </div>
      ` : ''}
    </div>
    
    <div class="footer">
      Thank you for using BOUNTY<br>
      Keep this receipt for your records
    </div>
  </div>
</body>
</html>
    `.trim();
  }
}

export const receiptService = new ReceiptService();
