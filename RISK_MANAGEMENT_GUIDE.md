# Risk Management & Negative Balance Liability System

## Overview

This system implements comprehensive risk management to address Stripe's platform liability requirements for negative account balances. It covers onboarding compliance, risk monitoring, fraud detection, seller communication, and remediation workflows.

## Key Responsibilities

### 1. Liability for Seller Losses
- **Platform Reserves**: Automatic calculation and holding of reserves based on user risk levels
- **Reserve Types**: Rolling, fixed, and transaction-based reserves
- **Coverage**: Reserves held to cover total value of negative account balances
- **Monitoring**: Real-time tracking of total platform liability and net exposure

### 2. Onboarding and Compliance
- **Business Category Verification**: Check sellers against restricted business categories
- **KYC/Verification**: Track verification status for all users
- **Prohibited Categories**: Automatically block users in prohibited business categories
- **Risk-Based Onboarding**: Higher verification requirements for high-risk categories

### 3. Risk Underwriting
- **Risk Scoring**: Automated 0-100 risk score based on multiple factors:
  - Transaction velocity (high frequency detection)
  - Transaction amounts (unusual amount detection)
  - Account age (newer accounts = higher risk)
  - Verification status
  - Chargeback/refund history
  - Business category risk level
  - Geographic patterns
- **Risk Levels**: Low, Medium, High, Critical
- **Financial Health Assessment**: Ongoing monitoring of seller transaction patterns

### 4. Risk Monitoring and Detection
- **Transaction Pattern Detection**:
  - High velocity transactions (>10/day or >50/week triggers review)
  - Unusual transaction amounts
  - Refund patterns (>20% refund rate)
  - Geographic anomalies
- **Automated Monitoring**: Continuous background monitoring of all transactions
- **Fraud Indicators**: Automatic flagging of suspicious patterns
- **Threshold Triggers**: Automatic actions when risk thresholds exceeded

### 5. Risk Actions to Mitigate Losses
- **Action Types**:
  - Account holds
  - Account restrictions
  - Payout delays (24h, 72h)
  - Suspension
  - Require additional verification
  - Increase reserves
  - Flag for manual review
- **Automated Actions**: System can automatically take actions based on risk triggers
- **Manual Actions**: Admins can manually impose risk actions
- **Action Tracking**: Complete audit trail of all risk actions taken

### 6. Seller Communication
- **Notification Templates**: Pre-built templates for different action types
- **Multi-Channel Communication**: In-app, email, SMS, push notifications
- **Audit Trail**: Complete log of all risk-related communications
- **Status Tracking**: Delivery, read receipts, and response tracking
- **Clear Messaging**: Explains reason for action and steps to resolve

### 7. Seller Remediation
- **Workflow Types**:
  - Document verification
  - Identity verification (KYC)
  - Business verification
  - Transaction review
- **Document Collection**: Structured collection of required verification documents
- **Review Process**: Admin workflow for reviewing submitted documents
- **Status Restoration**: Automatic account restoration upon approval
- **Rejection Handling**: Clear feedback and re-submission process

### 8. Support for Payment and Risk Inquiries
- **Comprehensive Documentation**: Clear explanations of risk policies
- **User Education**: Guides on maintaining account health
- **Support Integration**: Risk communications include support contact options
- **Remediation Guidance**: Step-by-step instructions for resolving issues

## Database Schema

### Core Tables

#### `users` (extended)
```sql
verification_status: pending | verified | rejected | under_review
kyc_verified_at: timestamp
business_category: text
risk_level: low | medium | high | critical
risk_score: integer (0-100)
account_restricted: boolean
restriction_reason: text
restricted_at: timestamp
```

#### `restricted_business_categories`
Defines prohibited and high-risk business types:
- Gambling
- Adult content
- Weapons
- Cryptocurrencies (high risk)
- etc.

#### `risk_assessments`
Complete history of all risk assessments performed on users.

