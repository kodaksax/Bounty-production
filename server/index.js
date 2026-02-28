const path = require('path');
// Always load the server/.env file relative to this script so env vars are
// available even when starting the process from the project root.
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');
const rateLimit = require('express-rate-limit');
const validator = require('validator');

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize Supabase client with service role key (bypasses RLS)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// Rate limiting configuration
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit payment requests
  message: 'Too many payment requests, please try again later.',
});

// Input sanitization helpers
function sanitizeText(input) {
  if (!input) return '';
  // Remove HTML tags and escape dangerous characters
  let sanitized = validator.stripLow(String(input));
  sanitized = validator.escape(sanitized);
  return sanitized.trim();
}

function sanitizeNumber(input, allowNegative = false) {
  if (input === null || input === undefined) {
    throw new Error('Number is required');
  }

  // Convert to number first
  const num = Number(input);

  // Check if valid number
  if (isNaN(num) || !isFinite(num)) {
    throw new Error('Invalid numeric format');
  }

  // Validate format - allow decimals, optionally allow negative
  const str = String(input).trim();
  const pattern = allowNegative ? /^-?\d+(\.\d+)?$/ : /^\d+(\.\d+)?$/;
  if (!pattern.test(str)) {
    throw new Error('Invalid numeric format');
  }

  return num;
}

function sanitizeNonNegativeNumber(input) {
  const num = sanitizeNumber(input, false);
  if (num < 0) {
    throw new Error('Number must be non-negative');
  }
  return num;
}

function sanitizePositiveNumber(input) {
  const num = sanitizeNumber(input, false);
  if (num <= 0) {
    throw new Error('Number must be positive');
  }
  return num;
}

// Logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// HTTPS enforcement middleware for production
// CWE-319 Fix: Enforce encrypted connections in production
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    // Check if request is secure
    const isSecure = req.secure ||
      req.headers['x-forwarded-proto'] === 'https' ||
      req.headers['x-forwarded-ssl'] === 'on';

    if (!isSecure) {
      console.error(`[SECURITY] Rejected insecure HTTP request from ${req.ip} to ${req.path}`);
      return res.status(403).json({
        error: 'HTTPS required',
        message: 'All requests must use HTTPS in production. Please use https:// instead of http://',
        code: 'INSECURE_CONNECTION'
      });
    }

    // Add HSTS header to enforce HTTPS on client side
    // max-age=31536000 (1 year), includeSubDomains, preload
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');

    // Add Content Security Policy
    // Allow scripts from self and Stripe
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://js.stripe.com; frame-src https://js.stripe.com; img-src 'self' data:;");

    // Add additional security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
  }
  next();
});

// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:8081', 'http://localhost:19000', 'http://localhost:19006'];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);

    if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// Body parser middleware - JSON for most endpoints
app.use(bodyParser.json());

// Authentication middleware - validates Supabase auth token
async function authenticateUser(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    const token = authHeader.substring(7);
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      console.error('[Auth] Invalid token:', error?.message);
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('[Auth] Error:', error);
    return res.status(500).json({ error: 'Authentication failed' });
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    stripeConfigured: !!process.env.STRIPE_SECRET_KEY,
    supabaseConfigured: !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY
  });
});

// DELETE /auth/delete-account
// Fully deletes an authenticated user and related application data.
// Requires a valid Supabase auth bearer token. Uses service role key for admin deletion.
app.delete('/auth/delete-account', authenticateUser, async (req, res) => {
  const userId = req.user.id;
  console.log(`[AccountDeletionAPI] Received deletion request for user ${userId}`);
  try {
    // Step 1: Nullify conversations.created_by to avoid FK restriction if it exists
    try {
      const { error: convErr } = await supabase
        .from('conversations')
        .update({ created_by: null })
        .eq('created_by', userId);
      if (convErr) {
        console.warn('[AccountDeletionAPI] conversations pre-cleanup error (continuing):', convErr.message);
      }
    } catch (e) {
      console.warn('[AccountDeletionAPI] conversations pre-cleanup threw (continuing):', e.message);
    }

    // Step 2: Delete auth user via admin API (cascades if DB FK set up)
    let adminDeleted = false;
    try {
      if (supabase.auth?.admin?.deleteUser) {
        const { error: adminError } = await supabase.auth.admin.deleteUser(userId);
        if (adminError) {
          console.warn('[AccountDeletionAPI] admin.deleteUser failed, will fallback:', adminError.message);
        } else {
          adminDeleted = true;
        }
      }
    } catch (e) {
      console.warn('[AccountDeletionAPI] admin.deleteUser threw, will fallback:', e.message);
    }

    // Step 3: Fallback manual profile deletion if still present
    if (!adminDeleted) {
      const { error: profileErr } = await supabase
        .from('profiles')
        .delete()
        .eq('id', userId);
      if (profileErr) {
        console.error('[AccountDeletionAPI] Manual profile deletion failed:', profileErr.message);
        return res.status(500).json({ success: false, message: `Failed to delete account: ${profileErr.message}` });
      }
    }

    console.log(`[AccountDeletionAPI] Deletion flow complete for user ${userId}`);
    return res.json({ success: true, message: 'Account deletion completed successfully.' });
  } catch (e) {
    console.error('[AccountDeletionAPI] Unexpected error:', e);
    return res.status(500).json({ success: false, message: e.message || 'Unexpected error deleting account.' });
  }
});

