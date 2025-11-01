import { db } from '../db/connection';
import { users, bounties } from '../db/schema';
import { eq } from 'drizzle-orm';

export interface EmailReceipt {
  to: string;
  subject: string;
  body: string;
  bountyId: string;
  transactionType: 'escrow' | 'release' | 'refund';
}

export class EmailService {
  private isConfigured: boolean = false;
  private emailProvider?: 'stripe' | 'sendgrid' | 'console'; // Can be extended

  constructor() {
    // Check for email service configuration
    // For now, we'll use console logging as a fallback
    this.emailProvider = process.env.EMAIL_PROVIDER as any || 'console';
    this.isConfigured = true;
    
    if (this.emailProvider === 'console') {
      console.warn('[EmailService] Using console logging for emails. Configure EMAIL_PROVIDER for production.');
    }
  }

  /**
   * Send escrow confirmation email to bounty poster
   */
  async sendEscrowConfirmation(bountyId: string, creatorId: string): Promise<boolean> {
    try {
      const bounty = await this.getBountyDetails(bountyId);
      const creator = await this.getUserDetails(creatorId);

      if (!bounty || !creator) {
        console.error('Failed to get bounty or creator details');
        return false;
      }

      const receipt: EmailReceipt = {
        to: creator.handle, // In production, this would be creator.email
        subject: `Escrow Confirmation - ${bounty.title}`,
        body: this.generateEscrowEmail(bounty, creator),
        bountyId,
        transactionType: 'escrow',
      };

      return await this.sendEmail(receipt);
    } catch (error) {
      console.error('Error sending escrow confirmation:', error);
      return false;
    }
  }

  /**
   * Send release confirmation email to both parties
   */
  async sendReleaseConfirmation(
    bountyId: string, 
    creatorId: string, 
    hunterId: string,
    amount: number,
    platformFee: number
  ): Promise<boolean> {
    try {
      const bounty = await this.getBountyDetails(bountyId);
      const creator = await this.getUserDetails(creatorId);
      const hunter = await this.getUserDetails(hunterId);

      if (!bounty || !creator || !hunter) {
        console.error('Failed to get bounty or user details');
        return false;
      }

      // Send to hunter (recipient)
      const hunterReceipt: EmailReceipt = {
        to: hunter.handle,
        subject: `Payment Received - ${bounty.title}`,
        body: this.generateReleaseEmailHunter(bounty, hunter, amount, platformFee),
        bountyId,
        transactionType: 'release',
      };

      // Send to creator (poster)
      const creatorReceipt: EmailReceipt = {
        to: creator.handle,
        subject: `Payment Sent - ${bounty.title}`,
        body: this.generateReleaseEmailCreator(bounty, creator, hunter, amount, platformFee),
        bountyId,
        transactionType: 'release',
      };

      const hunterSuccess = await this.sendEmail(hunterReceipt);
      const creatorSuccess = await this.sendEmail(creatorReceipt);

      return hunterSuccess && creatorSuccess;
    } catch (error) {
      console.error('Error sending release confirmation:', error);
      return false;
    }
  }

  /**
   * Send refund confirmation email to bounty poster
   */
  async sendRefundConfirmation(
    bountyId: string,
    creatorId: string,
    amount: number,
    reason?: string
  ): Promise<boolean> {
    try {
      const bounty = await this.getBountyDetails(bountyId);
      const creator = await this.getUserDetails(creatorId);

      if (!bounty || !creator) {
        console.error('Failed to get bounty or creator details');
        return false;
      }

      const receipt: EmailReceipt = {
        to: creator.handle,
        subject: `Refund Processed - ${bounty.title}`,
        body: this.generateRefundEmail(bounty, creator, amount, reason),
        bountyId,
        transactionType: 'refund',
      };

      return await this.sendEmail(receipt);
    } catch (error) {
      console.error('Error sending refund confirmation:', error);
      return false;
    }
  }