#### `risk_actions`
All mitigation actions taken (holds, restrictions, suspensions, etc.)

#### `platform_reserves`
Tracks all reserves held to cover negative balance liability.

#### `risk_communications`
Audit trail of all risk-related communications with users.

#### `remediation_workflows`
Tracks document verification and account restoration workflows.

#### `transaction_patterns`
Records detected fraud/risk patterns in transaction behavior.

## API Endpoints

### Risk Assessment
- `POST /api/risk/assess/:userId` - Perform risk assessment on a user
- `GET /api/risk/liability` - Get total platform liability and reserves

### Risk Actions
- `POST /api/risk/action` - Take a risk action (hold, restrict, etc.)
- `POST /api/risk/reserve` - Establish a reserve for a user

### Compliance
- `POST /api/risk/check-category` - Check if business category is allowed
- `GET /api/risk/restricted-categories` - Get list of restricted categories
- `POST /api/risk/restricted-categories` - Add new restricted category (admin)

### Remediation
- `POST /api/risk/remediation/create` - Create remediation workflow
- `POST /api/risk/remediation/:workflowId/submit` - Submit documents
- `POST /api/risk/remediation/:workflowId/review` - Review submission (admin)
- `GET /api/risk/remediation/user/:userId` - Get user's remediation status
- `GET /api/risk/remediation/pending` - Get pending remediations (admin)

## Risk Scoring Algorithm

The system uses a weighted risk scoring algorithm:

```typescript
Risk Score = 
  transactionVelocity * 0.15 +
  transactionAmount * 0.15 +
  accountAge * 0.10 +
  verificationStatus * 0.20 +
  chargebackHistory * 0.15 +
  refundPattern * 0.10 +
  businessCategory * 0.10 +
  geographicRisk * 0.05
```

### Risk Thresholds
- **Low Risk**: 0-29 → 5% reserve
- **Medium Risk**: 30-59 → 10% reserve
- **High Risk**: 60-84 → 20% reserve
- **Critical Risk**: 85-100 → 30% reserve + immediate review

## Automated Risk Workflows

### High Velocity Detection
When a user exceeds 10 transactions/day or 50/week:
1. System flags transaction pattern
2. Creates risk action (delay payout)
3. Sends notification to user
4. If critical (>85 score), auto-creates remediation workflow

### Business Category Compliance
When user registers or updates business category:
1. Check against restricted categories table
2. If prohibited → reject immediately
3. If high risk → increase monitoring, require enhanced verification
4. If medium/low → standard onboarding

### Chargeback Detection
When chargeback/refund rate exceeds thresholds:
1. Flag refund pattern
2. If >30% refund rate → delay payouts 72h
3. If >50% refund rate → suspend account, require review

## Reserve Management

### Reserve Calculation
```typescript
reserve_amount = transaction_volume * reserve_percentage

where reserve_percentage is based on risk level:
- Low: 5%
- Medium: 10%
- High: 20%
- Critical: 30%
```

### Reserve Release
- Default release period: 90 days
- Early release upon account health improvement
- Manual review for high-value reserves

## Integration Points

### With Stripe Connect Service
- Verify payment capability before allowing transactions
- Check account verification status in risk assessment
- Use Stripe account age in risk scoring

### With Wallet Service
- Monitor transaction patterns in real-time
- Calculate reserves based on transaction volume
- Track negative balances and exposure

### With Notification Service
- Send risk action notifications
- Deliver remediation requirements
- Confirm document submissions and reviews

## Usage Examples

### 1. Assess User Risk (Periodic Check)
```typescript
const result = await riskManagementService.assessUserRisk(userId, 'periodic');

// Returns:
{
  userId: "user-123",
  riskScore: 65,
  riskLevel: "high",
  factors: {
    transactionVelocity: 75,
    transactionAmount: 60,
    accountAge: 80, // New account
    verificationStatus: 70, // Not verified
    // ...
  },
  recommendedActions: [
    "delay_payouts_72h",
    "require_additional_verification",
    "increase_reserve"
  ],
  requiresReserve: true,
  reservePercentage: 20
}
```

