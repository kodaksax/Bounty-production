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

// Logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:8081', 'http://localhost:19000', 'http://localhost:19006'];

app.use(cors({
  origin: function(origin, callback) {
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
      headersSnippet: Object.keys(req.headers).slice(0,10)
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

    // Validate amount
    if (!amountCents || typeof amountCents !== 'number' || amountCents <= 0) {
      return res.status(400).json({ 
        error: 'Invalid amount. Must be a positive number in cents.' 
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

    // Create PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: currency,
      customer: customerId,
      metadata: {
        user_id: userId,
        ...metadata
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

    if (!amountCents || typeof amountCents !== 'number' || amountCents < 50) {
      return res.status(400).json({ error: 'Amount must be at least $0.50' });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      payment_method_types: ['card'],
      metadata: {
        user_id: req.user.id,
        bounty_id: bountyId || '',
        payment_method: 'apple_pay'
      },
      description: description || 'BountyExpo Payment',
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

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

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

        // Update user balance
        const { error: balanceError } = await supabase.rpc('increment_balance', {
          p_user_id: userId,
          p_amount: paymentIntent.amount / 100
        });

        if (balanceError) {
          console.error('[Webhook] Error updating balance:', balanceError);
          // Create the function if it doesn't exist
          await supabase.from('profiles')
            .update({ 
              balance: supabase.raw(`balance + ${paymentIntent.amount / 100}`)
            })
            .eq('id', userId);
        }

        console.log(`[Webhook] Transaction created: ${transaction.id}, balance updated for user ${userId}`);
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

          // Update user balance (subtract refunded amount)
          await supabase.from('profiles')
            .update({ 
              balance: supabase.raw(`balance - ${charge.amount_refunded / 100}`)
            })
            .eq('id', originalTx.user_id);

          console.log(`[Webhook] Refund processed for user ${originalTx.user_id}`);
        }
        
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

    // Update user balance
    await supabase.from('profiles')
      .update({ balance: supabase.raw(`balance - ${amount}`) })
      .eq('id', userId);

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

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`\n🚀 BountyExpo Stripe Server running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔐 Stripe configured: ${!!process.env.STRIPE_SECRET_KEY ? 'Yes' : 'No'}`);
  console.log(`📝 Webhook secret configured: ${!!process.env.STRIPE_WEBHOOK_SECRET ? 'Yes' : 'No'}`);
  console.log(`\nAvailable endpoints:`);
  console.log(`  GET  /health`);
  console.log(`  POST /payments/create-payment-intent`);
  console.log(`  POST /webhooks/stripe`);
  console.log(`  POST /connect/create-account-link`);
  console.log(`  POST /connect/transfer`);
  console.log(`\n💡 Set up your .env file before running in production\n`);
});
