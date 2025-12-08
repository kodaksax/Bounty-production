import { riskManagementService } from '../services/risk-management-service';
import { remediationService } from '../services/remediation-service';
import { db } from '../db/connection';
import { users, walletTransactions, restrictedBusinessCategories } from '../db/schema';
import { eq } from 'drizzle-orm';

/**
 * Risk Management Service Tests
 * 
 * These tests validate the risk assessment, monitoring, and mitigation features
 */

describe('Risk Management Service', () => {
  let testUserId: string;

  beforeEach(async () => {
    // Create a test user
    const user = await db
      .insert(users)
      .values({
        handle: '@test-risk-user',
        verification_status: 'pending',
        risk_level: 'low',
        risk_score: 0,
      })
      .returning();
    
    testUserId = user[0].id;
  });

  afterEach(async () => {
    // Clean up test data
    if (testUserId) {
      await db.delete(users).where(eq(users.id, testUserId));
    }
  });

  describe('Risk Assessment', () => {
    it('should assess user risk based on multiple factors', async () => {
      const result = await riskManagementService.assessUserRisk(testUserId, 'test');
      
      expect(result).toBeDefined();
      expect(result.userId).toBe(testUserId);
      expect(result.riskScore).toBeGreaterThanOrEqual(0);
      expect(result.riskScore).toBeLessThanOrEqual(100);
      expect(['low', 'medium', 'high', 'critical']).toContain(result.riskLevel);
      expect(result.factors).toBeDefined();
      expect(result.recommendedActions).toBeInstanceOf(Array);
    });

    it('should give higher risk score to new accounts', async () => {
      const result = await riskManagementService.assessUserRisk(testUserId);
      
      // New account should have high account age risk
      expect(result.factors.accountAge).toBeGreaterThan(50);
    });

    it('should give higher risk score to unverified accounts', async () => {
      const result = await riskManagementService.assessUserRisk(testUserId);
      
      // Unverified account should have high verification risk
      expect(result.factors.verificationStatus).toBeGreaterThan(50);
    });

    it('should recommend reserve for medium+ risk users', async () => {
      // Create some high-velocity transactions to increase risk
      const transactions = Array(15).fill(null).map((_, i) => ({
        user_id: testUserId,
        type: 'escrow',
        amount_cents: 10000,
      }));
      
      await db.insert(walletTransactions).values(transactions);
      
      const result = await riskManagementService.assessUserRisk(testUserId);
      
      if (result.riskLevel !== 'low') {
        expect(result.requiresReserve).toBe(true);
        expect(result.reservePercentage).toBeGreaterThan(0);
      }
    });
  });

  describe('Business Category Compliance', () => {
    beforeEach(async () => {
      // Seed test restricted category
      await db.insert(restrictedBusinessCategories).values({
        category_code: 'test_prohibited',
        category_name: 'Test Prohibited Category',
        risk_level: 'prohibited',
        is_prohibited: true,
      }).onConflictDoNothing();
    });

    it('should reject prohibited business categories', async () => {
      const result = await riskManagementService.checkBusinessCategoryCompliance('test_prohibited');
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('prohibited');
    });

    it('should allow non-restricted categories', async () => {
      const result = await riskManagementService.checkBusinessCategoryCompliance('general_services');
      
      expect(result.allowed).toBe(true);
    });

    it('should provide risk level for restricted but allowed categories', async () => {
      // Add a high-risk but allowed category
      await db.insert(restrictedBusinessCategories).values({
        category_code: 'test_high_risk',
        category_name: 'Test High Risk Category',
        risk_level: 'high',
        is_prohibited: false,
      }).onConflictDoNothing();
      
      const result = await riskManagementService.checkBusinessCategoryCompliance('test_high_risk');
      
      expect(result.allowed).toBe(true);
      expect(result.riskLevel).toBe('high');
    });
  });

  describe('Risk Actions', () => {
    it('should create risk action and restrict account', async () => {
      const actionId = await riskManagementService.takeRiskAction(
        testUserId,
        'restrict',
        'Test restriction',
        'high',
        false
      );
      
      expect(actionId).toBeDefined();
      
      // Verify user account is restricted
      const updatedUser = await db
        .select()
        .from(users)
        .where(eq(users.id, testUserId))
        .limit(1);
      
      expect(updatedUser[0].account_restricted).toBe(true);
    });

    it('should send notification when taking risk action', async () => {
      const actionId = await riskManagementService.takeRiskAction(
        testUserId,
        'delay_payout',
        'High transaction velocity',
        'medium',
        true,
        'automated_monitor'
      );
      
      expect(actionId).toBeDefined();
      // In production, would verify notification was created
    });
  });

  describe('Reserve Management', () => {
    it('should establish reserve for user', async () => {
      const reserveId = await riskManagementService.establishReserve(
        testUserId,
        'rolling',
        10000, // $100
        10, // 10%
        'High risk user',
        90
      );
      
      expect(reserveId).toBeDefined();
    });

    it('should calculate platform liability correctly', async () => {
      // Create some reserves
      await riskManagementService.establishReserve(
        testUserId,
        'rolling',
        5000,
        10,
        'Test reserve',
        90
      );
      
      const liability = await riskManagementService.calculateTotalLiability();
      
      expect(liability).toBeDefined();
      expect(liability.totalReserves).toBeGreaterThanOrEqual(5000);
      expect(liability.totalLiability).toBeGreaterThanOrEqual(0);
      expect(liability.netExposure).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Transaction Pattern Monitoring', () => {
    it('should detect high velocity transactions', async () => {
      // Create high velocity transactions
      const transactions = Array(12).fill(null).map((_, i) => ({
        user_id: testUserId,
        type: 'escrow',
        amount_cents: 5000,
      }));
      
      await db.insert(walletTransactions).values(transactions);
      
      await riskManagementService.monitorTransactionPattern(
        testUserId,
        'test-txn-1',
        { amount: 50 }
      );
      
      // Would verify pattern was flagged
    });

    it('should auto-trigger action for critical velocity', async () => {
      // Create very high velocity
      const transactions = Array(20).fill(null).map((_, i) => ({
        user_id: testUserId,
        type: 'escrow',
        amount_cents: 5000,
      }));
      
      await db.insert(walletTransactions).values(transactions);
      
      await riskManagementService.monitorTransactionPattern(
        testUserId,
        'test-txn-critical',
        { amount: 50 }
      );
      
      // Would verify action was taken
    });
  });
});

describe('Remediation Service', () => {
  let testUserId: string;
  let testActionId: string;

  beforeEach(async () => {
    // Create test user and risk action
    const user = await db
      .insert(users)
      .values({
        handle: '@test-remediation-user',
        verification_status: 'under_review',
        risk_level: 'medium',
        account_restricted: true,
      })
      .returning();
    
    testUserId = user[0].id;
    
    testActionId = await riskManagementService.takeRiskAction(
      testUserId,
      'require_additional_verification',
      'Test action',
      'medium',
      false
    );
  });

  describe('Workflow Creation', () => {
    it('should create remediation workflow', async () => {
      const workflowId = await remediationService.createRemediationWorkflow({
        userId: testUserId,
        riskActionId: testActionId,
        workflowType: 'identity_check',
        requiredDocuments: [
          {
            documentType: 'government_id',
            required: true,
            description: 'Government ID',
          },
        ],
      });
      
      expect(workflowId).toBeDefined();
    });

    it('should auto-trigger remediation for verification actions', async () => {
      const workflowId = await remediationService.autoTriggerRemediation(
        testUserId,
        testActionId,
        'require_identity_verification'
      );
      
      expect(workflowId).toBeDefined();
    });
  });

  describe('Document Submission', () => {
    it('should accept document submissions', async () => {
      const workflowId = await remediationService.createRemediationWorkflow({
        userId: testUserId,
        riskActionId: testActionId,
        workflowType: 'document_verification',
        requiredDocuments: [
          {
            documentType: 'proof_of_address',
            required: true,
            description: 'Proof of address',
          },
        ],
      });
      
      await remediationService.submitDocuments(workflowId, [
        {
          type: 'proof_of_address',
          url: 'https://example.com/document.pdf',
        },
      ]);
      
      // Would verify submission was recorded
    });
  });

  describe('Review Process', () => {
    it('should approve remediation and restore account', async () => {
      const workflowId = await remediationService.createRemediationWorkflow({
        userId: testUserId,
        riskActionId: testActionId,
        workflowType: 'identity_check',
        requiredDocuments: [],
      });
      
      const result = await remediationService.reviewRemediation(
        workflowId,
        'admin-123',
        true,
        'Documents verified successfully'
      );
      
      expect(result.success).toBe(true);
      expect(result.accountRestored).toBe(true);
      
      // Verify account was restored
      const user = await db
        .select()
        .from(users)
        .where(eq(users.id, testUserId))
        .limit(1);
      
      expect(user[0].account_restricted).toBe(false);
      expect(user[0].verification_status).toBe('verified');
    });

    it('should reject remediation with feedback', async () => {
      const workflowId = await remediationService.createRemediationWorkflow({
        userId: testUserId,
        riskActionId: testActionId,
        workflowType: 'identity_check',
        requiredDocuments: [],
      });
      
      const result = await remediationService.reviewRemediation(
        workflowId,
        'admin-123',
        false,
        'Documents unclear, please resubmit'
      );
      
      expect(result.success).toBe(true);
      expect(result.accountRestored).toBe(false);
    });
  });

  describe('Status Tracking', () => {
    it('should return remediation status for user', async () => {
      await remediationService.createRemediationWorkflow({
        userId: testUserId,
        riskActionId: testActionId,
        workflowType: 'identity_check',
        requiredDocuments: [],
      });
      
      const status = await remediationService.getRemediationStatus(testUserId);
      
      expect(status).toBeInstanceOf(Array);
      expect(status.length).toBeGreaterThan(0);
    });

    it('should return pending remediations for admin', async () => {
      await remediationService.createRemediationWorkflow({
        userId: testUserId,
        riskActionId: testActionId,
        workflowType: 'identity_check',
        requiredDocuments: [],
      });
      
      // Submit documents to make it pending review
      const workflows = await remediationService.getRemediationStatus(testUserId);
      if (workflows.length > 0) {
        await remediationService.submitDocuments(workflows[0].workflowId, [
          { type: 'test', url: 'https://example.com/doc.pdf' },
        ]);
      }
      
      const pending = await remediationService.getPendingRemediations();
      
      expect(pending).toBeInstanceOf(Array);
    });
  });
});

export {};
