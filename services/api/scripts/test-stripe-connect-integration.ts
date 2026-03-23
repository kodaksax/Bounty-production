import path from 'path';

// Load environment using shared loader (dynamic require to avoid TS rootDir issues)
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  const loadEnvPath = path.resolve(__dirname, '..', '..', '..', 'scripts', 'load-env.js');
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  const loadEnvMod = require(loadEnvPath);
  if (loadEnvMod && typeof loadEnvMod.loadEnv === 'function') {
    loadEnvMod.loadEnv(path.resolve(__dirname, '..', '..'));
  }
} catch (err) {
  // ignore
}

import { stripeConnectService } from '../src/services/stripe-connect-service';

async function run() {
  console.log('🚀 Running Stripe Connect Integration Test (scripts/test-stripe-connect-integration.ts)');

  const key = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_TEST_KEY;
  if (!key) {
    console.log('\n⚠️  STRIPE_SECRET_KEY / STRIPE_TEST_KEY not set. Skipping live integration tests.');
    return;
  }

  try {
    const mockUserId = 'test-user-123';
    console.log('\n📝 Creating onboarding link...');
    const onboarding = await stripeConnectService.createOnboardingLink({
      userId: mockUserId,
      refreshUrl: 'http://localhost:3000/onboarding/refresh',
      returnUrl: 'http://localhost:3000/onboarding/return',
    });
    console.log('✅ Onboarding link:', onboarding.url);

    console.log('\n📊 Retrieving connect status...');
    const status = await stripeConnectService.getConnectStatus(mockUserId);
    console.log('✅ Connect status:', JSON.stringify(status, null, 2));

    console.log('\n🎣 Webhook handler smoke test (missing secret will surface an error message)');
    try {
      await stripeConnectService.handleWebhook(Buffer.from('{}'), 'whsec_test');
    } catch (err) {
      console.log('✅ Webhook handler responded (expected in many environments):', err && (err as Error).message);
    }

    console.log('\n🎉 Stripe integration script completed');
  } catch (err) {
    console.error('❌ Stripe integration test failed:', err);
    process.exit(1);
  }
}

if (require.main === module) run().catch(err => { console.error(err); process.exit(1); });
