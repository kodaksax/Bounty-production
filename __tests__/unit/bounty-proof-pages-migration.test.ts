import { readFileSync } from 'fs';
import { join } from 'path';

// Completed-bounty proof pages (bountyfinder.net/proof). This pins the privacy
// and consent contract so a later edit can't quietly publish without consent,
// widen what the public sees, or open the tables to clients. Behaviour still
// needs a run on staging (see the migration header).
const root = join(__dirname, '../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const sql = read('supabase/migrations/20261027120000_bounty_proof_pages.sql');
const down = read('supabase/rollbacks/production/20261027120000_bounty_proof_pages.down.sql');
const edge = read('supabase/functions/proof-pages/index.ts');
const posterWeb = read('supabase/functions/poster-web/index.ts');
const config = read('supabase/config.toml');
const manifest = JSON.parse(read('supabase/security/rls-manifest.json'));

/** Body of a CREATE FUNCTION up to its closing dollar quote. */
function fnBody(name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start).toBeGreaterThan(-1);
  const open = sql.indexOf('AS $', start);
  const tag = sql.slice(open + 3, sql.indexOf('$', open + 4) + 1);
  const end = sql.indexOf(tag, open + 3 + tag.length);
  return sql.slice(start, end + tag.length);
}

const view = sql.slice(sql.indexOf('CREATE OR REPLACE VIEW public.bounty_proof_public_v'), sql.indexOf('REVOKE ALL ON TABLE public.bounty_proof_public_v'));

describe('proof pages migration: eligibility', () => {
  const eligibility = fnBody('fn_proof_eligibility');

  it.each([
    ["b.status::text <> 'completed'", 'not_completed'],
    ['COALESCE(b.is_test, false)', 'test_bounty'],
    ["b.work_type::text IS DISTINCT FROM 'in_person'", 'not_in_person'],
    ['COALESCE(b.is_for_honor, false) OR b.amount IS NULL OR b.amount <= 0', 'no_cash_reward'],
    ['fn_proof_city_label(b.location) IS NULL', 'no_public_city'],
    ["q.status::text = 'accepted'", 'no_accepted_hunter'],
    ["s.status = 'approved'", 'no_approved_completion'],
    ['FROM public.bounty_disputes d', 'disputed'],
    ["COALESCE(c.status, '') <> 'rejected'", 'cancellation'],
    ["bp.status IN ('refund_pending', 'refunded')", 'refunded'],
    ["m.state NOT IN ('active', 'approved')", 'moderation'],
    ['COALESCE(pr.is_internal, false)', 'poster_account'],
  ])('checks %s (%s)', (condition, reason) => {
    expect(eligibility).toContain(condition);
    expect(eligibility).toContain(`'${reason}'`);
  });

  it('shows only a "City, ST" label, never an address', () => {
    const label = fnBody('fn_proof_city_label');
    expect(label).toContain("'^[A-Za-z][A-Za-z .''-]{0,39}, [A-Z]{2}$'");
    expect(sql).not.toMatch(/FROM\s+public\.bounty_private_locations/);
    expect(view).not.toMatch(/\b(address|latitude|longitude|approx_latitude|neighborhood|zip_code|description)\b/);
  });

  it('is checked on every public read, not only at publish time', () => {
    expect(view).toContain('cardinality(public.fn_proof_eligibility(b.id)) = 0');
    expect(view).toContain('WHERE p.consent_task');
    expect(view).toContain('AND p.published_at IS NOT NULL');
    expect(view).toContain('AND p.revoked_at IS NULL');
  });
});

