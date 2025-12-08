import { db } from '../db/connection';
import { remediationWorkflows, riskActions, users, riskCommunications } from '../db/schema';
import { eq, and } from 'drizzle-orm';

export interface RemediationRequirement {
  documentType: string;
  required: boolean;
  description: string;
  status?: 'pending' | 'submitted' | 'verified' | 'rejected';
}

export interface RemediationWorkflowInput {
  userId: string;
  riskActionId: string;
  workflowType: string;
  requiredDocuments: RemediationRequirement[];
}

export class RemediationService {
  /**
   * Create a new remediation workflow for a user
   */
  async createRemediationWorkflow(input: RemediationWorkflowInput): Promise<string> {
    try {
      const workflow = await db
        .insert(remediationWorkflows)
        .values({
          user_id: input.userId,
          risk_action_id: input.riskActionId,
          workflow_type: input.workflowType,
          required_documents: input.requiredDocuments as any,
          submitted_documents: [],
        })
        .returning();

      const workflowId = workflow[0].id;

      // Notify user about remediation requirements
      await this.notifyUserAboutRemediation(input.userId, workflowId, input.workflowType, input.requiredDocuments);

      return workflowId;
    } catch (error) {
      console.error('Error creating remediation workflow:', error);
      throw error;
    }
  }

  /**
   * Submit documents for remediation
   */
  async submitDocuments(workflowId: string, documents: Array<{ type: string; url: string; metadata?: any }>): Promise<void> {
    try {
      // Get existing workflow
      const existing = await db.select().from(remediationWorkflows).where(eq(remediationWorkflows.id, workflowId)).limit(1);

      if (!existing.length) {
        throw new Error('Remediation workflow not found');
      }

      const workflow = existing[0];

      // Update submitted documents
      const currentSubmitted = (workflow.submitted_documents as any[]) || [];
      const updatedDocuments = [...currentSubmitted, ...documents];

      await db
        .update(remediationWorkflows)
        .set({
          submitted_documents: updatedDocuments as any,
          status: 'in_progress',
          updated_at: new Date(),
        })
        .where(eq(remediationWorkflows.id, workflowId));

      // Notify admins/reviewers about submission
      await this.notifyReviewers(workflow.user_id, workflowId);
    } catch (error) {
      console.error('Error submitting remediation documents:', error);
      throw error;
    }
  }

  /**
   * Review and approve/reject remediation
   */
  async reviewRemediation(
    workflowId: string,
    reviewedBy: string,
    approved: boolean,
    reviewNotes: string
  ): Promise<{
    success: boolean;
    accountRestored: boolean;
  }> {
    try {
      const workflow = await db.select().from(remediationWorkflows).where(eq(remediationWorkflows.id, workflowId)).limit(1);

      if (!workflow.length) {
        throw new Error('Remediation workflow not found');
      }

      const record = workflow[0];

      if (approved) {
        // Mark workflow as completed
        await db
          .update(remediationWorkflows)
          .set({
            status: 'completed',
            review_notes: reviewNotes,
            reviewed_by: reviewedBy,
            reviewed_at: new Date(),
            completed_at: new Date(),
            updated_at: new Date(),
          })
          .where(eq(remediationWorkflows.id, workflowId));

        // Resolve the associated risk action
        await db
          .update(riskActions)
          .set({
            status: 'resolved',
            resolved_at: new Date(),
            resolved_by: reviewedBy,
            resolution_notes: reviewNotes,
          })
          .where(eq(riskActions.id, record.risk_action_id));

        // Restore account if it was restricted
        await db
          .update(users)
          .set({
            account_restricted: false,
            restriction_reason: null,
            verification_status: 'verified',
            kyc_verified_at: new Date(),
          })
          .where(eq(users.id, record.user_id));

        // Notify user of approval
        await this.notifyRemediationResult(record.user_id, workflowId, true, reviewNotes);

        return { success: true, accountRestored: true };
      } else {
        // Mark workflow as failed
        await db
          .update(remediationWorkflows)
          .set({
            status: 'failed',
            review_notes: reviewNotes,
            reviewed_by: reviewedBy,
            reviewed_at: new Date(),
            updated_at: new Date(),
          })
          .where(eq(remediationWorkflows.id, workflowId));

        // Notify user of rejection
        await this.notifyRemediationResult(record.user_id, workflowId, false, reviewNotes);

        return { success: true, accountRestored: false };
      }
    } catch (error) {
      console.error('Error reviewing remediation:', error);
      throw error;
    }
  }

