import dotenv from 'dotenv';
import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { db } from './db/connection';
import { users } from './db/schema';
import { AuthenticatedRequest, authMiddleware } from './middleware/auth';
import { registerAdminRoutes } from './routes/admin';
import { registerApplePayRoutes } from './routes/apple-pay';
import { registerNotificationRoutes } from './routes/notifications';
import { bountyService } from './services/bounty-service';
import { outboxWorker } from './services/outbox-worker';
import { realtimeService } from './services/realtime-service';
import { refundService } from './services/refund-service';
import { stripeConnectService } from './services/stripe-connect-service';

// After other route registrations
// Load environment variables
dotenv.config();

// Create Fastify instance early so routes can be registered against it
const fastify = Fastify({
  logger: true
});

// Register WebSocket plugin
const startServer = async () => {
  await fastify.register(require('@fastify/websocket'));
  
  // Register admin routes with security middleware
  await registerAdminRoutes(fastify);
  
  // Register notification routes
  await registerNotificationRoutes(fastify);

  // WebSocket route for realtime events - using any to avoid TypeScript complications
  fastify.register(async function (fastify: any) {
    fastify.get('/events/subscribe', { websocket: true }, (connection: any, req: any) => {
      console.log('📡 New WebSocket connection for realtime events');
      
      // Add client to realtime service
      realtimeService.addWebSocketClient(connection);
      
      // Send connection confirmation
      connection.socket.send(JSON.stringify({
        type: 'connection',
        message: 'Connected to BountyExpo realtime events',
        timestamp: new Date().toISOString()
      }));
    });
  });
};

