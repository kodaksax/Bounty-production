import * as fs from 'fs';
import * as path from 'path';

const read = (relativePath: string) =>
  fs.readFileSync(path.join(__dirname, '../../', relativePath), 'utf8');

const migration = read('supabase/migrations/20260808000000_add_posthog_person_property_sync.sql');
const dispatcher = read('supabase/functions/process-analytics-person/index.ts');
const mobilePostHog = read('lib/posthog.ts');

describe('PostHog person property contract', () => {
  test.each([
    'role',
    'signup_date',
    'onboarding_completed_at',
    'bounties_posted',
    'paid_bounties_posted',
    'bounties_claimed',
    'bounties_completed',
    'lifetime_gmv',
    'is_identity_verified',
    'has_payment_method',
    'has_stripe_connect',
    'home_region',
    'is_internal',
  ])('server snapshot includes %s', property => {
    expect(migration).toContain(`'${property}'`);
  });

  it('keys lifetime facts by user, metric, and authoritative source', () => {
    expect(migration).toContain('PRIMARY KEY (user_id, metric, source_id)');
    expect(migration).toContain('ON CONFLICT DO NOTHING');
  });

  it('captures facts from authoritative database transitions', () => {
    expect(migration).toContain('AFTER INSERT OR UPDATE OF status ON public.bounties');
    expect(migration).toContain('AFTER INSERT OR UPDATE OF status ON public.bounty_requests');
    expect(migration).toContain('AFTER INSERT OR UPDATE OF status ON public.wallet_transactions');
    expect(migration).toContain("NEW.status::text = 'accepted'");
    expect(migration).toContain("NEW.type = 'release'");
  });

  it('queues the timestamp produced by an onboarding completion transition', () => {
    expect(migration).toContain(
      'UPDATE OF email, primary_role, onboarding_completed, onboarding_completed_at'
    );
  });

  it('retries lost in-flight dispatches without blocking mutations', () => {
    expect(migration).toContain("status IN ('pending', 'sending', 'failed')");
    expect(migration).toContain('FOR UPDATE SKIP LOCKED');
    expect(migration).toContain('attempts = attempts + 1');
    expect(migration).toContain('PERFORM net.http_post(');
  });

  it('sends internal status on both the event and person payloads', () => {
    expect(dispatcher).toContain('is_internal: outbox.properties.is_internal');
    expect(dispatcher).toContain('$set: outbox.properties');
    expect(mobilePostHog).toContain('_posthog.register({ is_internal: isInternalEmail(email) })');
  });

  it('does not acknowledge an older snapshot over a newer queued update', () => {
    expect(dispatcher).toContain(".eq('updated_at', outbox.updated_at)");
  });

  it('bounds outbound PostHog requests', () => {
    expect(dispatcher).toContain('signal: AbortSignal.timeout(10_000)');
    expect(dispatcher).not.toContain('await posthogResponse.text()');
  });

  it('does not emit address-like profile locations', () => {
    expect(migration).toContain("p_location !~ '[0-9]'");
    expect(migration).toContain('Free-form values that may contain a street address');
  });

  it('keeps the mobile and server internal-account policies aligned', () => {
    for (const email of [
      'jordanmag11@yahoo.com',
      'leewright093@gmail.com',
      'support@bountyfinder.app',
      'posterbnty158@gmail.com',
      'hunterbnty158@gmail.com',
    ]) {
      expect(migration).toContain(email);
      expect(mobilePostHog).toContain(email);
    }
    expect(migration).toContain("LIKE '%bountyfinder%'");
    expect(mobilePostHog).toContain("includes('bountyfinder')");
  });
});