  /**
   * Get remediation status for a user
   */
  async getRemediationStatus(userId: string): Promise<
    Array<{
      workflowId: string;
      workflowType: string;
      status: string;
      requiredDocuments: any;
      submittedDocuments: any;
      createdAt: string;
    }>
  > {
    const workflows = await db.select().from(remediationWorkflows).where(eq(remediationWorkflows.user_id, userId));

    return workflows.map((w) => ({
      workflowId: w.id,
      workflowType: w.workflow_type,
      status: w.status,
      requiredDocuments: w.required_documents,
      submittedDocuments: w.submitted_documents,
      createdAt: w.created_at.toISOString(),
    }));
  }

  /**
   * Get pending remediation workflows (for admin review)
   */
  async getPendingRemediations(): Promise<
    Array<{
      workflowId: string;
      userId: string;
      workflowType: string;
      status: string;
      createdAt: string;
      requiredDocuments: any;
      submittedDocuments: any;
    }>
  > {
    const pending = await db
      .select()
      .from(remediationWorkflows)
      .where(eq(remediationWorkflows.status, 'in_progress'));

    return pending.map((w) => ({
      workflowId: w.id,
      userId: w.user_id,
      workflowType: w.workflow_type,
      status: w.status,
      createdAt: w.created_at.toISOString(),
      requiredDocuments: w.required_documents,
      submittedDocuments: w.submitted_documents,
    }));
  }

  /**
   * Notify user about remediation requirements
   */
  private async notifyUserAboutRemediation(
    userId: string,
    workflowId: string,
    workflowType: string,
    requirements: RemediationRequirement[]
  ): Promise<void> {
    const workflowTypeNames: Record<string, string> = {
      document_verification: 'Document Verification',
      identity_check: 'Identity Verification',
      business_verification: 'Business Verification',
      transaction_review: 'Transaction Review',
    };

    const workflowName = workflowTypeNames[workflowType] || 'Account Verification';
    const requiredDocs = requirements.filter((r) => r.required).map((r) => `- ${r.description}`);

    const message = `
To restore your account to full functionality, we need you to complete ${workflowName}.

Required documents/information:
${requiredDocs.join('\n')}

Please submit these documents through your account settings. Once submitted, our team will review them within 1-2 business days.

Thank you for your cooperation.
    `.trim();

    await db.insert(riskCommunications).values({
      user_id: userId,
      communication_type: 'in_app',
      subject: `Action Required: ${workflowName}`,
      message,
    });
  }

  /**
   * Notify reviewers about document submission
   */
  private async notifyReviewers(userId: string, workflowId: string): Promise<void> {
    // In production, this would send notifications to admin/review team
    console.log(`📨 Remediation documents submitted for workflow ${workflowId} by user ${userId}`);
  }

  /**
   * Notify user about remediation review result
   */
  private async notifyRemediationResult(
    userId: string,
    workflowId: string,
    approved: boolean,
    notes: string
  ): Promise<void> {
    const subject = approved ? 'Account Restored' : 'Additional Information Required';

    const message = approved
      ? `
Your verification has been approved and your account has been restored to full functionality.

${notes}

Thank you for your cooperation.
      `.trim()
      : `
Your verification submission has been reviewed. Unfortunately, we need additional information:

${notes}

Please submit the requested information through your account settings.
      `.trim();

    await db.insert(riskCommunications).values({
      user_id: userId,
      communication_type: 'in_app',
      subject,
      message,
    });
  }

  /**
   * Auto-trigger remediation based on risk action
   */
  async autoTriggerRemediation(userId: string, riskActionId: string, actionType: string): Promise<string | null> {
    // Determine workflow type based on action
    const workflowMap: Record<string, { type: string; requirements: RemediationRequirement[] }> = {
      require_identity_verification: {
        type: 'identity_check',
        requirements: [
          {
            documentType: 'government_id',
            required: true,
            description: 'Government-issued photo ID (passport, driver\'s license, or national ID)',
          },
          {
            documentType: 'selfie',
            required: true,
            description: 'Selfie holding your ID next to your face',
          },
        ],
      },
      verify_business_category: {
        type: 'business_verification',
        requirements: [
          {
            documentType: 'business_license',
            required: true,
            description: 'Valid business license or registration',
          },
          {
            documentType: 'business_address',
            required: true,
            description: 'Proof of business address (utility bill or lease agreement)',
          },
        ],
      },
      require_additional_verification: {
        type: 'document_verification',
        requirements: [
          {
            documentType: 'proof_of_address',
            required: true,
            description: 'Recent utility bill or bank statement (within last 3 months)',
          },
          {
            documentType: 'government_id',
            required: true,
            description: 'Government-issued photo ID',
          },
        ],
      },
    };

    const workflow = workflowMap[actionType];
    if (!workflow) {
      return null; // No auto-remediation for this action type
    }

    return await this.createRemediationWorkflow({
      userId,
      riskActionId,
      workflowType: workflow.type,
      requiredDocuments: workflow.requirements,
    });
  }
}

export const remediationService = new RemediationService();
