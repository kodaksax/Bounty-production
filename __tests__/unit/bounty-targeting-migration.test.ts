import fs from 'fs'
import path from 'path'

const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20261014230000_consolidate_bounty_targeting.sql'), 'utf8')
const worker = fs.readFileSync(path.join(__dirname, '../../supabase/functions/process-notification/index.ts'), 'utf8')
const verification = fs.readFileSync(path.join(__dirname, '../../scripts/ops/bounty-targeting-verify.sql'), 'utf8')
const scorer = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.fn_score_and_dispatch_bounty_notification'),
  sql.indexOf('CREATE FUNCTION public.fn_dispatch_bounty_targeting'))
const dispatcher = sql.slice(sql.indexOf('CREATE FUNCTION public.fn_dispatch_bounty_targeting'),
  sql.indexOf('-- Keep every INSERT'))

describe('bounty targeting migration regressions', () => {
  it('defaults consolidated rollout off and restricts server configuration/claims', () => {
    expect(sql).toContain('consolidated_enabled boolean NOT NULL DEFAULT false')
    for (const table of [
      'bounty_targeting_config', 'bounty_targeting_dispatches',
      'bounty_targeting_deliveries', 'bounty_targeting_outbox_attempts',
    ]) {
      expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`)
    }
    expect(sql).toContain('FROM PUBLIC, anon, authenticated')
    expect(sql).not.toContain('TO authenticated')
    expect(sql).toContain("CHECK (path IN ('escalation', 'radius', 'zip', 'service_area', 'targeting'))")
    expect(sql).toContain('CREATE TABLE public.bounty_targeting_outbox_attempts')
  })

  it('imports the latest queued bypass exposure into the rolling cap, including existing ledger pairs', () => {
    const legacyImport = sql.slice(sql.indexOf('INSERT INTO public.bounty_hunter_notifications AS ledger'),
      sql.indexOf('CREATE OR REPLACE FUNCTION public.fn_score_and_dispatch_bounty_notification'))
    expect(legacyImport).toContain("'first_queued_at', min(o.created_at)")
    expect(legacyImport).toContain("'last_queued_at', max(o.created_at)), max(o.created_at)")
    expect(legacyImport).toContain('ON CONFLICT (bounty_id, hunter_id) DO UPDATE')
    expect(legacyImport).toContain('created_at = GREATEST(ledger.created_at, EXCLUDED.created_at)')
    expect(legacyImport).toContain("COALESCE(ledger.reasons, '{}'::jsonb)")
    expect(legacyImport).toContain("'delivery', 'unknown'")
    expect(legacyImport).not.toContain('provider_accepted_at')
    expect(legacyImport).not.toContain('in_app_created_at')
  })

  it('uses a bounded geographic union and leaves the existing gate and location-added triggers intact', () => {
    expect(sql).toContain('SELECT * FROM zip UNION ALL SELECT * FROM radius UNION ALL SELECT * FROM service_area')
    expect(sql).toContain('FROM scored ORDER BY score DESC, id LIMIT 1000')
    expect(sql).not.toMatch(/CREATE (?:OR REPLACE )?FUNCTION public.fn_bounty_distribution_gate/)
    expect(sql).not.toMatch(/DROP TRIGGER/)
    expect(sql).not.toMatch(/FROM public.bounty_private_locations/)
    expect(sql).toContain("IF b.geom IS NULL AND COALESCE(btrim(b.zip_code), '') = '' THEN RETURN 0")
    expect(sql).toContain("p.deleted_at IS NULL AND p.account_status = 'active'")
    expect(sql).toContain('COALESCE(v_bounty.is_test, false)')
    expect(verification).toContain("v_function ~* '(FROM|JOIN)[[:space:]]+(public[.])?bounty_private_locations([[:space:]]|$)'")
    expect(verification).not.toContain("v_function LIKE '%bounty_private_locations%'")
  })

  it('locks all hunters in stable order before checking the rolling cap and preserves queue provenance', () => {
    const globalLock = scorer.indexOf("hashtextextended('bounty-targeting-global'")
    const bountyLock = sql.indexOf("hashtextextended('bounty-targeting-score:'")
    const locking = sql.indexOf("hashtextextended('bounty-targeting:'")
    const hourlyCap = scorer.lastIndexOf("n.created_at > now() - interval '1 hour'")
    const dispatcherGlobalLock = dispatcher.indexOf("hashtextextended('bounty-targeting-global'")
    const modeLock = dispatcher.indexOf("hashtextextended('bounty-targeting-mode:'")
    expect(globalLock).toBeGreaterThanOrEqual(0)
    expect(globalLock).toBeLessThan(scorer.indexOf("hashtextextended('bounty-targeting-score:'"))
    expect(sql).toContain('RENAME TO fn_escalate_stale_bounty_liquidity_unlocked')
    expect(sql).toContain('ORDER BY b.id\n  FOR UPDATE')
    expect(sql).toContain("PERFORM pg_advisory_xact_lock(hashtextextended('bounty-targeting-global', 0))")
    expect(dispatcherGlobalLock).toBeGreaterThanOrEqual(0)
    expect(dispatcherGlobalLock).toBeLessThan(modeLock)
    expect(bountyLock).toBeGreaterThan(0)
    expect(locking).toBeGreaterThan(bountyLock)
    expect(locking).toBeGreaterThan(0)
    expect(hourlyCap).toBeGreaterThan(scorer.indexOf("hashtextextended('bounty-targeting:'"))
    expect(sql).toContain('FROM jsonb_to_recordset(v_pool) AS pool(hunter_id uuid) ORDER BY hunter_id')
    expect(sql).toContain('ON CONFLICT (bounty_id, hunter_id) DO NOTHING')
    expect(sql).toContain("'match_sources'")
    expect(sql).toContain("'targeting_version', 1")
    expect(sql).toContain('created_at means queued, NOT delivered')
  })

  it('excludes stale first-1000 ledger/application/hourly candidates before bounding both geographic and direct pools', () => {
    expect(scorer).toContain('WHERE p.id = ANY(p_candidates)')
    expect(scorer).not.toMatch(/p_candidates\s*\[/)
    const geography = dispatcher.slice(dispatcher.indexOf('WITH zip AS'))
    expect(geography).not.toContain('ORDER BY p.id LIMIT')
    expect(geography).not.toContain('GROUP BY id ORDER BY id LIMIT')
    for (const selection of [scorer, geography]) {
      const bound = selection.indexOf('LIMIT 1000')
      expect(bound).toBeGreaterThan(selection.indexOf("p.account_status = 'active'"))
      expect(bound).toBeGreaterThan(selection.indexOf('FROM public.bounty_hunter_notifications n'))
      expect(bound).toBeGreaterThan(selection.indexOf('FROM public.bounty_requests r'))
      expect(bound).toBeGreaterThan(selection.indexOf("n.created_at > now() - interval '1 hour'"))
      expect(selection.match(/LIMIT 1000/g)).toHaveLength(1)
    }
  })

  it('ranks eligible higher-scoring UUIDs outside the old window before taking at most 1000 locks', () => {
    expect(scorer).toContain('SELECT * FROM scored ORDER BY score DESC, hunter_id LIMIT 1000')
    expect(dispatcher).toContain('SELECT id, sources FROM scored ORDER BY score DESC, id LIMIT 1000')
    const bountyLock = scorer.indexOf("hashtextextended('bounty-targeting-score:'")
    const bound = scorer.indexOf('LIMIT 1000')
    const hunterLock = scorer.indexOf("hashtextextended('bounty-targeting:'")
    expect(bound).toBeGreaterThan(bountyLock)
    expect(hunterLock).toBeGreaterThan(bound)
    expect(scorer).toContain('FROM eligible ORDER BY score DESC, hunter_id LIMIT v_cap')
    for (const selection of [scorer, dispatcher]) {
      expect(selection).toContain('category_score * 0.35 + activity_score * 0.2')
      expect(selection).toContain('reliability_score * 0.15 + distance_score * 0.3')
    }
  })

  it('authenticates processing before reading any outbox and isolates the new delivery path', () => {
    expect(worker.indexOf("req.headers.get('authorization')")).toBeLessThan(worker.indexOf(".from('notifications_outbox')"))
    expect(worker).toContain('targetingOutbox = isTargetingOutbox(rows)')
    expect(worker).toContain('processTargetingOutbox({')
    expect(sql).toContain("AND state IN ('pending', 'failed')")
    expect(sql).toContain("AND state = 'processing' AND claim_id = p_claim_id")
    expect(sql).toContain("SET state = 'unknown'")
    expect(sql).toContain("IF v_status = 'sent' THEN RETURN true; END IF")
    expect(sql).toContain('INSERT INTO public.bounty_targeting_outbox_attempts (outbox_id, attempt_id)')
    expect(sql).toContain('ON CONFLICT DO NOTHING')
    expect(sql).toContain('attempts = attempts + 1')
    const claimFunction = sql.slice(sql.indexOf('CREATE FUNCTION public.fn_claim_bounty_targeting_delivery'),
      sql.indexOf('CREATE FUNCTION public.fn_ack_bounty_targeting_delivery'))
    expect(claimFunction).toContain('FROM public.notifications_outbox')
    expect(claimFunction).toContain('FOR UPDATE')
    expect(claimFunction).toContain("IF NOT FOUND OR v_status = 'sent' THEN RETURN false; END IF")
    expect(claimFunction).toContain('attempt_id = p_attempt_id')
  })

  // In-memory specification of the SQL contract above; these are not live SQL
  // tests. Static assertions bind the filtering/ranking/bounding order to the DDL.
  describe('bounded targeting candidate selection specification', () => {
    type Candidate = {
      id: string; score: number; targeted?: boolean; applied?: boolean; hourlyCount?: number
    }
    const selectPool = (candidates: Candidate[]) => candidates
      .filter(c => !c.targeted && !c.applied && (c.hourlyCount ?? 0) < 5)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, 1000)
    const ids = (n: number) => String(n).padStart(8, '0')

    it('still selects an eligible hunter after the first 1000 UUIDs are ineligible', () => {
      const stale = Array.from({ length: 1000 }, (_, i): Candidate => ({
        id: ids(i), score: 0.9,
        targeted: i % 3 === 0, applied: i % 3 === 1, hourlyCount: i % 3 === 2 ? 5 : 0,
      }))
      const available = { id: ids(1001), score: 0.5 }
      expect(selectPool([...stale, available])).toEqual([available])
    })

    it('selects the higher-scoring hunter outside the old UUID window and breaks ties deterministically', () => {
      const lowerScores = Array.from({ length: 1000 }, (_, i): Candidate => ({ id: ids(i), score: 0.4 }))
      const best = { id: ids(1001), score: 1 }
      const pool = selectPool([...lowerScores, best].reverse())
      expect(pool).toHaveLength(1000)
      expect(pool[0]).toEqual(best)
      expect(pool[1].id).toBe(ids(0))
      expect(pool).not.toContainEqual(lowerScores[999])
    })
  })
})
