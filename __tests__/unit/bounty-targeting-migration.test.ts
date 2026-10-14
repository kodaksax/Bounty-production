import fs from 'fs'
import path from 'path'

const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20261014230000_consolidate_bounty_targeting.sql'), 'utf8')
const worker = fs.readFileSync(path.join(__dirname, '../../supabase/functions/process-notification/index.ts'), 'utf8')

describe('bounty targeting migration regressions', () => {
  it('defaults consolidated rollout off and restricts server configuration/claims', () => {
    expect(sql).toContain('consolidated_enabled boolean NOT NULL DEFAULT false')
    for (const table of ['bounty_targeting_config', 'bounty_targeting_dispatches', 'bounty_targeting_deliveries']) {
      expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`)
    }
    expect(sql).toContain('FROM PUBLIC, anon, authenticated')
    expect(sql).not.toContain('TO authenticated')
  })

  it('uses a bounded geographic union and leaves the existing gate and location-added triggers intact', () => {
    expect(sql).toContain('SELECT * FROM zip UNION ALL SELECT * FROM radius UNION ALL SELECT * FROM service_area')
    expect(sql).toContain('GROUP BY id ORDER BY id LIMIT 1000')
    expect(sql).not.toMatch(/CREATE (?:OR REPLACE )?FUNCTION public.fn_bounty_distribution_gate/)
    expect(sql).not.toMatch(/DROP TRIGGER/)
    expect(sql).not.toMatch(/FROM public.bounty_private_locations/)
    expect(sql).toContain("IF b.geom IS NULL AND COALESCE(btrim(b.zip_code), '') = '' THEN RETURN 0")
    expect(sql).toContain("p.deleted_at IS NULL AND p.account_status = 'active'")
    expect(sql).toContain('COALESCE(v_bounty.is_test, false)')
  })

  it('locks all hunters in stable order before checking the rolling cap and preserves queue provenance', () => {
    const bountyLock = sql.indexOf("hashtextextended('bounty-targeting-score:'")
    const locking = sql.indexOf("hashtextextended('bounty-targeting:'")
    const hourlyCap = sql.indexOf("n.created_at > now() - interval '1 hour'")
    expect(bountyLock).toBeGreaterThan(0)
    expect(locking).toBeGreaterThan(bountyLock)
    expect(locking).toBeGreaterThan(0)
    expect(hourlyCap).toBeGreaterThan(locking)
    expect(sql).toContain('SELECT DISTINCT id FROM unnest(p_candidates[1:1000]) id ORDER BY id')
    expect(sql).toContain('ON CONFLICT (bounty_id, hunter_id) DO NOTHING')
    expect(sql).toContain("'match_sources'")
    expect(sql).toContain("'targeting_version', 1")
    expect(sql).toContain('created_at means queued, NOT delivered')
  })

  it('authenticates processing before reading any outbox and isolates the new delivery path', () => {
    expect(worker.indexOf("req.headers.get('authorization')")).toBeLessThan(worker.indexOf(".from('notifications_outbox')"))
    expect(worker).toContain('targetingOutbox = isTargetingOutbox(rows)')
    expect(worker).toContain('processTargetingOutbox({')
    expect(sql).toContain("AND state IN ('pending', 'failed')")
    expect(sql).toContain("AND state = 'processing' AND claim_id = p_claim_id")
    expect(sql).toContain("SET state = 'unknown'")
    expect(sql).toContain("IF v_status = 'sent' THEN RETURN true; END IF")
  })
})