// Unauthenticated debug endpoint for device reachability
// Returns server listen address, remote request info and a small echo for quick device tests
app.get('/debug', (req, res) => {
  try {
    const addr = server && typeof server.address === 'function' ? server.address() : null;
    const host = (addr && addr.address) || null;
    const port = (addr && addr.port) || PORT;
    res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      serverListening: !!addr,
      host: host,
      port: port,
      requesterIp: req.headers['x-forwarded-for'] || req.connection?.remoteAddress || req.ip,
      headersSnippet: Object.keys(req.headers).slice(0, 10)
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /payments/create-payment-intent
// Creates a PaymentIntent for the specified amount
app.post('/payments/create-payment-intent', paymentLimiter, authenticateUser, async (req, res) => {
  try {
    const { amountCents, currency = 'usd', metadata = {} } = req.body;
    const userId = req.user.id;

    // Sanitize and validate amount (must be positive)
    let validatedAmount;
    try {
      validatedAmount = sanitizePositiveNumber(amountCents);
      if (validatedAmount <= 0) {
        throw new Error('Amount must be positive');
      }
    } catch (error) {
      return res.status(400).json({
        error: 'Invalid amount. Must be a positive number in cents.'
      });
    }

    // Sanitize currency
    const validatedCurrency = sanitizeText(currency).toLowerCase();
    if (!['usd', 'eur', 'gbp'].includes(validatedCurrency)) {
      return res.status(400).json({
        error: 'Invalid currency. Supported: usd, eur, gbp.'
      });
    }

    // Get or create Stripe customer for user
    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_customer_id, email')
      .eq('id', userId)
      .single();

    let customerId = profile?.stripe_customer_id;

    // Create Stripe customer if doesn't exist
    if (!customerId && profile?.email) {
      const customer = await stripe.customers.create({
        email: profile.email,
        metadata: { user_id: userId }
      });
      customerId = customer.id;

      // Save customer ID to profile
      await supabase
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', userId);
    }

    // Sanitize metadata - only allow specific keys
    const sanitizedMetadata = {};
    if (metadata.bounty_id) {
      sanitizedMetadata.bounty_id = sanitizeText(metadata.bounty_id);
    }
    if (metadata.description) {
      sanitizedMetadata.description = sanitizeText(metadata.description);
    }

    // Create PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: validatedAmount,
      currency: validatedCurrency,
      customer: customerId,
      metadata: {
        user_id: userId,
        ...sanitizedMetadata
      },
      automatic_payment_methods: {
        enabled: true,
      },
    });

    console.log(`[PaymentIntent] Created: ${paymentIntent.id} for user ${userId}, amount ${amountCents} ${currency}`);

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id
    });

  } catch (error) {
    console.error('[PaymentIntent] Error:', error.message);
    res.status(500).json({
      error: error.message || 'Failed to create payment intent'
    });
  }
});

// Apple Pay endpoints (proxying functionality from Fastify service)
// These endpoints mirror the Fastify implementation under services/api so mobile
// clients can call /apple-pay/* on the same host.
app.post('/apple-pay/payment-intent', paymentLimiter, authenticateUser, async (req, res) => {
  try {
    const { amountCents, bountyId, description } = req.body || {};

    if (!req.user || !req.user.id) return res.status(401).json({ error: 'Unauthorized' });

    // Sanitize and validate amount (must be positive and >= 50 cents)
    let validatedAmount;
    try {
      validatedAmount = sanitizePositiveNumber(amountCents);
      if (validatedAmount < 50) {
        throw new Error('Amount too small');
      }
    } catch (error) {
      return res.status(400).json({ error: 'Amount must be at least $0.50' });
    }

    // Sanitize text inputs
    const sanitizedBountyId = bountyId ? sanitizeText(bountyId) : '';
    const sanitizedDescription = description ? sanitizeText(description) : 'BountyExpo Payment';

    const paymentIntent = await stripe.paymentIntents.create({
      amount: validatedAmount,
      currency: 'usd',
      payment_method_types: ['card'],
      metadata: {
        user_id: req.user.id,
        bounty_id: sanitizedBountyId,
        payment_method: 'apple_pay'
      },
      description: sanitizedDescription,
    });

    return res.json({ clientSecret: paymentIntent.client_secret, paymentIntentId: paymentIntent.id });
  } catch (error) {
    console.error('Error creating Apple Pay payment intent:', error);
    return res.status(500).json({ error: 'Failed to create payment intent' });
  }
});