  /**
   * Send email based on configured provider
   */
  private async sendEmail(receipt: EmailReceipt): Promise<boolean> {
    try {
      switch (this.emailProvider) {
        case 'console':
          console.log('\n═══════════════════════════════════════════════════════');
          console.log('📧 EMAIL RECEIPT');
          console.log('═══════════════════════════════════════════════════════');
          console.log(`To: ${receipt.to}`);
          console.log(`Subject: ${receipt.subject}`);
          console.log(`Transaction Type: ${receipt.transactionType}`);
          console.log('───────────────────────────────────────────────────────');
          console.log(receipt.body);
          console.log('═══════════════════════════════════════════════════════\n');
          return true;

        case 'stripe':
          // TODO: Implement Stripe email sending
          console.log('[EmailService] Stripe email provider not yet implemented');
          return false;

        case 'sendgrid':
          // TODO: Implement SendGrid integration
          console.log('[EmailService] SendGrid provider not yet implemented');
          return false;

        default:
          console.warn(`[EmailService] Unknown email provider: ${this.emailProvider}`);
          return false;
      }
    } catch (error) {
      console.error('Error sending email:', error);
      return false;
    }
  }

  /**
   * Generate escrow confirmation email body
   */
  private generateEscrowEmail(bounty: any, creator: any): string {
    return `
Hello ${creator.handle},

Your payment for the bounty "${bounty.title}" has been successfully held in escrow.

TRANSACTION DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Bounty ID: ${bounty.id}
Amount Held: $${(bounty.amount_cents / 100).toFixed(2)}
Status: Funds Held in Escrow
Date: ${new Date().toLocaleDateString()}

WHAT HAPPENS NEXT?
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Your funds are securely held
✓ Hunter will complete the work
✓ Upon completion, funds will be released automatically
✓ If cancelled, you'll receive a full refund

Questions? Contact support@bountyexpo.com

Best regards,
The BountyExpo Team
    `.trim();
  }

  /**
   * Generate release email for hunter (recipient)
   */
  private generateReleaseEmailHunter(bounty: any, hunter: any, amount: number, platformFee: number): string {
    return `
Hello ${hunter.handle},

Congratulations! Payment for "${bounty.title}" has been released to you.

PAYMENT DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Bounty ID: ${bounty.id}
Gross Amount: $${((amount + platformFee) / 100).toFixed(2)}
Platform Fee: $${(platformFee / 100).toFixed(2)}
Net Payment: $${(amount / 100).toFixed(2)}
Date: ${new Date().toLocaleDateString()}
Status: Payment Complete

FUNDS TRANSFER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Funds will be transferred to your connected Stripe account within 1-2 business days.

Keep up the great work!

Best regards,
The BountyExpo Team
    `.trim();
  }

  /**
   * Generate release email for creator (poster)
   */
  private generateReleaseEmailCreator(
    bounty: any,
    creator: any,
    hunter: any,
    amount: number,
    platformFee: number
  ): string {
    return `
Hello ${creator.handle},

Payment for "${bounty.title}" has been successfully sent to ${hunter.handle}.

TRANSACTION SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Bounty ID: ${bounty.id}
Total Amount: $${((amount + platformFee) / 100).toFixed(2)}
Paid to Hunter: $${(amount / 100).toFixed(2)}
Platform Fee: $${(platformFee / 100).toFixed(2)}
Date: ${new Date().toLocaleDateString()}
Status: Payment Complete

Thank you for using BountyExpo!

Best regards,
The BountyExpo Team
    `.trim();
  }

  /**
   * Generate refund email
   */
  private generateRefundEmail(bounty: any, creator: any, amount: number, reason?: string): string {
    const reasonLine = reason ? `Reason: ${reason}\n` : '';
    
    return `
Hello ${creator.handle},

Your bounty "${bounty.title}" has been cancelled and a refund has been processed.

REFUND DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Bounty ID: ${bounty.id}
Refund Amount: $${(amount / 100).toFixed(2)}
${reasonLine}Date: ${new Date().toLocaleDateString()}
Status: Refund Processed

WHAT'S NEXT?
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Your refund will appear in your original payment method within 5-10 business days.

Questions? Contact support@bountyexpo.com

Best regards,
The BountyExpo Team
    `.trim();
  }

  /**
   * Helper: Get bounty details
   */
  private async getBountyDetails(bountyId: string) {
    const bountyRecord = await db
      .select()
      .from(bounties)
      .where(eq(bounties.id, bountyId))
      .limit(1);

    return bountyRecord.length > 0 ? bountyRecord[0] : null;
  }

  /**
   * Helper: Get user details
   */
  private async getUserDetails(userId: string) {
    const userRecord = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return userRecord.length > 0 ? userRecord[0] : null;
  }
}

// Export singleton instance
export const emailService = new EmailService();