### 2. Take Automated Risk Action
```typescript
await riskManagementService.takeRiskAction(
  userId,
  'delay_payout',
  'High transaction velocity detected',
  'high',
  true, // automated
  'high_velocity_monitor'
);
```

### 3. Create Remediation Workflow
```typescript
await remediationService.createRemediationWorkflow({
  userId,
  riskActionId,
  workflowType: 'identity_check',
  requiredDocuments: [
    {
      documentType: 'government_id',
      required: true,
      description: 'Government-issued photo ID'
    },
    {
      documentType: 'selfie',
      required: true,
      description: 'Selfie holding ID'
    }
  ]
});
```

### 4. Check Business Category Compliance
```typescript
const result = await riskManagementService.checkBusinessCategoryCompliance('gambling');

// Returns:
{
  allowed: false,
  reason: "Business category 'Gambling' is prohibited on this platform",
  riskLevel: "prohibited"
}
```

## Monitoring & Reporting

### Key Metrics to Monitor
1. **Total Platform Liability**: Sum of all active escrows and in-progress bounties
2. **Total Reserves**: Sum of all active reserves
3. **Net Exposure**: Liability - Reserves (should be close to zero)
4. **Risk Distribution**: Count of users by risk level
5. **Action Metrics**: Number of actions by type and severity
6. **Remediation Success Rate**: % of workflows successfully completed

### Dashboard Queries
```sql
-- Total liability vs reserves
SELECT 
  SUM(amount_cents) as total_liability 
FROM platform_reserves 
WHERE status = 'active';

-- Users by risk level
SELECT 
  risk_level, 
  COUNT(*) as count 
FROM users 
GROUP BY risk_level;

-- Pending remediations
SELECT COUNT(*) 
FROM remediation_workflows 
WHERE status = 'in_progress';
```

## Best Practices

### For Platform Operators
1. **Regular Risk Assessments**: Run periodic assessments weekly for all active users
2. **Monitor Liability**: Check total liability vs reserves daily
3. **Review Patterns**: Manually review flagged transaction patterns
4. **Update Categories**: Keep restricted business categories list current
5. **Train Support**: Ensure support team understands risk policies
6. **Document Decisions**: Add notes to all manual risk actions

### For Sellers
1. **Complete Verification Early**: Submit verification documents promptly
2. **Maintain Transaction History**: Keep healthy transaction patterns
3. **Respond to Requests**: Address remediation requests quickly
4. **Avoid Prohibited Categories**: Don't operate in restricted business types
5. **Contact Support**: Reach out if unsure about requirements

## Compliance & Legal

This system helps meet Stripe's requirements for platforms operating with seller funds:
- ✅ Liability coverage through reserves
- ✅ Compliance checks for restricted businesses
- ✅ Risk assessment and underwriting
- ✅ Continuous monitoring and detection
- ✅ Mitigation actions with discretion
- ✅ Clear seller communication
- ✅ Remediation pathways
- ✅ Support for inquiries

## Testing

See `/services/api/src/__tests__/risk-management.test.ts` for comprehensive test coverage of:
- Risk scoring algorithm
- Automated action triggers
- Reserve calculations
- Remediation workflows
- Business category compliance

## Future Enhancements

1. **Machine Learning**: Improve risk scoring with ML models
2. **External Data**: Integrate with third-party fraud detection services
3. **Geographic Risk**: Add location-based risk factors
4. **Behavioral Analysis**: Track user behavior patterns over time
5. **Predictive Analytics**: Predict future risk based on trends
6. **Appeals Process**: Allow sellers to appeal risk actions
7. **Risk Insurance**: Partner with insurance providers for additional coverage