app.post('/apple-pay/confirm', paymentLimiter, authenticateUser, async (req, res) => {
  try {
    const { paymentIntentId, bountyId } = req.body || {};

    if (!req.user || !req.user.id) return res.status(401).json({ error: 'Unauthorized' });

    if (!paymentIntentId) return res.status(400).json({ error: 'Missing paymentIntentId' });

    // Sanitize payment intent ID (alphanumeric from Stripe)
    const sanitizedPaymentIntentId = sanitizeText(paymentIntentId);

    const paymentIntent = await stripe.paymentIntents.retrieve(sanitizedPaymentIntentId);

    if (paymentIntent && paymentIntent.status === 'succeeded') {
      // Here you could record wallet txs or trigger webhooks — keep simple for parity
      return res.json({ success: true, status: paymentIntent.status, amount: paymentIntent.amount });
    }

    return res.json({ success: false, status: paymentIntent?.status, error: 'Payment not completed' });
  } catch (error) {
    console.error('Error confirming Apple Pay payment:', error);
    return res.status(500).json({ error: 'Failed to confirm payment' });
  }
});

// =============================================================================
// PAYMENT METHODS ENDPOINTS
// =============================================================================

// GET /payments/methods
// Retrieves all payment methods for the authenticated user
app.get('/payments/methods', apiLimiter, authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user's Stripe customer ID
    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', userId)
      .single();

    if (!profile?.stripe_customer_id) {
      return res.json({ paymentMethods: [] });
    }

    // Fetch payment methods from Stripe
    const paymentMethods = await stripe.paymentMethods.list({
      customer: profile.stripe_customer_id,
      type: 'card',
    });

    // Transform to client format
    const methods = paymentMethods.data.map(pm => ({
      id: pm.id,
      type: 'card',
      card: {
        brand: pm.card?.brand || 'unknown',
        last4: pm.card?.last4 || '****',
        exp_month: pm.card?.exp_month || 0,
        exp_year: pm.card?.exp_year || 0,
      },
      created: pm.created,
    }));

    console.log(`[PaymentMethods] Retrieved ${methods.length} methods for user ${userId}`);
    res.json({ paymentMethods: methods });

  } catch (error) {
    console.error('[PaymentMethods] Error fetching:', error.message);
    res.status(500).json({ error: 'Failed to fetch payment methods' });
  }
});

// POST /payments/methods
// Attaches a payment method to the user's Stripe customer
app.post('/payments/methods', paymentLimiter, authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const { paymentMethodId } = req.body;

    if (!paymentMethodId) {
      return res.status(400).json({ error: 'Payment method ID is required' });
    }

    // Get or create Stripe customer for user
    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_customer_id, email')
      .eq('id', userId)
      .single();

    let customerId = profile?.stripe_customer_id;

    if (!customerId && profile?.email) {
      const customer = await stripe.customers.create({
        email: profile.email,
        metadata: { user_id: userId }
      });
      customerId = customer.id;

      await supabase
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', userId);
    }

    if (!customerId) {
      return res.status(400).json({ error: 'Unable to create customer profile' });
    }

    // Attach payment method to customer
    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: customerId,
    });

    // Fetch the payment method details
    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);

    console.log(`[PaymentMethods] Attached ${paymentMethodId} to customer ${customerId}`);

    res.json({
      success: true,
      paymentMethod: {
        id: paymentMethod.id,
        type: 'card',
        card: {
          brand: paymentMethod.card?.brand || 'unknown',
          last4: paymentMethod.card?.last4 || '****',
          exp_month: paymentMethod.card?.exp_month || 0,
          exp_year: paymentMethod.card?.exp_year || 0,
        },
        created: paymentMethod.created,
      }
    });

  } catch (error) {
    console.error('[PaymentMethods] Error attaching:', error.message);

    // Handle specific Stripe errors
    if (error.type === 'StripeCardError') {
      return res.status(400).json({ error: error.message });
    }
    if (error.code === 'payment_method_not_found') {
      return res.status(404).json({ error: 'Payment method not found' });
    }

    res.status(500).json({ error: 'Failed to attach payment method' });
  }
});

// DELETE /payments/methods/:id
// Detaches a payment method from the user's Stripe customer
app.delete('/payments/methods/:id', apiLimiter, authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const paymentMethodId = req.params.id;

    // Verify the payment method belongs to this user
    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', userId)
      .single();

    if (!profile?.stripe_customer_id) {
      return res.status(404).json({ error: 'No payment methods found' });
    }

    // Retrieve the payment method to verify ownership
    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);

    if (paymentMethod.customer !== profile.stripe_customer_id) {
      return res.status(403).json({ error: 'Not authorized to remove this payment method' });
    }

    // Detach the payment method
    await stripe.paymentMethods.detach(paymentMethodId);

    console.log(`[PaymentMethods] Detached ${paymentMethodId} from customer ${profile.stripe_customer_id}`);
    res.json({ success: true });

  } catch (error) {
    console.error('[PaymentMethods] Error detaching:', error.message);

    if (error.code === 'resource_missing') {
      return res.status(404).json({ error: 'Payment method not found' });
    }

    res.status(500).json({ error: 'Failed to remove payment method' });
  }
});