describe('proof pages migration: consent', () => {
  const guard = fnBody('fn_bounty_proofs_guard');
  const setConsent = fnBody('proof_poster_set_consent');
  const publish = fnBody('proof_admin_publish');

  it('withdrawing a permission clears what was published, with nobody involved', () => {
    expect(guard).toContain('IF NEW.consent_task IS DISTINCT FROM true THEN');
    expect(guard).toContain("NEW.revoke_reason := COALESCE(NEW.revoke_reason, 'poster_withdrew_consent')");
    expect(guard).toMatch(/IF NOT NEW\.consent_photos THEN\s+NEW\.published_photos := '\[\]'::jsonb;/);
    expect(guard).toContain('NEW.testimonial IS DISTINCT FROM OLD.testimonial');
    expect(guard).toContain('NEW.attribution_name IS DISTINCT FROM OLD.attribution_name');
    expect(guard).toContain("RAISE EXCEPTION 'bounty_proofs.public_id is permanent'");
  });

  it('only the poster can answer, and saying yes again goes back to review', () => {
    expect(setConsent).toContain('COALESCE(b.poster_id, b.user_id) = v_uid');
    expect(setConsent).toContain("USING ERRCODE = 'P0002'");
    expect(setConsent).toContain("revoked_at          = CASE WHEN p_share_task THEN NULL ELSE revoked_at END");
    // It never sets published_at: only a reviewer does.
    expect(setConsent).not.toMatch(/published_at\s*=/);
  });

  it('a quote is plain text for every writer, not only poster-web', () => {
    expect(setConsent).toContain("'</?[A-Za-z!][^<>]*>', ' ', 'g'), '[<>]', '', 'g')");
    expect(sql).toContain("testimonial IS NULL OR (char_length(testimonial) BETWEEN 1 AND 600 AND testimonial !~ '[<>]')");
  });

  it('publishing needs a reviewer, the poster\'s yes, and current eligibility', () => {
    expect(publish).toContain("public.is_admin() OR auth.role() = 'service_role'");
    expect(publish).toContain('p.consent_task IS DISTINCT FROM true');
    expect(publish).toContain('cardinality(v_reasons) > 0');
    expect(publish).toContain('jsonb_array_length(p_photos) > 0 AND NOT p.consent_photos');
    expect(publish).toContain('CASE WHEN p_include_testimonial AND p.consent_testimonial THEN p.testimonial END');
  });

  it('photos: only this bounty\'s own files, browser formats, alt text, before/after as a pair', () => {
    expect(publish).toContain("'^bounties/' || p_bounty_id::text || '/[A-Za-z0-9._/ -]+\\.(jpe?g|png|webp)$'");
    expect(publish).toContain("v_path ~ '\\.\\.'");
    expect(publish).toContain('NOT BETWEEN 8 AND 200');
    expect(publish).toContain("('before' = ANY (v_roles)) <> ('after' = ANY (v_roles))");
  });
});

