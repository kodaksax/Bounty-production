# Security Audit - Quick Reference for Developers

## 🚨 STOP! Read This First

### DO NOT COMMIT:
- ❌ `.env` files
- ❌ API keys, passwords, secrets
- ❌ Private keys or certificates
- ❌ Database credentials
- ❌ Any file with `password`, `secret`, `key` in content

### BEFORE YOU COMMIT:
```bash
# Check for secrets
git diff --cached | grep -i "password\|secret\|key\|token"

# Install pre-commit hook to prevent accidents
npm install --save-dev @commitlint/cli husky
npx husky add .husky/pre-commit "npm run check-secrets"
```

---

## 🔥 Critical Issues - FIX IMMEDIATELY

### Issue #1: SQL Injection
**DO NOT DO THIS:**
```javascript
// ❌ VULNERABLE
.update({ balance: supabase.raw(`balance - ${amount}`) })
```

**DO THIS INSTEAD:**
```javascript
// ✅ SAFE
await supabase.rpc('decrement_balance', {
  p_user_id: userId,
  p_amount: amount
});
```

### Issue #2: HTTPS Not Enforced
**ADD THIS TO server/index.js:**
```javascript
// Add before other middleware
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (!req.secure && req.get('x-forwarded-proto') !== 'https') {
      return res.redirect(301, `https://${req.get('host')}${req.url}`);
    }
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
}
```

### Issue #3: Weak Rate Limiting
**UPDATE RATE LIMITS:**
```javascript
// ❌ Current (too permissive)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});

// ✅ Better (differentiated by endpoint)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,  // Only 5 login attempts per 15 min
  skipSuccessfulRequests: true
});

const paymentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max: 3  // Only 3 payment intents per hour
});

// Apply to endpoints
app.post('/auth/sign-in', authLimiter, ...);
app.post('/payments/create-payment-intent', paymentLimiter, ...);
```

---

## 🔐 Secure Coding Checklist

### For Every New Feature:

#### 1. **Input Validation**
```javascript
// ✅ Always validate and sanitize
function validatePaymentAmount(amount) {
  const num = parseFloat(amount);
  if (isNaN(num) || num <= 0) {
    throw new ValidationError('Invalid amount');
  }
  if (num > 1000000) {  // $10,000 max
    throw new ValidationError('Amount exceeds maximum');
  }
  return Math.round(num * 100);  // Convert to cents
}
```

#### 2. **Authentication**
```javascript
// ✅ Always verify user owns resource
async function deletePaymentMethod(req, res) {
  const { userId } = req.user;  // From auth middleware
  const { methodId } = req.params;
  
  // Verify ownership
  const method = await stripe.paymentMethods.retrieve(methodId);
  if (method.customer !== user.stripe_customer_id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  // Now safe to delete
  await stripe.paymentMethods.detach(methodId);
}
```

#### 3. **Authorization**
```javascript
// ✅ Check permissions before actions
if (!req.user.isAdmin && resourceOwnerId !== req.user.id) {
  return res.status(403).json({ error: 'Insufficient permissions' });
}
```

#### 4. **Error Handling**
```javascript
// ❌ Don't expose internals
res.status(500).json({ error: error.stack });

// ✅ Sanitize errors
const message = process.env.NODE_ENV === 'production' 
  ? 'An error occurred'
  : error.message;
res.status(500).json({ error: message });
```

#### 5. **Logging**
```javascript
// ❌ Don't log sensitive data
console.log('User login:', { email, password });

// ✅ Log safely
console.log('User login attempt:', { 
  email, 
  timestamp: new Date(),
  ip: req.ip 
});
```

---

## 🛡️ Security Headers

**Add to all responses:**
```javascript
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', 
    "default-src 'self'; script-src 'self' https://js.stripe.com; " +
    "style-src 'self' 'unsafe-inline'; img-src 'self' data: https:;"
  );
  next();
});
```

---

## 🔑 Environment Variables

### Naming Convention:
```bash
# ✅ For frontend (bundled, public)
EXPO_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJxxx...

# ✅ For backend only (NEVER in frontend)
STRIPE_SECRET_KEY=sk_live_xxx
SUPABASE_SERVICE_ROLE_KEY=eyJxxx...
DATABASE_PASSWORD=xxx
```

### Loading Secrets:
```javascript
// ❌ Don't do this
const apiKey = "sk_live_12345hardcoded";

