/**
 * Apple Pay Receipt Service
 * Generates and sends receipts for Apple Pay transactions
 */

import { logger } from './logger';

export interface ApplePayReceiptData {
  transactionId: string;
  userId: string;
  amount: number;
  paymentIntentId: string;
  paymentMethod: string;
  timestamp: Date;
  userEmail?: string;
  userName?: string;
}

export class ApplePayReceiptService {
  /**
   * Generate HTML receipt for Apple Pay transaction
   */
  generateReceiptHTML(data: ApplePayReceiptData): string {
    const formattedDate = data.timestamp.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const formattedTime = data.timestamp.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>BOUNTY - Apple Pay Receipt</title>
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
      border-radius: 12px;
      padding: 40px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.08);
    }
    .header {
      text-align: center;
      border-bottom: 3px solid #059669;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    .logo {
      font-size: 28px;
      font-weight: bold;
      color: #059669;
      margin: 0;
    }
    .subtitle {
      color: #6b7280;
      margin-top: 8px;
    }
    .apple-pay-badge {
      display: inline-flex;
      align-items: center;
      background: #000;
      color: #fff;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      margin: 20px 0;
    }
    .amount-section {
      text-align: center;
      margin: 30px 0;
      padding: 20px;
      background: #f9fafb;
      border-radius: 8px;
    }
    .amount {
      font-size: 42px;
      font-weight: bold;
      color: #10b981;
      margin: 10px 0;
    }
    .amount-label {
      color: #6b7280;
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .details {
      margin-top: 30px;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      padding: 14px 0;
      border-bottom: 1px solid #e5e7eb;
    }
    .label {
      color: #6b7280;
      font-weight: 500;
    }
    .value {
      color: #111827;
      font-weight: 600;
      text-align: right;
    }
    .transaction-id {
      font-family: 'Courier New', monospace;
      font-size: 12px;
      word-break: break-all;
    }
    .footer {
      text-align: center;
      margin-top: 40px;
      padding-top: 20px;
      border-top: 2px solid #e5e7eb;
      color: #6b7280;
      font-size: 13px;
      line-height: 1.6;
    }
    .success-icon {
      width: 48px;
      height: 48px;
      background: #10b981;
      border-radius: 50%;
      margin: 0 auto 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 24px;
    }
    .security-note {
      background: #fef3c7;
      border-left: 4px solid #f59e0b;
      padding: 12px 16px;
      margin-top: 20px;
      border-radius: 4px;
      font-size: 13px;
      color: #92400e;
    }
  </style>
</head>
<body>
  <div class="receipt">
    <div class="header">
      <div class="success-icon">✓</div>
      <h1 class="logo">BOUNTY</h1>
      <p class="subtitle">Payment Receipt</p>
      <div class="apple-pay-badge">
        <span style="margin-right: 8px;">􀀃</span> Apple Pay
      </div>
    </div>
    
    <div class="amount-section">
      <div class="amount-label">Amount Deposited</div>
      <div class="amount">$${data.amount.toFixed(2)}</div>
    </div>
    
    <div class="details">
      <div class="detail-row">
        <span class="label">Transaction Type</span>
        <span class="value">Wallet Deposit</span>
      </div>
      <div class="detail-row">
        <span class="label">Payment Method</span>
        <span class="value">Apple Pay</span>
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
        <span class="label">Status</span>
        <span class="value" style="color: #10b981;">✓ Completed</span>
      </div>
      <div class="detail-row">
        <span class="label">Transaction ID</span>
        <span class="value transaction-id">${data.transactionId}</span>
      </div>
      <div class="detail-row">
        <span class="label">Payment Intent ID</span>
        <span class="value transaction-id">${data.paymentIntentId}</span>
      </div>
    </div>
    
    <div class="security-note">
      <strong>Security:</strong> This transaction was processed securely through Apple Pay and Stripe. 
      Your payment information is protected by industry-leading encryption.
    </div>
    
    <div class="footer">
      <strong>Thank you for using BOUNTY</strong><br>
      Keep this receipt for your records<br>
      <br>
      Questions? Contact us at support@bountyexpo.com<br>
      Transaction processed by Stripe
    </div>
  </div>
</body>
</html>
    `.trim();
  }

  /**
   * Generate plain text receipt for Apple Pay transaction
   */
  generateReceiptText(data: ApplePayReceiptData): string {
    const formattedDate = data.timestamp.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const formattedTime = data.timestamp.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });

    return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       BOUNTY RECEIPT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ Payment Successful

Amount: $${data.amount.toFixed(2)}
Payment Method: Apple Pay

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Transaction Details:
  Type: Wallet Deposit
  Date: ${formattedDate}
  Time: ${formattedTime}
  Status: Completed
  
  Transaction ID:
  ${data.transactionId}
  
  Payment Intent ID:
  ${data.paymentIntentId}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Security: This transaction was processed
securely through Apple Pay and Stripe.

Questions? support@bountyexpo.com

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Thank you for using BOUNTY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `.trim();
  }

  /**
   * Send receipt email (placeholder for now, can be integrated with email service)
   */
  async sendReceiptEmail(data: ApplePayReceiptData): Promise<boolean> {
    try {
      if (!data.userEmail) {
        logger.warn({
          userId: data.userId,
          transactionId: data.transactionId
        }, '[ApplePayReceipt] No email address provided, skipping email');
        return false;
      }

      // Generate receipt content (unused until email service is wired up)
      const htmlContent = this.generateReceiptHTML(data);
      const textContent = this.generateReceiptText(data);

      // TODO: Integrate with actual email service
      // For now, just log that we would send an email
      logger.info({
        to: data.userEmail,
        subject: `BOUNTY - Apple Pay Receipt ($${data.amount.toFixed(2)})`,
        transactionId: data.transactionId
      }, '[ApplePayReceipt] Email receipt would be sent (not yet implemented)');

      // In production, this would call an email service:
      // await emailService.send({
      //   to: data.userEmail,
      //   subject: `BOUNTY - Apple Pay Receipt ($${data.amount.toFixed(2)})`,
      //   html: htmlContent,
      //   text: textContent,
      // });

      // Return false until an actual email provider is wired up to avoid
      // signaling successful delivery when no email was sent
      return false;
    } catch (error) {
      logger.error({
        error,
        userId: data.userId,
        transactionId: data.transactionId
      }, '[ApplePayReceipt] Failed to send receipt email');
      return false;
    }
  }

  /**
   * Log receipt to console (for development/testing)
   */
  logReceipt(data: ApplePayReceiptData): void {
    const textReceipt = this.generateReceiptText(data);
    logger.info({
      transactionId: data.transactionId,
      userId: data.userId,
      amount: data.amount,
      receipt: textReceipt
    }, '[ApplePayReceipt] Receipt generated');
  }
}

export const applePayReceiptService = new ApplePayReceiptService();
