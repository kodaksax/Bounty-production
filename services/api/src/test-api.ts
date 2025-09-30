import Fastify from 'fastify';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const fastify = Fastify({
  logger: true
});

// Mock services for testing
const mockBountyService = {
  async acceptBounty(bountyId: string, hunterId: string) {
    console.log(`🎯 Mock: Accepting bounty ${bountyId} by hunter ${hunterId}`);
    return { success: true };
  },
  
  async completeBounty(bountyId: string, completedBy: string) {
    console.log(`🏆 Mock: Completing bounty ${bountyId} by ${completedBy}`);
    return { success: true };
  }
};

// Mock outbox worker
const mockOutboxWorker = {
  async start() {
    console.log('📦 Mock: Outbox worker started');
  },
  stop() {
    console.log('📦 Mock: Outbox worker stopped');
  }
};

// Health check endpoint
fastify.get('/health', async (request, reply) => {
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    service: 'bountyexpo-api-test',
    database: 'mocked'
  };
});

// Mock auth middleware for testing
const mockAuthMiddleware = async (request: any, reply: any) => {
  // Mock user ID for testing
  request.userId = 'test-user-123';
};

// Accept bounty endpoint
fastify.post('/bounties/:bountyId/accept', {
  preHandler: mockAuthMiddleware
}, async (request: any, reply) => {
  try {
    const { bountyId } = request.params as { bountyId: string };
    
    const result = await mockBountyService.acceptBounty(bountyId, request.userId);
    
    if (!result.success) {
      return reply.code(400).send({ error: 'Failed to accept bounty' });
    }

    return { message: 'Bounty accepted successfully', bountyId };
  } catch (error) {
    console.error('Error in accept endpoint:', error);
    return reply.code(500).send({ 
      error: 'Failed to accept bounty' 
    });
  }
});

// Complete bounty endpoint
fastify.post('/bounties/:bountyId/complete', {
  preHandler: mockAuthMiddleware
}, async (request: any, reply) => {
  try {
    const { bountyId } = request.params as { bountyId: string };
    
    const result = await mockBountyService.completeBounty(bountyId, request.userId);
    
    if (!result.success) {
      return reply.code(400).send({ error: 'Failed to complete bounty' });
    }

    return { message: 'Bounty completed successfully', bountyId };
  } catch (error) {
    console.error('Error in complete endpoint:', error);
    return reply.code(500).send({ 
      error: 'Failed to complete bounty' 
    });
  }
});

// Root endpoint
fastify.get('/', async (request, reply) => {
  return {
    message: 'BountyExpo API (Test Mode)',
    version: '1.0.0',
    mode: 'testing',
    endpoints: {
      health: '/health',
      acceptBounty: '/bounties/:bountyId/accept',
      completeBounty: '/bounties/:bountyId/complete',
    }
  };
});

// Start server
const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3001', 10);
    const host = process.env.HOST || '0.0.0.0';
    
    await fastify.listen({ port, host });
    console.log(`🚀 BountyExpo Test API server listening on ${host}:${port}`);
    
    // Start the mock outbox worker
    await mockOutboxWorker.start();
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  
  // Stop the mock outbox worker
  mockOutboxWorker.stop();
  
  await fastify.close();
  process.exit(0);
});

start();