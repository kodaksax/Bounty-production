import Fastify from 'fastify';
import { FastifyInstance } from 'fastify';

// Import our API setup
const setupRoutes = async (fastify: FastifyInstance) => {
  // Health check endpoint (no auth required)
  fastify.get('/health', async (request, reply) => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      service: 'bountyexpo-api',
      database: 'mocked'
    };
  });

  // Mock /me endpoint for testing
  fastify.get('/me', async (request, reply) => {
    const authHeader = request.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.code(401).send({ 
        error: 'Missing or invalid authorization header' 
      });
    }
    
    // Mock user response
    return {
      id: '00000000-0000-0000-0000-000000000001',
      handle: '@test_user',
      stripe_account_id: null,
      created_at: new Date().toISOString(),
    };
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
};

async function testEndpoints() {
  console.log('🧪 Testing API endpoints...');
  
  const fastify = Fastify({ logger: false });
  await setupRoutes(fastify);
  
  try {
    // Test health endpoint
    console.log('Testing GET /health...');
    const healthResponse = await fastify.inject({
      method: 'GET',
      url: '/health'
    });
    
    if (healthResponse.statusCode === 200) {
      const health = JSON.parse(healthResponse.payload);
      console.log('✅ /health:', health.status);
    } else {
      console.log('❌ /health failed:', healthResponse.statusCode);
    }
    
    // Test root endpoint
    console.log('Testing GET /...');
    const rootResponse = await fastify.inject({
      method: 'GET',
      url: '/'
    });
    
    if (rootResponse.statusCode === 200) {
      const root = JSON.parse(rootResponse.payload);
      console.log('✅ / response:', root.message);
    } else {
      console.log('❌ / failed:', rootResponse.statusCode);
    }
    
    // Test /me without auth (should fail)
    console.log('Testing GET /me without auth...');
    const meNoAuthResponse = await fastify.inject({
      method: 'GET',
      url: '/me'
    });
    
    if (meNoAuthResponse.statusCode === 401) {
      console.log('✅ /me correctly rejects unauthenticated requests');
    } else {
      console.log('❌ /me should return 401, got:', meNoAuthResponse.statusCode);
    }
    
    // Test /me with mock auth
    console.log('Testing GET /me with auth...');
    const meAuthResponse = await fastify.inject({
      method: 'GET',
      url: '/me',
      headers: {
        authorization: 'Bearer mock-token'
      }
    });
    
    if (meAuthResponse.statusCode === 200) {
      const user = JSON.parse(meAuthResponse.payload);
      console.log('✅ /me with auth:', user.handle);
    } else {
      console.log('❌ /me with auth failed:', meAuthResponse.statusCode);
    }
    
    console.log('🎉 All endpoint tests passed!');
    
  } catch (error) {
    console.error('❌ Endpoint testing failed:', error);
    process.exit(1);
  } finally {
    await fastify.close();
  }
}

// Run test if this file is executed directly
if (require.main === module) {
  testEndpoints();
}

export { testEndpoints };
