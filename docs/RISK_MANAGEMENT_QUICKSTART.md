# Risk Management System - Quick Start Guide

## Overview

The Risk Management System provides comprehensive tools to mitigate negative balance liability and ensure platform compliance with payment processor requirements (Stripe Connect).

## Key Components

### 1. Risk Assessment Engine
Automatically scores users on a 0-100 scale based on:
- Transaction patterns
- Account verification status
- Business category
- Historical behavior

### 2. Platform Reserves
Automatically holds reserves to cover potential losses based on user risk levels.

### 3. Compliance Monitoring
Checks users against restricted business categories and blocks prohibited activities.

### 4. Remediation Workflows
Guides users through verification processes to restore account functionality.

## Quick Setup

### 1. Run Database Migrations

The new schema includes these tables:
```sql
-- Extended users table with risk fields
-- restricted_business_categories
-- risk_assessments
-- risk_actions
-- platform_reserves
-- risk_communications
-- remediation_workflows
-- transaction_patterns
```

### 2. Seed Restricted Categories

```bash
cd services/api
npx tsx src/db/seed-restricted-categories.ts
```

This populates the database with:
- **Prohibited Categories**: Gambling, adult content, weapons, illegal drugs, counterfeit goods, money laundering
- **High-Risk Categories**: Cryptocurrency, forex trading, MLM, debt collection, financial services
- **Medium-Risk Categories**: Subscriptions, digital goods, consulting, health/wellness
- **Low-Risk Categories**: General services, creative services, technology, education, home services

### 3. Integrate with Wallet Service

The system automatically monitors all wallet transactions. To integrate:

```typescript
import { walletRiskIntegration } from './services/wallet-risk-integration';

// Before creating a transaction
const validation = await walletRiskIntegration.validateTransactionAllowed(
  userId,
  'escrow',
  amountCents
);

if (!validation.allowed) {
  throw new Error(validation.reason);
}

// After creating a transaction
await walletRiskIntegration.monitorTransaction(transactionId);
```

## Usage Examples

### Assess User Risk

```typescript
import { riskManagementService } from './services/risk-management-service';

const assessment = await riskManagementService.assessUserRisk(userId);

console.log(`Risk Level: ${assessment.riskLevel}`);
console.log(`Risk Score: ${assessment.riskScore}`);
console.log(`Recommended Actions:`, assessment.recommendedActions);
```

### Check Business Category

```typescript
const check = await riskManagementService.checkBusinessCategoryCompliance('cryptocurrency');

if (!check.allowed) {
  console.log(`Category prohibited: ${check.reason}`);
} else {
  console.log(`Category allowed. Risk level: ${check.riskLevel}`);
}
```

### Take Risk Action

```typescript
// Automatically restrict high-risk user
await riskManagementService.takeRiskAction(
  userId,
  'delay_payout',
  'High transaction velocity detected',
  'high',
  true, // automated
  'velocity_monitor'
);
```

### Create Remediation Workflow

```typescript
import { remediationService } from './services/remediation-service';

const workflowId = await remediationService.createRemediationWorkflow({
  userId,
  riskActionId,
  workflowType: 'identity_check',
  requiredDocuments: [
    {
      documentType: 'government_id',
      required: true,
      description: 'Government-issued photo ID'
    }
  ]
});
```

## Automated Workflows

### Transaction Monitoring

The system automatically:
1. Monitors every wallet transaction
2. Detects high-velocity patterns (>10/day)
3. Flags unusual amounts
4. Tracks refund rates
5. Triggers actions for critical risk

### Periodic Assessments

Risk assessments run:
- Every 50 transactions per user
- When requested via API
- When triggered by patterns
- During onboarding

### Reserve Calculation

Reserves are automatically:
- Calculated based on risk level
- Applied to transaction volume
- Released after 90 days (default)
- Adjusted as risk changes

## API Endpoints

### Risk Assessment
```bash
# Assess a user's risk
POST /api/risk/assess/:userId
Body: { "assessmentType": "periodic" }

# Get platform liability
GET /api/risk/liability
```

### Risk Actions
```bash
# Take a risk action
POST /api/risk/action
Body: {
  "userId": "user-123",
  "actionType": "delay_payout",
  "reason": "High velocity",
  "severity": "high"
}

# Establish reserve
POST /api/risk/reserve
Body: {
  "userId": "user-123",
  "reserveType": "rolling",
  "amountCents": 10000,
  "percentage": 10,
  "reason": "High risk level"
}
```

### Compliance
```bash
# Check business category
POST /api/risk/check-category
Body: { "businessCategory": "cryptocurrency" }

# Get all restricted categories
GET /api/risk/restricted-categories
```