// POST /payments/confirm
// Confirms a payment intent with 3D Secure handling
app.post('/payments/confirm', paymentLimiter, authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const { paymentIntentId, paymentMethodId } = req.body;

    if (!paymentIntentId) {
      return res.status(400).json({ error: 'Payment intent ID is required' });
    }

    // Retrieve the payment intent
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    // Verify ownership with strict string comparison
    // Both values must be strings and match exactly
    const metadataUserId = String(paymentIntent.metadata?.user_id || '');
    const requestUserId = String(userId);

    if (!metadataUserId || metadataUserId !== requestUserId) {
      console.warn(`[PaymentConfirm] Ownership mismatch: metadata=${metadataUserId}, request=${requestUserId}`);
      return res.status(403).json({ error: 'Not authorized to confirm this payment' });
    }

    // If already succeeded or processing, return current status
    if (paymentIntent.status === 'succeeded' || paymentIntent.status === 'processing') {
      return res.json({
        success: true,
        status: paymentIntent.status,
        paymentIntentId: paymentIntent.id,
      });
    }

    // Confirm the payment if needed
    let confirmedIntent = paymentIntent;
    if (paymentIntent.status === 'requires_confirmation' || paymentIntent.status === 'requires_payment_method') {
      const confirmParams = {};
      if (paymentMethodId) {
        confirmParams.payment_method = paymentMethodId;
      }

      confirmedIntent = await stripe.paymentIntents.confirm(paymentIntentId, confirmParams);
    }

    // Handle 3D Secure / requires_action
    if (confirmedIntent.status === 'requires_action') {
      return res.json({
        success: false,
        status: 'requires_action',
        requiresAction: true,
        clientSecret: confirmedIntent.client_secret,
        nextAction: confirmedIntent.next_action,
      });
    }

    const success = confirmedIntent.status === 'succeeded';
    console.log(`[PaymentConfirm] Payment ${paymentIntentId} status: ${confirmedIntent.status}`);

    res.json({
      success,
      status: confirmedIntent.status,
      paymentIntentId: confirmedIntent.id,
    });

  } catch (error) {
    console.error('[PaymentConfirm] Error:', error.message);

    // Handle specific Stripe errors
    if (error.type === 'StripeCardError') {
      return res.status(400).json({
        error: error.message,
        code: error.code,
        decline_code: error.decline_code,
      });
    }

    res.status(500).json({ error: 'Failed to confirm payment' });
  }
});