// ✅ Do this
const apiKey = process.env.STRIPE_SECRET_KEY;
if (!apiKey) {
  throw new Error('STRIPE_SECRET_KEY not configured');
}
```

---

## 💳 Payment Security

### Always:
1. ✅ Validate amounts (min/max)
2. ✅ Verify ownership before actions
3. ✅ Use Stripe's libraries (never build your own)
4. ✅ Log all transactions
5. ✅ Verify webhook signatures

### Example:
```javascript
app.post('/payments/create-payment-intent', async (req, res) => {
  const { amountCents, bountyId } = req.body;
  
  // 1. Validate amount
  if (amountCents < 50 || amountCents > 1000000) {
    return res.status(400).json({ error: 'Invalid amount' });
  }
  
  // 2. Verify bounty exists and amount matches
  const { data: bounty } = await supabase
    .from('bounties')
    .select('reward_amount, poster_id')
    .eq('id', bountyId)
    .single();
  
  if (!bounty || bounty.poster_id !== req.user.id) {
    return res.status(404).json({ error: 'Bounty not found' });
  }
  
  const expectedAmount = Math.round(bounty.reward_amount * 100);
  if (expectedAmount !== amountCents) {
    return res.status(400).json({ error: 'Amount mismatch' });
  }
  
  // 3. Create payment intent
  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: 'usd',
    metadata: {
      user_id: req.user.id,
      bounty_id: bountyId
    }
  });
  
  // 4. Log transaction
  await auditLog(req.user.id, 'create_payment_intent', 'payment', {
    paymentIntentId: paymentIntent.id,
    amount: amountCents
  });
  
  res.json({ clientSecret: paymentIntent.client_secret });
});
```

---

## 🧪 Testing Security

### Before Every PR:
```bash
# 1. Check for secrets
npm run check-secrets

# 2. Run security tests
npm run test:security

# 3. Check dependencies
npm audit

# 4. Lint for security issues
npm run lint:security
```

### Manual Tests:
```bash
# Test rate limiting
for i in {1..20}; do curl http://localhost:3001/health & done

# Test CORS
curl -H "Origin: http://evil.com" http://localhost:3001/payments/methods

# Test authentication
curl http://localhost:3001/payments/methods
# Should return 401

# Test SQL injection
curl -X POST http://localhost:3001/payments/create-payment-intent \
  -H "Content-Type: application/json" \
  -d '{"amountCents":"100; DROP TABLE users--"}'
```

---

## 🚫 Common Mistakes

### 1. **Trusting User Input**
```javascript
// ❌ NEVER trust user input
const userId = req.body.userId;  // Attacker can impersonate anyone!

// ✅ Use authenticated user
const userId = req.user.id;  // From verified JWT
```

### 2. **Not Verifying Ownership**
```javascript
// ❌ Anyone can delete any payment method
app.delete('/payment-methods/:id', async (req, res) => {
  await stripe.paymentMethods.detach(req.params.id);
});

// ✅ Verify ownership first
app.delete('/payment-methods/:id', async (req, res) => {
  const method = await stripe.paymentMethods.retrieve(req.params.id);
  if (method.customer !== req.user.stripe_customer_id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  await stripe.paymentMethods.detach(req.params.id);
});
```

### 3. **Inadequate Error Handling**
```javascript
// ❌ Exposes internal structure
catch (error) {
  res.status(500).json({ error: error.stack });
}

// ✅ Safe error handling
catch (error) {
  console.error('[Payment] Error:', error);  // Log internally
  res.status(500).json({ 
    error: 'Payment processing failed',
    code: 'PAYMENT_ERROR'
  });
}
```

### 4. **Missing Input Validation**
```javascript
// ❌ No validation
const amount = req.body.amount;
await createPayment(amount);

// ✅ Validate everything
const amount = parseInt(req.body.amount);
if (isNaN(amount) || amount < 50 || amount > 1000000) {
  return res.status(400).json({ error: 'Invalid amount' });
}
```

---

## 📚 Required Reading

1. **OWASP Top 10:** https://owasp.org/www-project-top-ten/
2. **Stripe Security Guide:** https://stripe.com/docs/security/guide
3. **Supabase Security:** https://supabase.com/docs/guides/platform/going-into-prod
4. **Full Audit Report:** `SECURITY_AUDIT_REPORT.md`

---

## 🆘 When In Doubt

### Ask yourself:
1. Could an attacker modify this input?
2. Am I verifying the user owns this resource?
3. Am I logging this action for audit?
4. Could this expose sensitive information?
5. Is this validated on the server-side?

### If you're unsure:
- 💬 Ask in #security channel
- 👀 Request security review
- 📖 Check the audit report
- 🧪 Write a security test

---

## ⚡ Quick Commands

```bash
# Check for hardcoded secrets
git grep -i "password\|secret\|key" | grep -v ".md"

# Run security audit
npm audit

# Check for vulnerable dependencies
npm audit --audit-level=high

# Run tests
npm test

# Pre-commit check
git diff --cached | grep -E "(password|secret|key|token)" && echo "⚠️  Potential secret detected!"
```

---

## 📞 Security Contacts

**Found a security issue?**
1. 🔴 Critical: Immediately notify security team
2. 🟡 Non-critical: Create a security ticket
3. ❓ Question: Ask in #security channel

**Never:**
- ❌ Commit fixes for critical issues without review
- ❌ Discuss vulnerabilities in public channels
- ❌ Push credentials "temporarily" for testing

---

**Remember:** Security is everyone's responsibility! 🔐

**Last Updated:** February 4, 2026  
**Version:** 1.0