### Remediation
```bash
# Get user's remediation status
GET /api/risk/remediation/user/:userId

# Submit documents
POST /api/risk/remediation/:workflowId/submit
Body: {
  "documents": [
    { "type": "government_id", "url": "https://..." }
  ]
}

# Review submission (admin)
POST /api/risk/remediation/:workflowId/review
Body: {
  "approved": true,
  "reviewNotes": "Documents verified",
  "reviewedBy": "admin-123"
}
```

## Monitoring & Alerts

### Key Metrics to Monitor

1. **Total Platform Liability**
   - Sum of all active escrows
   - Sum of all in-progress bounties

2. **Total Reserves**
   - Sum of all active reserves
   - Should cover most of liability

3. **Net Exposure**
   - Liability minus Reserves
   - Target: Close to zero

4. **Risk Distribution**
```sql
SELECT risk_level, COUNT(*) 
FROM users 
GROUP BY risk_level;
```

5. **Active Risk Actions**
```sql
SELECT action_type, COUNT(*) 
FROM risk_actions 
WHERE status = 'active' 
GROUP BY action_type;
```

6. **Pending Remediations**
```sql
SELECT COUNT(*) 
FROM remediation_workflows 
WHERE status = 'in_progress';
```

### Recommended Dashboards

Create dashboards for:
- Real-time liability vs reserves chart
- Risk level distribution pie chart
- Recent risk actions timeline
- Pending remediation queue
- Business category breakdown

## Best Practices

### For Platform Operators

1. **Monitor Daily**
   - Check total liability vs reserves
   - Review high-risk users
   - Clear remediation queue

2. **Weekly Review**
   - Run periodic assessments for active users
   - Review restricted category compliance
   - Adjust risk thresholds if needed

3. **Monthly Audit**
   - Review all risk actions taken
   - Analyze remediation success rates
   - Update restricted categories list
   - Review and adjust reserve percentages

4. **Communication**
   - Respond to user inquiries promptly
   - Provide clear remediation guidance
   - Update users on status changes

### For Integration

1. **Validate Before Transactions**
```typescript
const validation = await walletRiskIntegration.validateTransactionAllowed(
  userId,
  transactionType,
  amount
);
```

2. **Monitor After Transactions**
```typescript
await walletRiskIntegration.monitorTransaction(transactionId);
```

3. **Check Categories on Onboarding**
```typescript
const check = await riskManagementService.checkBusinessCategoryCompliance(
  userBusinessCategory
);
```

4. **Assess Risk Periodically**
```typescript
// Run weekly for active users
await riskManagementService.assessUserRisk(userId, 'periodic');
```

## Troubleshooting

### User Cannot Make Transactions

1. Check if account is restricted:
```sql
SELECT account_restricted, restriction_reason 
FROM users 
WHERE id = 'user-id';
```

2. Check active risk actions:
```sql
SELECT * FROM risk_actions 
WHERE user_id = 'user-id' AND status = 'active';
```

3. Check remediation workflows:
```sql
SELECT * FROM remediation_workflows 
WHERE user_id = 'user-id' AND status != 'completed';
```

### High Platform Liability

1. Calculate total liability:
```typescript
const liability = await riskManagementService.calculateTotalLiability();
console.log('Net Exposure:', liability.netExposure);
```

2. Increase reserves for high-risk users:
```typescript
// For each high-risk user
await riskManagementService.establishReserve(
  userId,
  'rolling',
  recommendedAmount,
  20, // 20% for high risk
  'Increased reserve due to high risk',
  90
);
```

### False Positive Risk Flags

1. Review the risk assessment:
```sql
SELECT * FROM risk_assessments 
WHERE user_id = 'user-id' 
ORDER BY created_at DESC 
LIMIT 1;
```

2. Manually resolve if appropriate:
```sql
UPDATE risk_actions 
SET status = 'resolved', 
    resolved_by = 'admin-id',
    resolution_notes = 'Reviewed - false positive'
WHERE id = 'action-id';
```

3. Update user verification:
```sql
UPDATE users 
SET verification_status = 'verified',
    kyc_verified_at = NOW(),
    account_restricted = false
WHERE id = 'user-id';
```

## Support

For detailed documentation, see:
- [RISK_MANAGEMENT_GUIDE.md](./RISK_MANAGEMENT_GUIDE.md) - Complete system documentation
- API Routes: `/services/api/src/routes/risk-management.ts`
- Services: `/services/api/src/services/risk-management-service.ts`
- Database Schema: `/services/api/src/db/schema.ts`

## Testing

Run the test suite:
```bash
cd services/api
npm test -- __tests__/risk-management.test.ts
```

Tests cover:
- Risk assessment algorithm
- Business category compliance
- Risk action workflows
- Reserve calculations
- Remediation processes