// Health check endpoint (no auth required)
fastify.get('/health', async (request, reply) => {
  try {
    // Test database connection with simple query
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query('SELECT 1');
    await pool.end();
    
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      service: 'bountyexpo-api',
      database: 'connected'
    };
  } catch (error) {
    return reply.code(503).send({
      status: 'error',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      service: 'bountyexpo-api',
      database: 'disconnected',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get user profile endpoint - creates user if not exists on first request
fastify.get('/me', {
  preHandler: authMiddleware
}, async (request: AuthenticatedRequest, reply) => {
  try {
    if (!request.userId) {
      return reply.code(401).send({ error: 'User ID not found in token' });
    }

    // Try to find existing user
    const existingUsers = await db
      .select()
      .from(users)
      .where(eq(users.id, request.userId))
      .limit(1);

    let user = existingUsers[0];

    // Create user if doesn't exist (first request)
    if (!user) {
      const handle = request.user?.user_metadata?.handle || 
                   request.user?.email?.split('@')[0] || 
                   `user_${request.userId.slice(0, 8)}`;

      const newUsers = await db
        .insert(users)
        .values({
          id: request.userId,
          handle: `@${handle}`,
          stripe_account_id: null,
        })
        .returning();

      user = newUsers[0];
      console.log(`✅ Created new user: ${user.handle}`);
    }

    return {
      id: user.id,
      handle: user.handle,
      stripe_account_id: user.stripe_account_id,
      created_at: user.created_at,
    };
  } catch (error) {
    console.error('Error in /me endpoint:', error);
    return reply.code(500).send({ 
      error: 'Failed to retrieve user profile' 
    });
  }
});

// Accept bounty endpoint
fastify.post('/bounties/:bountyId/accept', {
  preHandler: authMiddleware
}, async (request: AuthenticatedRequest, reply) => {
  try {
    const { bountyId } = request.params as { bountyId: string };
    
    if (!request.userId) {
      return reply.code(401).send({ error: 'User ID not found in token' });
    }

    const result = await bountyService.acceptBounty(bountyId, request.userId);
    
    if (!result.success) {
      return reply.code(400).send({ error: result.error });
    }

    return { message: 'Bounty accepted successfully', bountyId };
  } catch (error) {
    console.error('Error in /bounties/:bountyId/accept endpoint:', error);
    return reply.code(500).send({ 
      error: 'Failed to accept bounty' 
    });
  }
});

// Complete bounty endpoint
fastify.post('/bounties/:bountyId/complete', {
  preHandler: authMiddleware
}, async (request: AuthenticatedRequest, reply) => {
  try {
    const { bountyId } = request.params as { bountyId: string };
    
    if (!request.userId) {
      return reply.code(401).send({ error: 'User ID not found in token' });
    }

    const result = await bountyService.completeBounty(bountyId, request.userId);
    
    if (!result.success) {
      return reply.code(400).send({ error: result.error });
    }

    return { message: 'Bounty completed successfully', bountyId };
  } catch (error) {
    console.error('Error in /bounties/:bountyId/complete endpoint:', error);
    return reply.code(500).send({ 
      error: 'Failed to complete bounty' 
    });
  }
});

// Cancel/refund bounty endpoint
fastify.post('/bounties/:bountyId/cancel', {
  preHandler: authMiddleware
}, async (request: AuthenticatedRequest, reply) => {
  try {
    const { bountyId } = request.params as { bountyId: string };
    const { reason } = request.body as { reason?: string };
    
    if (!request.userId) {
      return reply.code(401).send({ error: 'User ID not found in token' });
    }

    const result = await refundService.processRefund({
      bountyId,
      reason,
      cancelledBy: request.userId,
    });
    
    if (!result.success) {
      return reply.code(400).send({ error: result.error });
    }

    return { 
      message: 'Bounty cancelled and refund processed successfully', 
      bountyId,
      refundId: result.refundId,
      amount: result.amount,
    };
  } catch (error) {
    console.error('Error in /bounties/:bountyId/cancel endpoint:', error);
    return reply.code(500).send({ 
      error: 'Failed to cancel bounty and process refund' 
    });
  }
});

// Validate payment capability endpoint
fastify.post('/stripe/validate-payment', {
  preHandler: authMiddleware
}, async (request: AuthenticatedRequest, reply) => {
  try {
    const { amountCents } = request.body as { amountCents: number };
    
    if (!request.userId) {
      return reply.code(401).send({ error: 'User ID not found in token' });
    }

    if (!amountCents || amountCents <= 0) {
      return reply.code(400).send({ error: 'Invalid amount' });
    }

    const result = await stripeConnectService.validatePaymentCapability(
      request.userId,
      amountCents
    );
    
    return result;
  } catch (error) {
    console.error('Error in /stripe/validate-payment endpoint:', error);
    const message = error instanceof Error ? error.message : 'Failed to validate payment capability';
    return reply.code(500).send({ 
      error: message 
    });
  }
});

// Stripe Connect onboarding link endpoint
fastify.post('/stripe/connect/onboarding-link', {
  preHandler: authMiddleware
}, async (request: AuthenticatedRequest, reply) => {
  try {
    if (!request.userId) {
      return reply.code(401).send({ error: 'User ID not found in token' });
    }

    const { refreshUrl, returnUrl } = request.body as {
      refreshUrl?: string;
      returnUrl?: string;
    };

    const result = await stripeConnectService.createOnboardingLink({
      userId: request.userId,
      refreshUrl,
      returnUrl,
    });

    return result;
  } catch (error) {
    console.error('Error in /stripe/connect/onboarding-link endpoint:', error);
    const message = error instanceof Error ? error.message : 'Failed to create onboarding link';
    return reply.code(500).send({ 
      error: message 
    });
  }
});

// Stripe Connect status endpoint
fastify.get('/stripe/connect/status', {
  preHandler: authMiddleware
}, async (request: AuthenticatedRequest, reply) => {
  try {
    if (!request.userId) {
      return reply.code(401).send({ error: 'User ID not found in token' });
    }

    const status = await stripeConnectService.getConnectStatus(request.userId);
    return status;
  } catch (error) {
    console.error('Error in /stripe/connect/status endpoint:', error);
    const message = error instanceof Error ? error.message : 'Failed to get connect status';
    return reply.code(500).send({ 
      error: message 
    });
  }
});

// Events subscription endpoint documentation
fastify.get('/events/subscribe-info', async (request, reply) => {
  return {
    message: 'WebSocket endpoint for real-time events',
    instructions: {
      connection: 'Connect via WebSocket to ws://host:port/events/subscribe',
      events: {
        'bounty.status': {
          description: 'Bounty status changes (accept/complete)',
          payload: {
            type: 'bounty.status',
            id: 'bounty-id',
            status: 'open | in_progress | completed | archived',
            timestamp: 'ISO 8601 timestamp'
          }
        }
      },
      example: 'const ws = new WebSocket("ws://localhost:3001/events/subscribe")'
    }
  };
});

// Realtime service stats endpoint
fastify.get('/events/stats', async (request, reply) => {
  const stats = realtimeService.getStats();
  return {
    ...stats,
    timestamp: new Date().toISOString()
  };
});
// Root endpoint
fastify.get('/', async (request, reply) => {
  return {
    message: 'BountyExpo API - Complete Escrow Payment Flow',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      me: '/me (requires auth)',
      acceptBounty: '/bounties/:bountyId/accept (requires auth)',
      completeBounty: '/bounties/:bountyId/complete (requires auth)',
      cancelBounty: '/bounties/:bountyId/cancel (requires auth)',
      stripeOnboardingLink: '/stripe/connect/onboarding-link (requires auth)',
      stripeConnectStatus: '/stripe/connect/status (requires auth)',
      validatePayment: '/stripe/validate-payment (requires auth)',
      eventsSubscribe: '/events/subscribe (WebSocket endpoint)',
      eventsSubscribeInfo: '/events/subscribe-info',
      eventsStats: '/events/stats',
    },
    features: {
      escrow: 'Automatic escrow on bounty acceptance',
      release: 'Automatic fund release on completion with platform fee',
      refund: 'Full refund on cancellation',
      stripeConnect: 'Stripe Connect onboarding for hunters',
      emailReceipts: 'Email receipts for all transactions',
      errorHandling: 'Comprehensive error handling with retries',
      edgeCases: 'Validation for insufficient funds and unverified accounts',
    }
  };
});

// Start server
const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3001', 10);
    const host = process.env.HOST || '0.0.0.0';

    // Register Apple Pay routes (async) now that `fastify` has been created
    await registerApplePayRoutes(fastify);

    await startServer();
    await fastify.listen({ port, host });
    console.log(`🚀 BountyExpo API server listening on ${host}:${port}`);
    console.log(`📡 WebSocket server available at ws://${host}:${port}/events/subscribe`);
    
    // Skip outbox worker for now due to Drizzle connection issues
    console.log(`⚠️  Outbox worker disabled due to database connection issues`);
    // await outboxWorker.start(5000); // Process events every 5 seconds
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  
  // Stop the outbox worker
  outboxWorker.stop();
  
  await fastify.close();
  process.exit(0);
});

start();