// POST /webhooks/stripe
// Handles Stripe webhook events with signature verification
app.post('/webhooks/stripe', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('[Webhook] STRIPE_WEBHOOK_SECRET not configured');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  let event;

  try {
    // Verify webhook signature
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('[Webhook] Signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook signature verification failed: ${err.message}` });
  }

  // Handle the event
  console.log(`[Webhook] Received event: ${event.type} (${event.id})`);

  try {
    // Check if event already processed (idempotency)
    const { data: existingEvent } = await supabase
      .from('stripe_events')
      .select('id, processed')
      .eq('stripe_event_id', event.id)
      .single();

    if (existingEvent?.processed) {
      console.log(`[Webhook] Event ${event.id} already processed, skipping`);
      return res.json({ received: true, alreadyProcessed: true });
    }

    // Log event for tracking
    await supabase.from('stripe_events').upsert({
      stripe_event_id: event.id,
      event_type: event.type,
      event_data: event.data.object,
      processed: false
    });

    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object;
        const userId = paymentIntent.metadata?.user_id;

        if (!userId) {
          console.error('[Webhook] Missing user_id in payment intent metadata');
          break;
        }

        console.log(`[Webhook] PaymentIntent succeeded: ${paymentIntent.id} for user ${userId}`);

        // Create wallet transaction
        const { data: transaction, error: txError } = await supabase
          .from('wallet_transactions')
          .insert({
            user_id: userId,
            type: 'deposit',
            amount: paymentIntent.amount / 100, // Convert cents to dollars
            description: 'Wallet deposit via Stripe',
            status: 'completed',
            stripe_payment_intent_id: paymentIntent.id,
            metadata: paymentIntent.metadata
          })
          .select()
          .single();

        if (txError) {
          console.error('[Webhook] Error creating transaction:', txError);
          throw txError;
        }

        // Update user balance using RPC for atomic operation
        const { error: balanceError } = await supabase.rpc('increment_balance', {
          p_user_id: userId,
          p_amount: paymentIntent.amount / 100
        });

        if (balanceError) {
          console.error('[Webhook] Error updating balance via RPC:', balanceError);
          // Fallback: Retry the RPC once more in case of transient error
          try {
            const { error: retryError } = await supabase.rpc('increment_balance', {
              p_user_id: userId,
              p_amount: paymentIntent.amount / 100
            });

            if (retryError) {
              // Last resort: direct update (log error about potential race condition)
              console.error('[Webhook] Atomic balance update failed after retry - using non-atomic update. Please add increment_balance RPC function to prevent race conditions.', {
                user_id: userId,
                amount: paymentIntent.amount / 100,
                originalError: balanceError,
                retryError: retryError
              });
              const { data: profile } = await supabase
                .from('profiles')
                .select('balance')
                .eq('id', userId)
                .single();

              const currentBalance = profile?.balance || 0;
              await supabase.from('profiles')
                .update({ balance: currentBalance + (paymentIntent.amount / 100) })
                .eq('id', userId);
            }
          } catch (fallbackErr) {
            console.error('[Webhook] Fallback balance update error:', fallbackErr);
          }
        }

        console.log(`[Webhook] Transaction created: ${transaction.id}, balance updated for user ${userId}`);

        // Note: User notification should be implemented via a notification service
        // when available (push notifications, email, etc.)
        break;
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object;
        const userId = paymentIntent.metadata?.user_id;
        const error = paymentIntent.last_payment_error;

        console.log(`[Webhook] PaymentIntent failed: ${paymentIntent.id} for user ${userId}`);
        console.log(`[Webhook] Failure reason: ${error?.code} - ${error?.message}`);

        // Log failed payment attempt for analytics/fraud detection
        await supabase.from('stripe_events').update({
          processed: true,
          processed_at: new Date().toISOString(),
          event_data: {
            ...event.data.object,
            _processed_notes: `Payment failed: ${error?.code}`
          }
        }).eq('stripe_event_id', event.id);

        // TODO: Send notification to user about failed payment
        break;
      }

      case 'payment_intent.requires_action': {
        const paymentIntent = event.data.object;
        const userId = paymentIntent.metadata?.user_id;

        console.log(`[Webhook] PaymentIntent requires action (3DS): ${paymentIntent.id} for user ${userId}`);
        // This is informational - the client-side SDK handles 3DS authentication
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object;
        const paymentIntentId = charge.payment_intent;

        console.log(`[Webhook] Charge refunded: ${charge.id}`);

        // Find original transaction
        const { data: originalTx } = await supabase
          .from('wallet_transactions')
          .select('user_id, amount')
          .eq('stripe_payment_intent_id', paymentIntentId)
          .single();

        if (originalTx) {
          // Create refund transaction
          await supabase
            .from('wallet_transactions')
            .insert({
              user_id: originalTx.user_id,
              type: 'refund',
              amount: -(charge.amount_refunded / 100), // Negative for refund
              description: 'Payment refunded',
              status: 'completed',
              stripe_charge_id: charge.id,
              metadata: { refund_reason: charge.refund?.reason }
            });

          // Update user balance atomically (subtract refunded amount)
          // Try RPC first, then retry once on failure
          const { error: rpcError } = await supabase.rpc('decrement_balance', {
            p_user_id: originalTx.user_id,
            p_amount: charge.amount_refunded / 100
          });

          if (rpcError) {
            // Retry the atomic RPC once in case of transient error
            const { error: retryError } = await supabase.rpc('decrement_balance', {
              p_user_id: originalTx.user_id,
              p_amount: charge.amount_refunded / 100
            });

            if (retryError) {
              console.error('[Webhook] Atomic balance update for refund failed after retry. Please add decrement_balance RPC function.', {
                user_id: originalTx.user_id,
                amount: charge.amount_refunded / 100,
                originalError: rpcError,
                retryError: retryError
              });
              // Last resort: non-atomic update with warning
              const { data: profile } = await supabase
                .from('profiles')
                .select('balance')
                .eq('id', originalTx.user_id)
                .single();

              const currentBalance = profile?.balance || 0;
              await supabase.from('profiles')
                .update({ balance: Math.max(0, currentBalance - (charge.amount_refunded / 100)) })
                .eq('id', originalTx.user_id);
            }
          }

          console.log(`[Webhook] Refund processed for user ${originalTx.user_id}`);
        }

        break;
      }

      case 'transfer.created': {
        const transfer = event.data.object;
        console.log(`[Webhook] Transfer created: ${transfer.id} to ${transfer.destination} for $${transfer.amount / 100}`);

        // Update related transaction with transfer ID
        // Match by user_id, type, amount, and null stripe_transfer_id for more accurate association
        const userId = transfer.metadata?.user_id;
        const transferAmountDollars = transfer.amount / 100;
        if (userId) {
          await supabase
            .from('wallet_transactions')
            .update({
              stripe_transfer_id: transfer.id,
              metadata: { transfer_status: 'created' }
            })
            .eq('user_id', userId)
            .eq('type', 'withdrawal')
            .eq('amount', -transferAmountDollars) // Match the amount for accurate association
            .is('stripe_transfer_id', null)
            .order('created_at', { ascending: false })
            .limit(1);
        }
        break;
      }

      case 'transfer.paid': {
        const transfer = event.data.object;
        console.log(`[Webhook] Transfer paid: ${transfer.id}`);

        // Update transaction status
        await supabase
          .from('wallet_transactions')
          .update({
            status: 'completed',
            metadata: { transfer_status: 'paid', paid_at: new Date().toISOString() }
          })
          .eq('stripe_transfer_id', transfer.id);

        // TODO: Send notification to user that funds have been transferred
        break;
      }

      case 'transfer.failed': {
        const transfer = event.data.object;
        console.log(`[Webhook] Transfer failed: ${transfer.id}`);

        // Mark transaction as failed and prepare for retry
        const { data: tx } = await supabase
          .from('wallet_transactions')
          .update({
            status: 'failed',
            metadata: {
              transfer_status: 'failed',
              failure_reason: transfer.failure_code,
              retry_count: 0
            }
          })
          .eq('stripe_transfer_id', transfer.id)
          .select()
          .single();

        if (tx) {
          // Refund the amount back to user's wallet for failed withdrawal
          // Use atomic RPC if available, with fallback
          const refundAmount = Math.abs(tx.amount);

          const { error: rpcError } = await supabase.rpc('increment_balance', {
            p_user_id: tx.user_id,
            p_amount: refundAmount
          });

          if (rpcError) {
            // Retry the atomic RPC once in case of transient error
            const { error: retryError } = await supabase.rpc('increment_balance', {
              p_user_id: tx.user_id,
              p_amount: refundAmount
            });

            if (retryError) {
              console.error('[Webhook] Atomic balance update for transfer refund failed after retry. Using non-atomic fallback.', {
                user_id: tx.user_id,
                refundAmount,
                originalError: rpcError,
                retryError: retryError
              });
              // Last resort: non-atomic update to ensure user gets refunded
              const { data: profile } = await supabase
                .from('profiles')
                .select('balance')
                .eq('id', tx.user_id)
                .single();

              const currentBalance = profile?.balance || 0;
              await supabase.from('profiles')
                .update({ balance: currentBalance + refundAmount })
                .eq('id', tx.user_id);
            }
          }

          console.log(`[Webhook] Refunded $${refundAmount} to user ${tx.user_id} for failed transfer`);

          // Note: User notification should be implemented via notification service when available
        }
        break;
      }

      case 'account.updated': {
        const account = event.data.object;
        console.log(`[Webhook] Connect account updated: ${account.id}`);

        // Update user's Connect status
        if (account.metadata?.user_id) {
          await supabase
            .from('profiles')
            .update({
              stripe_connect_onboarded_at: account.details_submitted && account.payouts_enabled
                ? new Date().toISOString()
                : null
            })
            .eq('id', account.metadata.user_id);
        }
        break;
      }

      case 'payout.paid': {
        const payout = event.data.object;
        console.log(`[Webhook] Payout paid: ${payout.id} for $${payout.amount / 100}`);
        // Informational - funds have been paid out to connected account's bank
        break;
      }

      case 'payout.failed': {
        const payout = event.data.object;
        console.log(`[Webhook] Payout failed: ${payout.id}, reason: ${payout.failure_code}`);
        // TODO: Notify user and support about failed payout
        break;
      }

      default:
        console.log(`[Webhook] Unhandled event type: ${event.type}`);
    }

    // Mark event as processed
    await supabase
      .from('stripe_events')
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq('stripe_event_id', event.id);

    // Return 200 to acknowledge receipt
    res.json({ received: true });

  } catch (error) {
    console.error('[Webhook] Error processing event:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// POST /connect/create-account-link
// Creates a Stripe Connect account and generates onboarding link
app.post('/connect/create-account-link', apiLimiter, authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const { returnUrl, refreshUrl } = req.body;

    console.log(`[Connect] Account link requested for user: ${userId}`);

    // Get user profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_connect_account_id, email')
      .eq('id', userId)
      .single();

    let accountId = profile?.stripe_connect_account_id;

    // Create Stripe Connect account if doesn't exist
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        email: profile?.email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_type: 'individual',
        metadata: { user_id: userId }
      });

      accountId = account.id;

      // Save account ID to profile
      await supabase
        .from('profiles')
        .update({ stripe_connect_account_id: accountId })
        .eq('id', userId);

      console.log(`[Connect] Created new account: ${accountId} for user ${userId}`);
    }

    // Generate account link for onboarding
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl || `${process.env.APP_URL || 'http://localhost:8081'}/wallet/connect/refresh`,
      return_url: returnUrl || `${process.env.APP_URL || 'http://localhost:8081'}/wallet/connect/return`,
      type: 'account_onboarding',
    });

    console.log(`[Connect] Account link created for ${accountId}`);

    res.json({
      url: accountLink.url,
      accountId: accountId,
      expiresAt: accountLink.expires_at * 1000,
    });

  } catch (error) {
    console.error('[Connect] Error creating account link:', error);
    res.status(500).json({ error: error.message || 'Failed to create account link' });
  }
});

