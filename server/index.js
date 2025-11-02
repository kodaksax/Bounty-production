require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Wallet transactions file for demo persistence
const WALLET_TX_FILE = path.join(__dirname, 'wallet-transactions.json');

// Initialize wallet transactions file if it doesn't exist
if (!fs.existsSync(WALLET_TX_FILE)) {
  fs.writeFileSync(WALLET_TX_FILE, JSON.stringify([], null, 2));
}

// Helper to read/write wallet transactions
function readTransactions() {
  try {
    const data = fs.readFileSync(WALLET_TX_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading transactions:', error);
    return [];
  }
}

function writeTransactions(transactions) {
  try {
    fs.writeFileSync(WALLET_TX_FILE, JSON.stringify(transactions, null, 2));
  } catch (error) {
    console.error('Error writing transactions:', error);
  }
}

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

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    stripeConfigured: !!process.env.STRIPE_SECRET_KEY 
  });
});

// POST /payments/create-payment-intent
// Creates a PaymentIntent for the specified amount
app.post('/payments/create-payment-intent', async (req, res) => {
  try {
    const { amountCents, currency = 'usd', metadata = {} } = req.body;

    // Validate amount
    if (!amountCents || typeof amountCents !== 'number' || amountCents <= 0) {
      return res.status(400).json({ 
        error: 'Invalid amount. Must be a positive number in cents.' 
      });
    }

    // Create PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: currency,
      metadata: metadata,
      automatic_payment_methods: {
        enabled: true,
      },
    });

    console.log(`[PaymentIntent] Created: ${paymentIntent.id} for ${amountCents} ${currency}`);

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
  console.log(`[Webhook] Received event: ${event.type}`);

  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object;
        console.log(`[Webhook] PaymentIntent succeeded: ${paymentIntent.id}`);
        
        // Log transaction to local file
        const transactions = readTransactions();
        transactions.push({
          id: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
          type: 'payment_intent.succeeded',
          stripePaymentIntentId: paymentIntent.id,
          amount: paymentIntent.amount,
          currency: paymentIntent.currency,
          metadata: paymentIntent.metadata,
          timestamp: new Date().toISOString(),
          status: 'completed'
        });
        writeTransactions(transactions);
        
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object;
        console.log(`[Webhook] Charge refunded: ${charge.id}`);
        
        // Log refund transaction
        const transactions = readTransactions();
        transactions.push({
          id: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
          type: 'charge.refunded',
          stripeChargeId: charge.id,
          amount: charge.amount_refunded,
          currency: charge.currency,
          timestamp: new Date().toISOString(),
          status: 'refunded'
        });
        writeTransactions(transactions);
        
        break;
      }

      default:
        console.log(`[Webhook] Unhandled event type: ${event.type}`);
    }

    // Return 200 to acknowledge receipt
    res.json({ received: true });

  } catch (error) {
    console.error('[Webhook] Error processing event:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// POST /connect/create-account-link
// Scaffold endpoint for Stripe Connect onboarding
app.post('/connect/create-account-link', async (req, res) => {
  try {
    const { userId, email } = req.body;

    // TODO: In production, this would:
    // 1. Create or retrieve a Stripe Connect account for the user
    // 2. Generate an account link for onboarding
    // 3. Store the account ID in your database
    
    // Mock response for now
    console.log(`[Connect] Account link requested for user: ${userId}`);
    
    res.json({
      url: 'https://connect.stripe.com/setup/c/mock_link_placeholder',
      accountId: `acct_mock_${Date.now()}`,
      expiresAt: Date.now() + (60 * 60 * 1000), // 1 hour from now
      message: 'This is a mock response. Implement full Stripe Connect integration in production.'
    });

  } catch (error) {
    console.error('[Connect] Error creating account link:', error);
    res.status(500).json({ error: 'Failed to create account link' });
  }
});

// POST /connect/transfer
// Scaffold endpoint for initiating transfers to connected accounts
app.post('/connect/transfer', async (req, res) => {
  try {
    const { accountId, amount, currency = 'usd', metadata = {} } = req.body;

    if (!accountId || !amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid account ID or amount' });
    }

    // TODO: In production, this would:
    // 1. Verify the connected account exists and is active
    // 2. Create a transfer to the connected account
    // 3. Update your database with transfer status
    
    console.log(`[Connect] Transfer initiated to ${accountId}: ${amount} ${currency}`);
    
    // Mock response
    res.json({
      transferId: `tr_mock_${Date.now()}`,
      status: 'pending',
      amount: amount,
      currency: currency,
      accountId: accountId,
      estimatedArrival: new Date(Date.now() + (3 * 24 * 60 * 60 * 1000)).toISOString(), // 3 days
      message: 'Transfer initiated. Funds typically arrive in 1-3 business days.'
    });

  } catch (error) {
    console.error('[Connect] Error initiating transfer:', error);
    res.status(500).json({ error: 'Failed to initiate transfer' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
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
