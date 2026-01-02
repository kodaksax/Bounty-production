import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { riskAssessmentCron } from './services/risk-assessment-cron';
// Defer importing modules that may read environment variables until after
// we've loaded the .env file below. The actual imports happen just after
// the dotenv loading block.

// After other route registrations
// Load environment variables. Prefer a local .env in the service folder,
// but fall back to the repository root .env (common in monorepos) so dev
// tooling that places the .env at repo root still works when running
// `npm run dev` from services/api.
const local = dotenv.config();
if (!process.env.STRIPE_SECRET_KEY) {
  // __dirname points to services/api/src when running tsx on source files.
  // The repository root is three levels up from here: services/api/src -> services/api -> services -> <repo-root>
  const rootEnv = path.resolve(__dirname, '../../../.env');
  if (fs.existsSync(rootEnv)) {
    dotenv.config({ path: rootEnv });
    console.log(`[env] Loaded environment from ${rootEnv}`);
  } else {
    // If no root .env found, re-use local result (may populate other vars)
    if (local.error) {
      console.warn('[env] No .env found in service folder and repo root; continuing with existing environment');
    }
  }
} else {
  // local already provided STRIPE_SECRET_KEY (or env inherited)
}

// Sanitize a handful of DB-related env vars so legacy quoted values do not
// leak into connection strings. This preserves the values in .env but makes
// the running process use cleaned versions.
function _sanitizeEnv(value?: string | null): string | undefined {
  if (value === undefined || value === null) return undefined;
  let v = String(value).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).trim();
  }
  return v === '' ? undefined : v;
}

const dbEnvKeys = ['DATABASE_URL', 'DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
for (const k of dbEnvKeys) {
  if (process.env[k]) {
    const cleaned = _sanitizeEnv(process.env[k]);
    if (cleaned !== undefined) process.env[k] = cleaned;
  }
}

// Now that environment variables are loaded, require modules at runtime
// so we avoid ES import hoisting (which would initialize modules before
// dotenv runs). Keep type-only imports for TypeScript typings.
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthenticatedRequest } from './middleware/auth';

const { eq } = require('drizzle-orm');
const Fastify = require('fastify');
const { db, pool } = require('./db/connection');
// Detect Supabase mode (used to skip direct Postgres ping at startup)
const STARTUP_SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const STARTUP_SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STARTUP_USE_SUPABASE = !!(STARTUP_SUPABASE_URL && STARTUP_SUPABASE_SERVICE_ROLE_KEY);
const { users } = require('./db/schema');
const { authMiddleware } = require('./middleware/auth');
const { rateLimitMiddleware } = require('./middleware/rate-limit');
const { requestContextMiddleware } = require('./middleware/request-context');
const { registerAdminRoutes } = require('./routes/admin');
const { registerNotificationRoutes } = require('./routes/notifications');
const { registerSearchRoutes } = require('./routes/search');
const { registerAnalyticsRoutes } = require('./routes/analytics');
const { registerMessagingRoutes } = require('./routes/messaging');
const { registerStaleBountyRoutes } = require('./routes/stale-bounty');
const { registerPaymentRoutes } = require('./routes/payments');
const { bountyService } = require('./services/bounty-service');
const { outboxWorker } = require('./services/outbox-worker');
const { realtimeService } = require('./services/realtime-service');
const { wsMessagingService } = require('./services/websocket-messaging-service');
const { refundService } = require('./services/refund-service');
const { stripeConnectService } = require('./services/stripe-connect-service');
const { staleBountyService } = require('./services/stale-bounty-service');
const { registerApplePayRoutes } = require('./routes/apple-pay');
const { registerWalletRoutes } = require('./routes/wallet');
const riskManagementRoutes = require('./routes/risk-management');
const { registerConsolidatedAuthRoutes } = require('./routes/consolidated-auth');
const { registerConsolidatedProfileRoutes } = require('./routes/consolidated-profiles');
const { registerConsolidatedBountyRoutes } = require('./routes/consolidated-bounties');
const { registerConsolidatedBountyRequestRoutes } = require('./routes/consolidated-bounty-requests');
const { registerConsolidatedWebhookRoutes } = require('./routes/consolidated-webhooks');

// Import logger and analytics
const { logger } = require('./services/logger');
const { backendAnalytics } = require('./services/analytics');
const { initializeIdempotencyService } = require('./services/idempotency-service');