// POST /connect/verify-onboarding
// Verifies Connect account onboarding status
app.post('/connect/verify-onboarding', apiLimiter, authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_connect_account_id')
      .eq('id', userId)
      .single();

    if (!profile?.stripe_connect_account_id) {
      return res.json({ onboarded: false });
    }

    // Check account status with Stripe
    const account = await stripe.accounts.retrieve(profile.stripe_connect_account_id);

    const onboarded = account.charges_enabled && account.payouts_enabled;

    // Update profile if onboarded
    if (onboarded && !profile.stripe_connect_onboarded_at) {
      await supabase
        .from('profiles')
        .update({ stripe_connect_onboarded_at: new Date().toISOString() })
        .eq('id', userId);
    }

    res.json({
      onboarded,
      accountId: account.id,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted
    });

  } catch (error) {
    console.error('[Connect] Error verifying onboarding:', error);
    res.status(500).json({ error: 'Failed to verify onboarding' });
  }
});

// POST /connect/transfer
// Initiates a transfer to user's connected account
app.post('/connect/transfer', paymentLimiter, authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const { amount, currency = 'usd' } = req.body;

    // Validate amount
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    // Get user profile and check balance
    const { data: profile } = await supabase
      .from('profiles')
      .select('balance, stripe_connect_account_id, stripe_connect_onboarded_at')
      .eq('id', userId)
      .single();

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    if (!profile.stripe_connect_account_id || !profile.stripe_connect_onboarded_at) {
      return res.status(400).json({ error: 'Stripe Connect account not set up' });
    }

    if (profile.balance < amount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    // Create transfer to connected account
    const transfer = await stripe.transfers.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency: currency,
      destination: profile.stripe_connect_account_id,
      metadata: { user_id: userId }
    });

    // Create withdrawal transaction
    const { data: transaction, error: txError } = await supabase
      .from('wallet_transactions')
      .insert({
        user_id: userId,
        type: 'withdrawal',
        amount: -amount, // Negative for withdrawal
        description: 'Withdrawal to bank account',
        status: 'pending',
        stripe_transfer_id: transfer.id,
        stripe_connect_account_id: profile.stripe_connect_account_id,
        metadata: { transfer }
      })
      .select()
      .single();

    if (txError) {
      console.error('[Connect] Error creating transaction:', txError);
      throw txError;
    }

    // Update user balance using parameterized RPC function
    // This prevents SQL injection by using a stored procedure with proper parameter binding
    const { data: newBalance, error: balanceError } = await supabase
      .rpc('update_balance', {
        p_user_id: userId,
        p_amount: -amount  // Negative amount for withdrawal
      });

    if (balanceError) {
      console.error('[Connect] Error updating balance:', balanceError);
      throw new Error('Failed to update balance');
    }

    console.log(`[Connect] Transfer created: ${transfer.id} for user ${userId}, amount ${amount}`);

    res.json({
      transferId: transfer.id,
      status: 'pending',
      amount: amount,
      currency: currency,
      accountId: profile.stripe_connect_account_id,
      transactionId: transaction.id,
      estimatedArrival: new Date(Date.now() + (2 * 24 * 60 * 60 * 1000)).toISOString(), // 2 days
      message: 'Transfer initiated. Funds typically arrive in 1-2 business days.'
    });

  } catch (error) {
    console.error('[Connect] Error initiating transfer:', error);
    res.status(500).json({ error: error.message || 'Failed to initiate transfer' });
  }
});

