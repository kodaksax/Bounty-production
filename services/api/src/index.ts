import Fastify from 'fastify';
import dotenv from 'dotenv';
import { db } from './db/connection';
import { users } from './db/schema';
import { authMiddleware, optionalAuthMiddleware, AuthenticatedRequest } from './middleware/auth';
import { eq } from 'drizzle-orm';

// Load environment variables
dotenv.config();

const fastify = Fastify({
  logger: true
});

// Health check endpoint (no auth required)
fastify.get('/health', async (request, reply) => {
  try {
    // Test database connection
    await db.select().from(users).limit(1);
    
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

// Root endpoint
fastify.get('/', async (request, reply) => {
  return {
    message: 'BountyExpo API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      me: '/me (requires auth)',
    }
  };
});

// Start server
const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3001', 10);
    const host = process.env.HOST || '0.0.0.0';
    
    await fastify.listen({ port, host });
    console.log(`🚀 BountyExpo API server listening on ${host}:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await fastify.close();
  process.exit(0);
});

start();