// Initialize analytics on startup
backendAnalytics.initialize();

// Initialize idempotency service (Redis or in-memory fallback)
initializeIdempotencyService().catch((error) => {
  logger.error('[startup] Failed to initialize idempotency service:', error);
});

import { createClient as createSupabaseClient } from '@supabase/supabase-js';

// Create Fastify instance early so routes can be registered against it
const fastify = Fastify({
  logger: logger
});

// Register WebSocket plugin and all routes
const startServer = async () => {
  await fastify.register(require('@fastify/websocket'));

  // Register request context middleware globally (first middleware)
  // This adds request ID and context to all requests
  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    await requestContextMiddleware(request, reply);
  });

  // Register global rate limiting middleware for all routes except health
  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.url === '/health') return;
    await rateLimitMiddleware(request, reply);
  });

  // Register admin routes with security middleware
  await registerAdminRoutes(fastify);

  // Register analytics routes with security middleware
  await registerAnalyticsRoutes(fastify);

  // Register notification routes
  await registerNotificationRoutes(fastify);

  // Register search routes
  await registerSearchRoutes(fastify);

  // Register messaging routes
  await registerMessagingRoutes(fastify);

  // Register stale bounty routes
  await registerStaleBountyRoutes(fastify);

  // Register payment routes (SetupIntent, PaymentIntent, etc.)
  await registerPaymentRoutes(fastify);

  // Register consolidated authentication routes
  await registerConsolidatedAuthRoutes(fastify);

  // Register consolidated profile routes
  await registerConsolidatedProfileRoutes(fastify);

  // Register consolidated bounty routes
  await registerConsolidatedBountyRoutes(fastify);

  // Register consolidated bounty request routes
  await registerConsolidatedBountyRequestRoutes(fastify);

  // Register consolidated webhook routes (Stripe events)
  await registerConsolidatedWebhookRoutes(fastify);

  // Register risk management routes
  await fastify.register(riskManagementRoutes.default || riskManagementRoutes);

  // Legacy delete account endpoint (kept for backwards compatibility)
  // NOTE: This endpoint duplicates functionality in consolidated-auth routes
  // Consider removing after migration is complete
  // Delete account endpoint
  fastify.delete('/auth/delete-account', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest, reply: FastifyReply) => {
    try {
      if (!request.userId) {
        return reply.code(401).send({ success: false, message: 'User ID not found in token' });
      }

      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!supabaseUrl || !serviceKey) {
        return reply.code(500).send({ success: false, message: 'Supabase service credentials not configured on API server' });
      }

      const sAdmin = createSupabaseClient(supabaseUrl, serviceKey);

      // --- Dependent data cleanup (order matters) ---
      // 1. Delete completion submissions tied to this user as hunter
      try {
        const { error: compErr } = await sAdmin
          .from('completion_submissions')
          .delete()
          .eq('hunter_id', request.userId);
        if (compErr) request.log.warn({ err: compErr }, 'completion_submissions cleanup failed (continuing)');
      } catch (e: any) {
        request.log.warn({ err: e?.message || e }, 'completion_submissions cleanup threw (continuing)');
      }

      // 2. Delete bounty requests by this user (hunter applications)
      try {
        const { error: reqErr } = await sAdmin
          .from('bounty_requests')
          .delete()
          .eq('user_id', request.userId);
        if (reqErr) request.log.warn({ err: reqErr }, 'bounty_requests cleanup failed (continuing)');
      } catch (e: any) {
        request.log.warn({ err: e?.message || e }, 'bounty_requests cleanup threw (continuing)');
      }

      // 3. Delete bounties created by this user to avoid NOT NULL poster_id violations on profile deletion
      // (If business rules require archival/refund flows, implement them here before deletion.)
      try {
        const { error: bntyErr } = await sAdmin
          .from('bounties')
          .delete()
          .eq('poster_id', request.userId);
        if (bntyErr) request.log.warn({ err: bntyErr }, 'bounties cleanup failed (continuing)');
      } catch (e: any) {
        request.log.warn({ err: e?.message || e }, 'bounties cleanup threw (continuing)');
      }

      // 3.5. Detect and mark stale bounties where this user was the hunter
      try {
        const staleResult = await staleBountyService.detectStaleBounties(request.userId);
        if (staleResult.success && staleResult.staleBountyCount > 0) {
          request.log.info({ staleBountyCount: staleResult.staleBountyCount }, 'Stale bounties detected and marked');
        }
      } catch (e: any) {
        request.log.warn({ err: e?.message || e }, 'Stale bounty detection failed (continuing)');
      }

      // 4. Delete conversations created by this user, with explicit child cleanup to avoid FK/RLS issues
      try {
        // Fetch conversation ids first
        const { data: convs, error: convListErr } = await sAdmin
          .from('conversations')
          .select('id')
          .eq('created_by', request.userId);
        if (convListErr) {
          request.log.warn({ err: convListErr }, 'conversations list failed (continuing)');
        } else if (convs && convs.length > 0) {
          const ids = convs.map((c: any) => c.id);
          // Delete messages in those conversations
          const { error: msgErr } = await sAdmin
            .from('messages')
            .delete()
            .in('conversation_id', ids);
          if (msgErr) request.log.warn({ err: msgErr }, 'messages deletion failed (continuing)');
          // Delete participants in those conversations
          const { error: partErr } = await sAdmin
            .from('conversation_participants')
            .delete()
            .in('conversation_id', ids);
          if (partErr) request.log.warn({ err: partErr }, 'participants deletion failed (continuing)');
          // Finally delete the conversations
          const { error: convDelErr } = await sAdmin
            .from('conversations')
            .delete()
            .in('id', ids);
          if (convDelErr) request.log.warn({ err: convDelErr }, 'conversations deletion failed (continuing)');
        }
        // Also remove any participant rows for this user in other conversations
        const { error: partUserErr } = await sAdmin
          .from('conversation_participants')
          .delete()
          .eq('user_id', request.userId);
        if (partUserErr) request.log.warn({ err: partUserErr }, 'participant rows for user deletion failed (continuing)');
      } catch (e: any) {
        request.log.warn({ err: e?.message || e }, 'conversations cascade deletion threw (continuing)');
      }

      // Attempt admin deletion of auth user
      let adminDeleted = false;
      try {
        const { error: adminError } = await sAdmin.auth.admin.deleteUser(request.userId);
        if (adminError) {
          request.log.warn({ err: adminError }, 'admin.deleteUser failed, will fallback');
        } else {
          adminDeleted = true;
        }
      } catch (e: any) {
        request.log.warn({ err: e?.message || e }, 'admin.deleteUser threw, will fallback');
      }

      // Fallback: delete profile row if still present
      if (!adminDeleted) {
        const { error: profileErr } = await sAdmin
          .from('profiles')
          .delete()
          .eq('id', request.userId);
        if (profileErr) {
          return reply.code(500).send({ success: false, message: `Failed to delete account: ${profileErr.message}` });
        }
      }

      // Also remove from local API service users table if it exists
      try {
        await db.delete(users).where(eq(users.id, request.userId));
      } catch (e) {
        // non-fatal
      }

      return { success: true, message: 'Account deletion completed successfully.' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error deleting account';
      return reply.code(500).send({ success: false, message });
    }
  });

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

    // WebSocket route for messaging
    fastify.get('/messages/subscribe', { websocket: true }, async (connection: any, req: any) => {
      console.log('💬 New WebSocket connection for messaging');
      
      // Extract token from query string or headers
      const token = req.query?.token || req.headers?.authorization?.replace('Bearer ', '');
      
      if (!token) {
        connection.socket.send(JSON.stringify({
          type: 'error',
          message: 'Authentication required. Provide token in query string or Authorization header.',
          timestamp: new Date().toISOString()
        }));
        connection.socket.close();
        return;
      }

      // Authenticate the connection
      const auth = await wsMessagingService.authenticateConnection(token);
      
      if (!auth) {
        connection.socket.send(JSON.stringify({
          type: 'error',
          message: 'Authentication failed. Invalid or expired token.',
          timestamp: new Date().toISOString()
        }));
        connection.socket.close();
        return;
      }

      const { userId } = auth;

      // Get user's conversations
      const { conversationParticipants } = await import('./db/schema');
      const { eq, and, sql } = await import('drizzle-orm');
      
      const userConvs = await db
        .select({ conversation_id: conversationParticipants.conversation_id })
        .from(conversationParticipants)
        .where(
          and(
            eq(conversationParticipants.user_id, userId),
            sql`${conversationParticipants.deleted_at} IS NULL`
          )
        );

      const conversationIds = (userConvs as Array<{ conversation_id: string }>).map((c) => c.conversation_id);

      // Add client to messaging service
      await wsMessagingService.addClient(userId, connection, conversationIds);
      
      // Send connection confirmation
      connection.socket.send(JSON.stringify({
        type: 'connected',
        message: 'Connected to BountyExpo messaging',
        userId,
        conversationIds,
        timestamp: new Date().toISOString()
      }));

      // Handle incoming messages from client
      connection.socket.on('message', async (message: any) => {
        try {
          const data = JSON.parse(message.toString());
          
          switch (data.type) {
            case 'join':
              // Join a conversation room
              if (data.conversationId) {
                wsMessagingService.joinRoom(userId, data.conversationId);
              }
              break;
              
            case 'leave':
              // Leave a conversation room
              if (data.conversationId) {
                wsMessagingService.leaveRoom(userId, data.conversationId);
              }
              break;
              
            case 'typing':
              // Handle typing indicator
              if (data.conversationId) {
                wsMessagingService.handleTyping(userId, data.conversationId, data.isTyping || false);
              }
              break;
              
            default:
              console.log(`Unknown message type: ${data.type}`);
          }
        } catch (error) {
          console.error('Error handling WebSocket message:', error);
        }
      });
    });
  });
};

