// Example Express routes for Stripe Connect onboarding and verification
// Install: npm i express stripe
// Env: STRIPE_SECRET_KEY, APP_DEEP_LINK_SCHEME (e.g., bountyexpo), APP_DOMAIN (e.g., https://yourapp.com)

import express from 'express';
import Stripe from 'stripe';
import { DEEP_LINK_SCHEME } from '../../lib/config/app';

// Require the Stripe secret key at startup and fail-fast with a clear error.
const stripeSecret = process.env.STRIPE_SECRET_KEY;
if (!stripeSecret) {
  const msg = 'Missing required environment variable STRIPE_SECRET_KEY. Set STRIPE_SECRET_KEY to your Stripe secret key.';
  // Log to stderr for server platforms/hosting dashboards
  console.error('[stripe-connect-routes] ' + msg);
  // Fail fast so the server does not start without credentials
  throw new Error(msg);
}

const router = express.Router();
const stripe = new Stripe(stripeSecret, { apiVersion: '2023-10-16' as any });

// Create a Connect account for a user
router.post('/payments/create-connect-account', async (req, res) => {
  try {
    const { userId, email } = req.body as { userId: string; email: string };
    if (!userId || !email) return res.status(400).json({ error: 'Missing userId or email' });

    const account = await stripe.accounts.create({
      type: 'express',
      country: 'US',
      email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      metadata: { userId },
    });

    return res.json({ accountId: account.id });
  } catch (err: any) {
    console.error('Create Connect account error:', err);
    return res.status(500).json({ error: 'Failed to create account' });
  }
});

// Create an onboarding link with deep link return_url
router.post('/payments/create-account-link', async (req, res) => {
  try {
    const { accountId } = req.body as { accountId: string };
    if (!accountId) return res.status(400).json({ error: 'Missing accountId' });

    const scheme = process.env.APP_DEEP_LINK_SCHEME || DEEP_LINK_SCHEME;
    const domain = process.env.APP_DOMAIN || 'https://yourapp.com';

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${domain}/connect/reauth`,
      return_url: `${scheme}://connect-onboarding-return`,
      type: 'account_onboarding',
    });

    return res.json({ url: accountLink.url });
  } catch (err: any) {
    console.error('Create Account Link error:', err);
    return res.status(500).json({ error: 'Failed to create account link' });
  }
});

// Verify Connect account status after return (client calls this after deep link)
router.get('/payments/connect/accounts/:accountId/verify', async (req, res) => {
  try {
    const { accountId } = req.params as { accountId: string };
    if (!accountId) return res.status(400).json({ error: 'Missing accountId' });

    const account = await stripe.accounts.retrieve(accountId);
    const detailsSubmitted = !!account.details_submitted;
    const capabilities = account.capabilities || {};

    return res.json({ detailsSubmitted, capabilities, account });
  } catch (err: any) {
    console.error('Verify Connect account error:', err);
    return res.status(500).json({ error: 'Failed to verify account' });
  }
});

export default router;