// =============================================================================
// WALLET ENDPOINTS
// =============================================================================

// GET /wallet/balance
// Returns the user's current wallet balance
app.get('/wallet/balance', apiLimiter, authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('balance')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('[Wallet] Error fetching balance:', error);
      return res.status(500).json({ error: 'Failed to fetch balance' });
    }

    res.json({
      balance: profile?.balance || 0,
      currency: 'USD',
    });

  } catch (error) {
    console.error('[Wallet] Error:', error);
    res.status(500).json({ error: 'Failed to fetch balance' });
  }
});

// GET /wallet/transactions
// Returns the user's transaction history
app.get('/wallet/transactions', apiLimiter, authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;

    const { data: transactions, error } = await supabase
      .from('wallet_transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('[Wallet] Error fetching transactions:', error);
      return res.status(500).json({ error: 'Failed to fetch transactions' });
    }

    // Transform to client format
    const formattedTransactions = (transactions || []).map(tx => ({
      id: tx.id,
      type: tx.type,
      amount: tx.amount,
      date: tx.created_at,
      details: {
        title: tx.description,
        method: tx.stripe_payment_intent_id ? 'Stripe' : 'Wallet',
        status: tx.status || 'completed',
        bounty_id: tx.bounty_id,
      },
    }));

    res.json({ transactions: formattedTransactions });

  } catch (error) {
    console.error('[Wallet] Error:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// POST /connect/retry-transfer
// Retries a failed transfer
app.post('/connect/retry-transfer', paymentLimiter, authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const { transactionId } = req.body;

    if (!transactionId) {
      return res.status(400).json({ error: 'Transaction ID is required' });
    }

    // Get the failed transaction
    const { data: tx, error: txError } = await supabase
      .from('wallet_transactions')
      .select('*')
      .eq('id', transactionId)
      .eq('user_id', userId)
      .eq('status', 'failed')
      .single();

    if (txError || !tx) {
      return res.status(404).json({ error: 'Failed transaction not found' });
    }

    // Check retry count
    const retryCount = tx.metadata?.retry_count || 0;
    if (retryCount >= 3) {
      return res.status(400).json({
        error: 'Maximum retry attempts reached. Please contact support.',
        maxRetriesReached: true
      });
    }

    // Get user's Connect account
    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_connect_account_id, balance')
      .eq('id', userId)
      .single();

    if (!profile?.stripe_connect_account_id) {
      return res.status(400).json({ error: 'Stripe Connect account not found' });
    }

    const amount = Math.abs(tx.amount);

    // Check if user still has the balance (it was refunded after failure)
    if (profile.balance < amount) {
      return res.status(400).json({ error: 'Insufficient balance for retry' });
    }

    // Use atomic balance decrement to prevent race conditions
    // First try RPC, then fallback with optimistic locking
    const { error: rpcError } = await supabase.rpc('decrement_balance', {
      p_user_id: userId,
      p_amount: amount
    });

    let balanceDeducted = !rpcError;

    if (rpcError) {
      console.warn('[Connect] RPC not available, using optimistic locking for transfer retry');

      // Optimistic locking: re-check balance and update atomically
      const { data: updatedProfile, error: updateError } = await supabase
        .from('profiles')
        .update({ balance: profile.balance - amount })
        .eq('id', userId)
        .eq('balance', profile.balance) // Optimistic lock: only update if balance hasn't changed
        .select()
        .single();

      if (updateError || !updatedProfile) {
        return res.status(409).json({
          error: 'Balance changed during processing. Please try again.',
          code: 'BALANCE_CONFLICT'
        });
      }
      balanceDeducted = true;
    }

    if (!balanceDeducted) {
      return res.status(400).json({ error: 'Failed to deduct balance for retry' });
    }

    // Create new transfer
    let transfer;
    try {
      transfer = await stripe.transfers.create({
        amount: Math.round(amount * 100),
        currency: 'usd',
        destination: profile.stripe_connect_account_id,
        metadata: {
          user_id: userId,
          retry_of_transaction: transactionId,
        }
      });
    } catch (stripeError) {
      // If transfer fails, refund the balance
      console.error('[Connect] Transfer creation failed, refunding balance:', stripeError);
      await supabase.rpc('increment_balance', {
        p_user_id: userId,
        p_amount: amount
      }).catch(async (rpcFallbackError) => {
        // Fallback: direct update with error handling and logging
        try {
          const { error: fallbackUpdateError } = await supabase.from('profiles')
            .update({ balance: profile.balance })
            .eq('id', userId);
          if (fallbackUpdateError) {
            console.error('[Connect] Fallback balance refund update failed:', fallbackUpdateError);
          }
        } catch (fallbackException) {
          console.error('[Connect] Exception during fallback balance refund update:', fallbackException);
        }
      });
      throw stripeError;
    }

    // Update the transaction with new transfer ID
    await supabase
      .from('wallet_transactions')
      .update({
        stripe_transfer_id: transfer.id,
        status: 'pending',
        metadata: {
          ...tx.metadata,
          retry_count: retryCount + 1,
          retried_at: new Date().toISOString(),
        }
      })
      .eq('id', transactionId);

    console.log(`[Connect] Transfer retry successful: ${transfer.id} for transaction ${transactionId}`);

    res.json({
      success: true,
      transferId: transfer.id,
      transactionId,
      message: 'Transfer retry initiated successfully.',
    });

  } catch (error) {
    console.error('[Connect] Error retrying transfer:', error);
    res.status(500).json({ error: error.message || 'Failed to retry transfer' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server (bind to 0.0.0.0 so LAN devices can reach it)
// SECURITY: HTTPS enforcement is active in production mode
// HTTP requests will be rejected with 403 Forbidden
// For production, use a reverse proxy (nginx, Apache, Cloudflare) or enable direct HTTPS
// Rate limiting is configured above to prevent abuse.
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 BountyExpo Stripe Server running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔐 Stripe configured: ${!!process.env.STRIPE_SECRET_KEY ? 'Yes' : 'No'}`);
  console.log(`📝 Webhook secret configured: ${!!process.env.STRIPE_WEBHOOK_SECRET ? 'Yes' : 'No'}`);
  if (process.env.NODE_ENV === 'production') {
    console.log(`🔒 HTTPS ENFORCEMENT: ACTIVE - HTTP requests will be rejected`);
    console.log(`   ├─ HSTS enabled (max-age: 1 year)`);
    console.log(`   ├─ Security headers configured`);
    console.log(`   └─ Supports reverse proxy (X-Forwarded-Proto)`);
  } else {
    console.log(`⚠️  Development mode: HTTPS enforcement disabled`);
  }
  console.log(`\nAvailable endpoints:`);
  console.log(`  GET  /health`);
  console.log(`  GET  /debug`);
  console.log(`  POST /payments/create-payment-intent`);
  console.log(`  POST /payments/confirm`);
  console.log(`  GET  /payments/methods`);
  console.log(`  POST /payments/methods`);
  console.log(`  DELETE /payments/methods/:id`);
  console.log(`  POST /apple-pay/payment-intent`);
  console.log(`  POST /apple-pay/confirm`);
  console.log(`  POST /webhooks/stripe`);
  console.log(`  GET  /wallet/balance`);
  console.log(`  GET  /wallet/transactions`);
  console.log(`  POST /connect/create-account-link`);
  console.log(`  POST /connect/verify-onboarding`);
  console.log(`  POST /connect/transfer`);
  console.log(`  POST /connect/retry-transfer`);
  console.log(`\n💡 Set up your .env file before running in production\n`);
});