describe('proof pages migration: public surface', () => {
  it('returns no internal ids, paths or private fields', () => {
    expect(fnBody('proof_public_get')).toContain("to_jsonb(me) - 'bounty_id'");
    expect(view).toContain("jsonb_build_object('n', ph.n - 1, 'role', ph.v->>'role', 'alt', ph.v->>'alt')");
    expect(view).not.toMatch(/'path'/);
    for (const name of ['proof_public_list', 'proof_public_index']) {
      expect(fnBody(name)).not.toMatch(/bounty_id|'path'|poster_id|user_id/);
    }
  });

  it('a hire time exists only when there was exactly one acceptance', () => {
    expect(view).toContain('WHEN acc.n = 1 THEN acc.first_at');
    expect(view).toContain('WHEN acc.n = 0 THEN');
    expect(view).not.toMatch(/WHEN acc\.n > 1/);
  });

  it('bounds every collection', () => {
    expect(fnBody('proof_public_list')).toContain('LEAST(GREATEST(COALESCE(p_limit, 24), 1), 48)');
    expect(fnBody('proof_public_index')).toContain('LIMIT 5000');
  });

  it('keeps tables, view and readers away from clients', () => {
    expect(sql).toContain('REVOKE ALL ON TABLE public.bounty_proofs FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('REVOKE ALL ON TABLE public.bounty_proof_public_v FROM PUBLIC, anon, authenticated;');
    for (const sig of ['proof_public_get(text)', 'proof_public_list(text, text[], integer, integer)', 'proof_public_index()', 'proof_public_photo(text, integer)']) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon, authenticated;`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${sig} TO service_role;`);
    }
    expect(manifest.protected.bounty_proofs).toEqual({
      policies: [], grants: { anon: [], authenticated: [] }, required_triggers: ['trg_bounty_proofs_guard'],
    });
    const forbidden = (sig: string) => manifest.functions.find((f: any) => f.signature === sig)?.forbid_execute;
    expect(forbidden('proof_public_get(text)')).toEqual(['anon', 'authenticated', 'PUBLIC']);
    expect(forbidden('proof_poster_set_consent(uuid,boolean,boolean,text,boolean,text,text,text)')).toEqual(['anon', 'PUBLIC']);
  });

  it('reviewer functions have no client grant at all', () => {
    for (const [sig, manifestSig] of [
      ['proof_admin_publish(uuid, jsonb, boolean, text)', 'proof_admin_publish(uuid,jsonb,boolean,text)'],
      ['proof_admin_unpublish(uuid, text)', 'proof_admin_unpublish(uuid,text)'],
      ['proof_admin_queue()', 'proof_admin_queue()'],
    ]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon, authenticated;`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${sig} TO service_role;`);
      expect(sql).not.toContain(`GRANT EXECUTE ON FUNCTION public.${sig} TO authenticated`);
      expect(manifest.functions.find((f: any) => f.signature === manifestSig)?.forbid_execute).toEqual(['anon', 'authenticated', 'PUBLIC']);
    }
  });

  it('the Edge Function never hands out a storage path', () => {
    expect(edge).toContain("db.storage.from('bounty-attachments').download(path)");
    expect(edge).not.toMatch(/createSignedUrl|getPublicUrl|Location:/);
    expect(edge).toMatch(/req\.method !== 'GET' && req\.method !== 'HEAD'/);
    expect(config).toMatch(/\[functions\.proof-pages\]\s+verify_jwt = false/);
    // A malformed city is a 400 (no-store), never a cacheable empty list.
    expect(edge).toContain("if (city !== null && !SLUG.test(city)) return json({ error: 'Invalid city' }, 400)");
  });

  it('poster-web acts as the user and logs no quote or name', () => {
    expect(posterWeb).toContain("asUser.rpc('proof_poster_set_consent'");
    expect(posterWeb).not.toContain("admin.rpc('proof_poster_set_consent'");
    // The pre-read's error is looked at, and a permission refusal is a 403.
    expect(posterWeb).toContain("const { data: before, error: beforeError } = await asUser.rpc('proof_poster_get'");
    expect(posterWeb).toMatch(/error\.code === '42501'[\s\S]{0,200}'forbidden' \}, 403\]/);
    const capture = posterWeb.slice(posterWeb.indexOf("capture(userId, 'proof_consent_recorded'"));
    expect(capture.slice(0, capture.indexOf('})'))).not.toMatch(/^\s*(testimonial|first_name|firstName):|input\.firstName|input\.testimonial,/m);
  });
});

describe('proof pages migration: asking the poster', () => {
  const ask = fnBody('fn_request_proof_consent');

  it('asks once per bounty, claimed in the same transaction as the send', () => {
    expect(ask).toContain('WHERE bounty_id = r.id AND consent_requested_at IS NULL AND consent_task IS NULL');
    expect(ask).toContain('RETURNING bounty_id INTO v_claimed');
    expect(ask).toMatch(/IF v_claimed IS NULL THEN\s+CONTINUE;/);
    expect(ask).toContain("BETWEEN now() - interval '30 days' AND now() - interval '24 hours'");
  });

  it('goes through the notification pipeline as its own type', () => {
    expect(ask).toContain('INSERT INTO public.notifications_outbox');
    expect(ask).toContain("'type', 'proof_consent_request'");
    expect(sql).toMatch(/'bounty_location_nudge', 'application_closure_digest',\s+'proof_consent_request'/);
    expect(read('supabase/functions/process-notification/index.ts')).toContain("proof_consent_request: 'marketing'");
    expect(read('lib/config/notification-taxonomy.ts')).toContain("proof_consent_request: 'marketing'");
  });

  it('is scheduled with a heartbeat', () => {
    expect(sql).toContain("SELECT cron.schedule('proof-consent-requests-hourly', '23 * * * *'");
    expect(sql).toContain("public.record_job_heartbeat('proof-consent-requests-hourly')");
  });
});

describe('proof pages rollback', () => {
  it('drops everything it added and restores the notification type list', () => {
    for (const obj of ['TABLE IF EXISTS public.bounty_proofs', 'VIEW IF EXISTS public.bounty_proof_public_v',
      'FUNCTION IF EXISTS public.fn_request_proof_consent(integer)', 'FUNCTION IF EXISTS public.proof_admin_publish(uuid, jsonb, boolean, text)']) {
      expect(down).toContain(`DROP ${obj}`);
    }
    expect(down).toContain("jobname = 'proof-consent-requests-hourly'");
    expect(down).not.toMatch(/'proof_consent_request'\s*\]::text\[\]/);
  });
});
