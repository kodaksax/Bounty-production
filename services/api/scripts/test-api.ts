import path from 'path';
// Load environment
try {
  const loadEnvPath = path.resolve(__dirname, '..', '..', '..', 'scripts', 'load-env.js');
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  const loadEnvMod = require(loadEnvPath);
  if (loadEnvMod && typeof loadEnvMod.loadEnv === 'function') {
    loadEnvMod.loadEnv(path.resolve(__dirname, '..', '..'));
  }
} catch (err) {
  // ignore
}

import Fastify from 'fastify';

const fastify = Fastify({ logger: false });

// Minimal mock services for local testing
const mockBountyService = {
  async acceptBounty(bountyId: string, userId: string) {
    console.log(`Mock: acceptBounty ${bountyId} by ${userId}`);
    return { success: true };
  },
  async completeBounty(bountyId: string, userId: string) {
    console.log(`Mock: completeBounty ${bountyId} by ${userId}`);
    return { success: true };
  }
};

fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

// Mock auth middleware
fastify.addHook('preHandler', async (request: any, reply) => {
  request.userId = 'test-user-123';
});

fastify.post('/bounties/:bountyId/accept', async (request: any, reply: any) => {
  const { bountyId } = request.params as { bountyId: string };
  const result = await mockBountyService.acceptBounty(bountyId, request.userId);
  if (!result.success) return reply.code(400).send({ error: 'Failed' });
  return { message: 'ok', bountyId };
});

fastify.post('/bounties/:bountyId/complete', async (request: any, reply: any) => {
  const { bountyId } = request.params as { bountyId: string };
  const result = await mockBountyService.completeBounty(bountyId, request.userId);
  if (!result.success) return reply.code(400).send({ error: 'Failed' });
  return { message: 'ok', bountyId };
});

async function start() {
  const port = parseInt(process.env.PORT || '3001', 10);
  const host = process.env.HOST || '127.0.0.1';
  await fastify.listen({ port, host });
  console.log(`Test API listening on ${host}:${port}`);
}

if (require.main === module) start().catch(err => { console.error(err); process.exit(1); });
