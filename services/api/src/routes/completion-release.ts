import { Request, Response, Router } from 'express';
import Stripe from 'stripe';
import { CompletionReleaseRequest, completionReleaseService } from '../services/completion-release-service';
import { checkIdempotencyKey, removeIdempotencyKey, storeIdempotencyKey } from '../services/idempotency-service';

export const completionReleaseRouter = Router();

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey, { apiVersion: '2026-01-28.clover' }) : null;

/**
 * POST /api/completion-release
 * Process completion release for a bounty
 */
completionReleaseRouter.post('/', async (req: Request, res: Response) => {
  let idempotencyKey: string | undefined;
  try {
    const request: CompletionReleaseRequest & { idempotencyKey?: string } = req.body;
    idempotencyKey = request.idempotencyKey;

    if (idempotencyKey) {
      const isDuplicate = await checkIdempotencyKey(idempotencyKey);
      if (isDuplicate) {
        return res.status(409).json({
          error: 'Duplicate request detected',
          code: 'duplicate_transaction'
        });
      }
      await storeIdempotencyKey(idempotencyKey);
    }

    // Validate required fields
    if (!request.bountyId || !request.hunterId || !request.paymentIntentId) {
      return res.status(400).json({
        error: 'Missing required fields: bountyId, hunterId, paymentIntentId',
      });
    }

    // Process the completion release
    const result = await completionReleaseService.processCompletionRelease(request);

    if (result.success) {
      return res.status(200).json({
        success: true,
        transferId: result.transferId,
        releaseAmount: result.releaseAmount,
        platformFee: result.platformFee,
        message: 'Completion release processed successfully',
      });
    } else {
      return res.status(422).json({
        error: result.error,
        success: false,
      });
    }
  } catch (error) {
    console.error('Error in completion release endpoint:', error);

    if (idempotencyKey) {
      await removeIdempotencyKey(idempotencyKey);
    }

    return res.status(500).json({
      error: 'Internal server error',
      success: false,
    });
  }
});

/**
 * GET /api/completion-release/:bountyId/status
 * Check if a bounty has been released
 */
completionReleaseRouter.get('/:bountyId/status', async (req: Request, res: Response) => {
  try {
    const { bountyId } = req.params as { bountyId: string };

    const isReleased = await completionReleaseService.isAlreadyReleased(bountyId);
    const releaseTransaction = isReleased
      ? await completionReleaseService.getReleaseTransaction(bountyId)
      : null;

    return res.status(200).json({
      bountyId,
      isReleased,
      releaseTransaction: releaseTransaction ? {
        id: releaseTransaction.id,
        amount: releaseTransaction.amount_cents / 100,
        platformFee: (releaseTransaction.platform_fee_cents || 0) / 100,
        stripeTransferId: releaseTransaction.stripe_transfer_id,
        createdAt: releaseTransaction.created_at,
      } : null,
    });
  } catch (error) {
    console.error('Error checking completion release status:', error);
    return res.status(500).json({
      error: 'Internal server error',
    });
  }
});

/**
 * POST /api/completion-release/webhook
 * Handle Stripe webhook for PaymentIntent succeeded events
 */
completionReleaseRouter.post('/webhook', async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('[completion-release] STRIPE_WEBHOOK_SECRET not configured');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  if (!stripe) {
    console.error('[completion-release] STRIPE_SECRET_KEY not configured');
    return res.status(500).json({ error: 'Stripe not configured' });
  }

  if (!sig || typeof sig !== 'string') {
    console.warn('[completion-release] Missing or invalid stripe-signature header');
    return res.status(400).json({ error: 'Missing or invalid stripe-signature header' });
  }

  let event: Stripe.Event;

  try {
    // req.body is a raw Buffer when express.raw() middleware is used for this route
    const rawBody = (req as any).rawBody ?? req.body;

    if (!(typeof rawBody === 'string' || Buffer.isBuffer(rawBody))) {
      console.error(
        '[completion-release] Webhook raw body is not available as string/Buffer. ' +
          'Ensure express.raw({ type: "application/json" }) is configured for this route.',
      );
      return res.status(500).json({ error: 'Webhook body is not in a valid raw format for signature verification' });
    }

    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err: any) {
    console.error('[completion-release] Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Webhook signature verification failed' });
  }

  try {
    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      const { bounty_id, hunter_id } = paymentIntent.metadata || {};

      if (bounty_id && hunter_id) {
        console.log(`🎯 PaymentIntent succeeded for bounty ${bounty_id}, triggering completion release`);

        const result = await completionReleaseService.processCompletionRelease({
          bountyId: bounty_id,
          hunterId: hunter_id,
          paymentIntentId: paymentIntent.id,
        });

        if (result.success) {
          console.log(`✅ Completion release processed for bounty ${bounty_id}`);
        } else {
          console.error(`❌ Failed to process completion release for bounty ${bounty_id}: ${result.error}`);
        }
      }
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('Error in completion release webhook:', error);
    return res.status(500).json({
      error: 'Internal server error',
    });
  }
});
