import { FastifyPluginAsync } from 'fastify';
import { riskManagementService } from '../services/risk-management-service';
import { remediationService } from '../services/remediation-service';
import { db } from '../db/connection';
import { restrictedBusinessCategories } from '../db/schema';

const riskManagementRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * Assess user risk
   */
  fastify.post('/api/risk/assess/:userId', async (request, reply) => {
    try {
      const { userId } = request.params as { userId: string };
      const { assessmentType } = request.body as { assessmentType?: string };

      const result = await riskManagementService.assessUserRisk(userId, assessmentType || 'manual');

      return reply.code(200).send({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('Error assessing user risk:', error);
      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to assess user risk',
      });
    }
  });

  /**
   * Take a risk action on a user
   */
  fastify.post('/api/risk/action', async (request, reply) => {
    try {
      const { userId, actionType, reason, severity, automated, triggeredBy } = request.body as {
        userId: string;
        actionType: string;
        reason: string;
        severity: string;
        automated?: boolean;
        triggeredBy?: string;
      };

      if (!userId || !actionType || !reason || !severity) {
        return reply.code(400).send({
          success: false,
          error: 'Missing required fields: userId, actionType, reason, severity',
        });
      }

      const actionId = await riskManagementService.takeRiskAction(
        userId,
        actionType,
        reason,
        severity,
        automated ?? false,
        triggeredBy
      );

      // Auto-trigger remediation if applicable
      const remediationWorkflowId = await remediationService.autoTriggerRemediation(userId, actionId, actionType);

      return reply.code(200).send({
        success: true,
        data: {
          actionId,
          remediationWorkflowId,
        },
      });
    } catch (error) {
      console.error('Error taking risk action:', error);
      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to take risk action',
      });
    }
  });

  /**
   * Establish a reserve for a user
   */
  fastify.post('/api/risk/reserve', async (request, reply) => {
    try {
      const { userId, reserveType, amountCents, percentage, reason, releaseDays } = request.body as {
        userId: string;
        reserveType: string;
        amountCents: number;
        percentage?: number;
        reason: string;
        releaseDays?: number;
      };

      if (!userId || !reserveType || !amountCents || !reason) {
        return reply.code(400).send({
          success: false,
          error: 'Missing required fields: userId, reserveType, amountCents, reason',
        });
      }

      const reserveId = await riskManagementService.establishReserve(
        userId,
        reserveType,
        amountCents,
        percentage || null,
        reason,
        releaseDays || 90
      );

      return reply.code(200).send({
        success: true,
        data: {
          reserveId,
        },
      });
    } catch (error) {
      console.error('Error establishing reserve:', error);
      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to establish reserve',
      });
    }
  });

  /**
   * Check business category compliance
   */
  fastify.post('/api/risk/check-category', async (request, reply) => {
    try {
      const { businessCategory } = request.body as { businessCategory: string };

      if (!businessCategory) {
        return reply.code(400).send({
          success: false,
          error: 'Missing required field: businessCategory',
        });
      }

      const result = await riskManagementService.checkBusinessCategoryCompliance(businessCategory);

      return reply.code(200).send({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('Error checking business category:', error);
      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to check business category',
      });
    }
  });

  /**
   * Get total platform liability
   */
  fastify.get('/api/risk/liability', async (request, reply) => {
    try {
      const liability = await riskManagementService.calculateTotalLiability();

      return reply.code(200).send({
        success: true,
        data: liability,
      });
    } catch (error) {
      console.error('Error calculating liability:', error);
      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to calculate liability',
      });
    }
  });

  /**
   * Create remediation workflow
   */
  fastify.post('/api/risk/remediation/create', async (request, reply) => {
    try {
      const { userId, riskActionId, workflowType, requiredDocuments } = request.body as {
        userId: string;
        riskActionId: string;
        workflowType: string;
        requiredDocuments: Array<{
          documentType: string;
          required: boolean;
          description: string;
        }>;
      };

      if (!userId || !riskActionId || !workflowType || !requiredDocuments) {
        return reply.code(400).send({
          success: false,
          error: 'Missing required fields',
        });
      }

      const workflowId = await remediationService.createRemediationWorkflow({
        userId,
        riskActionId,
        workflowType,
        requiredDocuments,
      });

      return reply.code(200).send({
        success: true,
        data: {
          workflowId,
        },
      });
    } catch (error) {
      console.error('Error creating remediation workflow:', error);
      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create remediation workflow',
      });
    }
  });

  /**
   * Submit documents for remediation
   */
  fastify.post('/api/risk/remediation/:workflowId/submit', async (request, reply) => {
    try {
      const { workflowId } = request.params as { workflowId: string };
      const { documents } = request.body as {
        documents: Array<{ type: string; url: string; metadata?: any }>;
      };

      if (!documents || !Array.isArray(documents)) {
        return reply.code(400).send({
          success: false,
          error: 'Missing or invalid documents field',
        });
      }

      await remediationService.submitDocuments(workflowId, documents);

      return reply.code(200).send({
        success: true,
        message: 'Documents submitted successfully',
      });
    } catch (error) {
      console.error('Error submitting remediation documents:', error);
      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to submit documents',
      });
    }
  });

  /**
   * Review and approve/reject remediation
   */
  fastify.post('/api/risk/remediation/:workflowId/review', async (request, reply) => {
    try {
      const { workflowId } = request.params as { workflowId: string };
      const { approved, reviewNotes, reviewedBy } = request.body as {
        approved: boolean;
        reviewNotes: string;
        reviewedBy: string;
      };

      if (approved === undefined || !reviewNotes || !reviewedBy) {
        return reply.code(400).send({
          success: false,
          error: 'Missing required fields: approved, reviewNotes, reviewedBy',
        });
      }

      const result = await remediationService.reviewRemediation(workflowId, reviewedBy, approved, reviewNotes);

      return reply.code(200).send({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('Error reviewing remediation:', error);
      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to review remediation',
      });
    }
  });

  /**
   * Get user's remediation status
   */
  fastify.get('/api/risk/remediation/user/:userId', async (request, reply) => {
    try {
      const { userId } = request.params as { userId: string };

      const workflows = await remediationService.getRemediationStatus(userId);

      return reply.code(200).send({
        success: true,
        data: workflows,
      });
    } catch (error) {
      console.error('Error getting remediation status:', error);
      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get remediation status',
      });
    }
  });

  /**
   * Get pending remediation workflows (admin)
   */
  fastify.get('/api/risk/remediation/pending', async (request, reply) => {
    try {
      const pending = await remediationService.getPendingRemediations();

      return reply.code(200).send({
        success: true,
        data: pending,
      });
    } catch (error) {
      console.error('Error getting pending remediations:', error);
      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get pending remediations',
      });
    }
  });

  /**
   * Get all restricted business categories
   */
  fastify.get('/api/risk/restricted-categories', async (request, reply) => {
    try {
      const categories = await db.select().from(restrictedBusinessCategories);

      return reply.code(200).send({
        success: true,
        data: categories,
      });
    } catch (error) {
      console.error('Error getting restricted categories:', error);
      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get restricted categories',
      });
    }
  });

  /**
   * Add a restricted business category (admin)
   */
  fastify.post('/api/risk/restricted-categories', async (request, reply) => {
    try {
      const { categoryCode, categoryName, description, riskLevel, isProhibited } = request.body as {
        categoryCode: string;
        categoryName: string;
        description?: string;
        riskLevel: string;
        isProhibited?: boolean;
      };

      if (!categoryCode || !categoryName || !riskLevel) {
        return reply.code(400).send({
          success: false,
          error: 'Missing required fields: categoryCode, categoryName, riskLevel',
        });
      }

      const category = await db
        .insert(restrictedBusinessCategories)
        .values({
          category_code: categoryCode,
          category_name: categoryName,
          description,
          risk_level: riskLevel,
          is_prohibited: isProhibited || false,
        })
        .returning();

      return reply.code(200).send({
        success: true,
        data: category[0],
      });
    } catch (error) {
      console.error('Error adding restricted category:', error);
      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add restricted category',
      });
    }
  });
};

export default riskManagementRoutes;