// Health check endpoint (no auth required)
fastify.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    // Test database connection with simple query
    const { Pool } = require('pg');
    const { getServiceStatus } = require('./services/idempotency-service');
    
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query('SELECT 1');
    await pool.end();
    
    // Get idempotency service status
    const idempotencyStatus = getServiceStatus();
    
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      service: 'bountyexpo-api',
      database: 'connected',
      idempotency: {
        backend: idempotencyStatus.backend,
        connected: idempotencyStatus.connected,
      }
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
}, async (request: AuthenticatedRequest, reply: FastifyReply) => {
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
}, async (request: AuthenticatedRequest, reply: FastifyReply) => {
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
}, async (request: AuthenticatedRequest, reply: FastifyReply) => {
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

// Post progress update endpoint
fastify.post('/bounties/:bountyId/updates', {
  preHandler: authMiddleware
}, async (request: AuthenticatedRequest, reply: FastifyReply) => {
  try {
    const { bountyId } = request.params as { bountyId: string };
    const { message, attachments } = request.body as { message: string; attachments?: any[] };
    
    if (!request.userId) {
      return reply.code(401).send({ error: 'User ID not found in token' });
    }

    if (!message || message.trim().length === 0) {
      return reply.code(400).send({ error: 'Update message is required' });
    }

    // For now, we'll store progress updates as messages in the conversation
    // This could be extended to a dedicated progress_updates table if needed
    const result = {
      success: true,
      bountyId,
      message,
      attachments: attachments || [],
      timestamp: new Date().toISOString(),
    };

    logger.info('Progress update posted', { bountyId, userId: request.userId });
    
    return { 
      message: 'Progress update posted successfully', 
      data: result,
    };
  } catch (error) {
    console.error('Error in /bounties/:bountyId/updates endpoint:', error);
    return reply.code(500).send({ 
      error: 'Failed to post progress update' 
    });
  }
});

// Approve bounty completion endpoint
fastify.post('/bounties/:bountyId/approve', {
  preHandler: authMiddleware
}, async (request: AuthenticatedRequest, reply: FastifyReply) => {
  try {
    const { bountyId } = request.params as { bountyId: string };
    const { rating, comment } = request.body as { rating?: number; comment?: string };
    
    if (!request.userId) {
      return reply.code(401).send({ error: 'User ID not found in token' });
    }

    // Verify user is the bounty poster
    const bounty = await bountyService.getById(bountyId);
    if (!bounty) {
      return reply.code(404).send({ error: 'Bounty not found' });
    }

    if (bounty.user_id !== request.userId && bounty.poster_id !== request.userId) {
      return reply.code(403).send({ error: 'Only the bounty poster can approve completion' });
    }

    // Update bounty status to completed
    const result = await bountyService.update(bountyId, { status: 'completed' });
    
    if (!result) {
      return reply.code(400).send({ error: 'Failed to approve completion' });
    }

    logger.info('Bounty completion approved', { bountyId, userId: request.userId, rating });

    return { 
      message: 'Bounty completion approved successfully', 
      bountyId,
      rating,
    };
  } catch (error) {
    console.error('Error in /bounties/:bountyId/approve endpoint:', error);
    return reply.code(500).send({ 
      error: 'Failed to approve bounty completion' 
    });
  }
});

// Request changes to bounty completion endpoint
fastify.post('/bounties/:bountyId/request-changes', {
  preHandler: authMiddleware
}, async (request: AuthenticatedRequest, reply: FastifyReply) => {
  try {
    const { bountyId } = request.params as { bountyId: string };
    const { feedback } = request.body as { feedback: string };
    
    if (!request.userId) {
      return reply.code(401).send({ error: 'User ID not found in token' });
    }

    if (!feedback || feedback.trim().length === 0) {
      return reply.code(400).send({ error: 'Feedback is required' });
    }

    // Verify user is the bounty poster
    const bounty = await bountyService.getById(bountyId);
    if (!bounty) {
      return reply.code(404).send({ error: 'Bounty not found' });
    }

    if (bounty.user_id !== request.userId && bounty.poster_id !== request.userId) {
      return reply.code(403).send({ error: 'Only the bounty poster can request changes' });
    }

    // For now, we'll just log the request
    // In a full implementation, this would update the submission status
    const result = {
      success: true,
      bountyId,
      feedback,
      timestamp: new Date().toISOString(),
    };

    logger.info('Revision requested for bounty', { bountyId, userId: request.userId });

    return { 
      message: 'Revision request sent successfully', 
      data: result,
    };
  } catch (error) {
    console.error('Error in /bounties/:bountyId/request-changes endpoint:', error);
    return reply.code(500).send({ 
      error: 'Failed to request changes' 
    });
  }
});

// Cancel/refund bounty endpoint
fastify.post('/bounties/:bountyId/cancel', {
  preHandler: authMiddleware
}, async (request: AuthenticatedRequest, reply: FastifyReply) => {
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
}, async (request: AuthenticatedRequest, reply: FastifyReply) => {
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
}, async (request: AuthenticatedRequest, reply: FastifyReply) => {
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
}, async (request: AuthenticatedRequest, reply: FastifyReply) => {
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
fastify.get('/events/subscribe-info', async (request: FastifyRequest, reply: FastifyReply) => {
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
fastify.get('/events/stats', async (request: FastifyRequest, reply: FastifyReply) => {
  const eventStats = realtimeService.getStats();
  const messagingStats = wsMessagingService.getStats();
  return {
    events: eventStats,
    messaging: messagingStats,
    timestamp: new Date().toISOString()
  };
});

// Messaging stats endpoint
fastify.get('/messages/stats', async (request: FastifyRequest, reply: FastifyReply) => {
  const stats = wsMessagingService.getStats();
  return {
    ...stats,
    timestamp: new Date().toISOString()
  };
});
// Root endpoint
fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
  return {
    message: 'BountyExpo API - Complete Escrow Payment Flow',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      me: '/me (requires auth)',
      acceptBounty: '/bounties/:bountyId/accept (requires auth)',
      completeBounty: '/bounties/:bountyId/complete (requires auth)',
      postUpdate: '/bounties/:bountyId/updates (requires auth)',
      approveCompletion: '/bounties/:bountyId/approve (requires auth)',
      requestChanges: '/bounties/:bountyId/request-changes (requires auth)',
      cancelBounty: '/bounties/:bountyId/cancel (requires auth)',
      stripeOnboardingLink: '/stripe/connect/onboarding-link (requires auth)',
      stripeConnectStatus: '/stripe/connect/status (requires auth)',
      validatePayment: '/stripe/validate-payment (requires auth)',
      walletBalance: '/wallet/balance (requires auth)',
      walletTransactions: '/wallet/transactions (requires auth)',
      walletDeposit: 'POST /wallet/deposit (requires auth)',
      walletWithdraw: 'POST /wallet/withdraw (requires auth)',
      walletEscrow: 'POST /wallet/escrow (requires auth) - Create escrow for bounty',
      walletRelease: 'POST /wallet/release (requires auth) - Release funds to hunter',
      walletRefund: 'POST /wallet/refund (requires auth) - Refund on cancellation',
      connectVerify: 'POST /connect/verify-onboarding (requires auth)',
      connectAccountLink: 'POST /connect/create-account-link (requires auth)',
      connectTransfer: 'POST /connect/transfer (requires auth)',
      eventsSubscribe: '/events/subscribe (WebSocket endpoint)',
      eventsSubscribeInfo: '/events/subscribe-info',
      eventsStats: '/events/stats',
      messagesSubscribe: '/messages/subscribe (WebSocket endpoint, requires auth token)',
      conversations: '/api/conversations (requires auth)',
      conversationMessages: '/api/conversations/:id/messages (requires auth)',
      sendMessage: 'POST /api/conversations/:id/messages (requires auth)',
      createConversation: 'POST /api/conversations (requires auth)',
      updateMessageStatus: 'POST /api/conversations/:id/messages/status (requires auth)',
      typing: 'POST /api/conversations/:id/typing (requires auth)',
    },
    features: {
      escrow: 'Automatic escrow on bounty posting with Stripe PaymentIntent',
      release: 'Automatic fund release on completion with 5% platform fee',
      refund: 'Full refund on cancellation with Stripe refund processing',
      stripeConnect: 'Stripe Connect onboarding for hunters',
      walletTransactions: 'Real wallet transaction history from database',
      balanceUpdates: 'Real-time balance updates on escrow/release/refund',
      paymentIntentStorage: 'PaymentIntent ID stored in bounty record',
      emailReceipts: 'Email receipts for all transactions',
      errorHandling: 'Comprehensive error handling with retries',
      edgeCases: 'Validation for insufficient funds and unverified accounts',
      messaging: 'Real-time messaging with WebSocket support',
      pushNotifications: 'Push notifications for offline users',
      presence: 'Online/offline presence tracking',
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

    // Register Wallet routes for transactions and balance
    await registerWalletRoutes(fastify);

    await startServer();
    await fastify.listen({ port, host });
    console.log(`🚀 BountyExpo API server listening on ${host}:${port}`);
    console.log(`📡 WebSocket server available at ws://${host}:${port}/events/subscribe`);
    
    // Start scheduled risk assessment jobs
    try {
      riskAssessmentCron.start();
      console.log('🕐 Risk assessment cron started');
    } catch (cronErr) {
      console.warn('⚠️  Failed to start risk assessment cron:', cronErr);
    }
    
    // If Supabase mode is enabled, avoid pinging the Postgres pool (this
    // prevents ECONNRESET/ECONNREFUSED logs when legacy DB envs point at
    // a different DB type or closed port). Start the outbox worker and let
    // it use Supabase via the OutboxService when configured.
    if (STARTUP_USE_SUPABASE) {
      console.log('📦 Supabase mode detected - skipping direct Postgres ping and starting outbox worker');
      await outboxWorker.start(5000);
    } else {
      // Try a quick DB ping and start the outbox worker only if the DB is reachable.
      try {
        await pool.query('SELECT 1');
        console.log('📦 Database reachable - starting outbox worker');
        await outboxWorker.start(5000); // Process events every 5 seconds
      } catch (err) {
        // Provide actionable hints for common connection failures (ECONNREFUSED/ECONNRESET)
        const maybeErr = err as any;
        if (maybeErr && typeof maybeErr === 'object' && maybeErr.code === 'ECONNRESET') {
          console.warn('⚠️  Outbox worker disabled due to database connection issues: ECONNRESET (connection reset by peer)');
          console.warn('   Possible causes: connecting to the wrong database type/port (e.g., MySQL on port 3306), network/firewall terminating the connection, or TLS/SSL mismatch.');
          console.warn('   Check that your env vars point to a PostgreSQL instance (DATABASE_URL or DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME).');
        } else if (maybeErr && typeof maybeErr === 'object' && maybeErr.code === 'ECONNREFUSED') {
          console.warn('⚠️  Outbox worker disabled due to database connection issues: ECONNREFUSED (connection refused)');
          console.warn('   Possible causes: database is not running, wrong host/port, or firewall blocking it. Verify DATABASE_URL and DB_* env vars.');
        } else {
          console.warn(`⚠️  Outbox worker disabled due to database connection issues: ${err instanceof Error ? err.message : String(err)}`);
        }
        console.warn('   To fix: set a valid PostgreSQL DATABASE_URL in your .env (e.g., postgres://user:pass@host:5432/dbname) or correct DB_* env vars.');
      }
    }
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  
  // Stop cron jobs
  try {
    riskAssessmentCron.stop();
    console.log('🛑 Risk assessment cron stopped');
  } catch {}
  
  // Stop the outbox worker
  outboxWorker.stop();
  
  // Flush analytics events
  await backendAnalytics.flush();
  
  await fastify.close();
  process.exit(0);
});

start();