/* scripts/e2e-location-privacy-http.js
 *
 * End-to-end check of the location privacy fix THROUGH THE REAL API on
 * staging: PostgREST (REST + RPC), Realtime postgres_changes, and the public
 * share-bounty page. Complements scripts/verify-location-privacy.js (DB level,
 * always rolled back) by catching anything the HTTP layer adds.
 *
 * Creates throwaway users (poster, hunter, ordinary, admin) and one bounty
 * with a unique fake address, then scans every raw response body / realtime
 * payload for that address, its unit and its exact coordinates. Deletes the
 * fixtures at the end (also on failure).
 *
 * Requires the migration to be applied to staging first.
 *
 * Usage:
 *   node scripts/e2e-location-privacy-http.js        # staging only
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const ROOT = path.resolve(__dirname, '..');
const ENV = (process.argv.find((a) => a.startsWith('--env=')) || '--env=staging').slice(6);
if (ENV !== 'staging') {
  console.error('e2e-location-privacy-http only runs against staging (it creates and deletes fixtures).');
  process.exit(2);
}

function readEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(path.join(ROOT, file), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
const env = readEnv('.env.staging');
const URL_ = env.SUPABASE_URL || env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = env.SUPABASE_ANON_KEY || env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SERVICE) throw new Error('.env.staging needs SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY');
if (/xwlwqzzphmmhghiqvkeu/.test(URL_)) throw new Error('refusing: .env.staging points at the production project');

const tag = crypto.randomBytes(3).toString('hex');
const SECRET = {
  address: `61 Kxqv${tag} Lane, Pikesville, MD 21208, USA`,
  token: `Kxqv${tag}`,
  unit: `Apt ${tag}Z`,
  lat: 39.3791234,
  lng: -76.7232345,
};
const LEAK_TERMS = [SECRET.token, `${tag}Z`, String(SECRET.lat), String(SECRET.lng)];

const results = [];
function check(name, ok, info) {
  results.push({ name, ok: !!ok });
  const suffix = info !== undefined ? '  -- ' + (typeof info === 'string' ? info : JSON.stringify(info)) : '';
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${suffix}`);
}
const leaks = (text) => LEAK_TERMS.filter((t) => text.includes(t));

async function rest(pathAndQuery, { token = ANON, method = 'GET', body, prefer } = {}) {
  const res = await fetch(`${URL_}${pathAndQuery}`, {
    method,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, text: await res.text() };
}

async function main() {
  const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
  const created = { users: [], bountyId: null };
  const password = `Lp-${crypto.randomBytes(12).toString('hex')}`;

  const mkUser = async (label, appMetadata) => {
    const email = `locpriv-e2e+${label}-${tag}@example.test`;
    const { data, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, ...(appMetadata ? { app_metadata: appMetadata } : {}),
    });
    if (error) throw new Error(`createUser ${label}: ${error.message}`);
    created.users.push(data.user.id);
    const client = createClient(URL_, ANON, { auth: { persistSession: false } });
    const { data: s, error: e2 } = await client.auth.signInWithPassword({ email, password });
    if (e2) throw new Error(`signIn ${label}: ${e2.message}`);
    return { id: data.user.id, token: s.session.access_token, client };
  };

  try {
    const poster = await mkUser('poster');
    const hunter = await mkUser('hunter');
    const ordinary = await mkUser('ordinary');
    const adminUser = await mkUser('admin', { role: 'admin' });
    // profiles rows are normally created by the auth trigger; make sure they exist.
    for (const u of [poster, hunter, ordinary, adminUser]) {
      await admin.from('profiles').upsert({ id: u.id, username: `locpriv_${tag}_${u.id.slice(0, 4)}` }, { onConflict: 'id', ignoreDuplicates: true });
    }

    // Ordinary user listens to bounty changes the way the feed does.
    const realtimePayloads = [];
    const channel = ordinary.client
      .channel(`locpriv-${tag}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bounties' }, (p) => realtimePayloads.push(JSON.stringify(p)));
    await new Promise((resolve) => channel.subscribe((status) => status === 'SUBSCRIBED' && resolve()));

    // 1. Poster creates the bounty exactly like an installed (old) build does.
    const ins = await rest('/rest/v1/bounties?select=*', {
      token: poster.token, method: 'POST', prefer: 'return=representation',
      body: {
        title: `Carry boxes ${tag}`, description: 'Two boxes from the car to the second floor, ten minutes.',
        amount: 40, is_for_honor: false, poster_id: poster.id, user_id: poster.id, status: 'open',
        work_type: 'in_person', location: SECRET.address, latitude: SECRET.lat, longitude: SECRET.lng,
        unit: SECRET.unit, neighborhood: 'Pikesville',
      },
    });
    check('poster POST /bounties succeeds', ins.status === 201, ins.status === 201 ? undefined : ins.text.slice(0, 300));
    if (ins.status !== 201) throw new Error('cannot continue');
    created.bountyId = JSON.parse(ins.text)[0].id;
    check('POST response (return=representation) has no address/unit/coords', leaks(ins.text).length === 0, leaks(ins.text));

    // 2. Accept the hunter (service role, like the accept flow).
    const { error: accErr } = await admin.from('bounties').update({ status: 'in_progress', accepted_by: hunter.id }).eq('id', created.bountyId);
    check('fixture: hunter accepted', !accErr, accErr && accErr.message);

    // 3. Every caller, every shape.
    const callers = [['anon', ANON], ['ordinary', ordinary.token], ['admin', adminUser.token], ['hunter', hunter.token], ['poster', poster.token]];
    const id = created.bountyId;
    for (const [label, token] of callers) {
      for (const [shape, q] of [
        ['select=*', `/rest/v1/bounties?id=eq.${id}&select=*`],
        ['exact columns', `/rest/v1/bounties?id=eq.${id}&select=location,latitude,longitude,unit,geom,neighborhood`],
        ['list (feed-like)', `/rest/v1/bounties?select=*&order=created_at.desc&limit=50`],
        ['embedded via bounty_requests', `/rest/v1/bounty_requests?select=*,bounties(*)&limit=20`],
      ]) {
        const r = await rest(q, { token });
        check(`${label}: GET ${shape} -> no leak`, leaks(r.text).length === 0, `${r.status}${leaks(r.text).length ? ' ' + leaks(r.text) : ''}`);
      }
      const priv = await rest(`/rest/v1/bounty_private_locations?select=*`, { token });
      check(`${label}: GET bounty_private_locations is refused`, priv.status >= 400 || priv.text === '[]', `${priv.status} ${priv.text.slice(0, 80)}`);
      const rpc = await rest('/rest/v1/rpc/get_bounty_exact_location', { token, method: 'POST', body: { p_bounty_id: id } });
      const got = rpc.text.includes(SECRET.token);
      const shouldSee = label === 'poster' || label === 'hunter';
      check(`${label}: rpc get_bounty_exact_location -> ${shouldSee ? 'exact' : 'nothing'}`, got === shouldSee, `${rpc.status}`);
      const near = await rest('/rest/v1/rpc/search_bounties_nearby', {
        token, method: 'POST', body: { p_lat: SECRET.lat + 0.01, p_lng: SECRET.lng, p_radius_miles: 25, p_limit: 100 },
      });
      check(`${label}: rpc search_bounties_nearby -> no leak`, leaks(near.text).length === 0, `${near.status}`);
    }

    // 4. Public share page (service role inside the function, open to the web).
    const share = await fetch(`${URL_}/functions/v1/share-bounty/${id}`, { redirect: 'manual' });
    const html = await share.text();
    check('public share page renders without the address', share.status < 500 && leaks(html).length === 0,
      `${share.status}${leaks(html).length ? ' ' + leaks(html) : ''}`);

    // 5. Realtime: poster edits; ordinary listener must not see the address.
    await rest(`/rest/v1/bounties?id=eq.${id}`, {
      token: poster.token, method: 'PATCH', body: { title: `Carry boxes ${tag} (edited)`, location: SECRET.address, latitude: SECRET.lat, longitude: SECRET.lng },
    });
    await new Promise((r) => setTimeout(r, 4000));
    const rtLeaks = realtimePayloads.flatMap(leaks);
    check(`realtime postgres_changes payloads (${realtimePayloads.length}) carry no address`, rtLeaks.length === 0, rtLeaks);
    await ordinary.client.removeChannel(channel);

    // 6. Observable: access log rows exist for this bounty.
    const { data: log } = await admin.from('bounty_location_access_log').select('caller_id, granted, reason').eq('bounty_id', id);
    const badGrants = (log || []).filter((l) => l.granted && ![poster.id, hunter.id].includes(l.caller_id));
    check('access log recorded the calls; no grant to a non-participant', (log || []).length >= 4 && badGrants.length === 0,
      { rows: (log || []).length, nonParticipantGrants: badGrants.length });
  } finally {
    if (created.bountyId) {
      await admin.from('bounty_location_access_log').delete().eq('bounty_id', created.bountyId);
      await admin.from('bounty_requests').delete().eq('bounty_id', created.bountyId);
      const { error } = await admin.from('bounties').delete().eq('id', created.bountyId);
      if (error) console.log(`WARN  could not delete fixture bounty ${created.bountyId}: ${error.message}`);
    }
    for (const uid of created.users) {
      const { error } = await admin.auth.admin.deleteUser(uid);
      if (error) console.log(`WARN  could not delete fixture user ${uid}: ${error.message}`);
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Fixtures removed.`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
