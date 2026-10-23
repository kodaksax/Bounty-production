import fs from 'fs'
import path from 'path'

const root = path.join(__dirname, '../..')
const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261023120000_nearby_zip_targeting.sql'), 'utf8')
const down = fs.readFileSync(path.join(root, 'supabase/rollbacks/production/20261023120000_nearby_zip_targeting.down.sql'), 'utf8')
const previous = fs.readFileSync(path.join(root, 'supabase/migrations/20261014230000_consolidate_bounty_targeting.sql'), 'utf8')
const csv = fs.readFileSync(path.join(root, 'supabase/data/zcta_centroids_2023.csv'), 'utf8').trim().split('\n')
const dispatcher = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.fn_dispatch_bounty_targeting'),
  sql.indexOf('-- ─── 3.'))
const zipCheck = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.fn_bounties_check_zip_matches_point'))

describe('nearby ZIP targeting migration', () => {
  it('keeps the centroid table server-only', () => {
    expect(sql).toContain('ALTER TABLE public.zip_centroids ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('REVOKE ALL ON public.zip_centroids FROM PUBLIC, anon, authenticated')
    expect(sql).not.toMatch(/GRANT [A-Z, ]+ ON public\.zip_centroids TO (anon|authenticated)/)
  })

  it('falls back to ZIP centroids only where real coordinates are missing', () => {
    expect(dispatcher).toContain('v_point := COALESCE(b.geom,')
    expect(dispatcher).toContain('COALESCE(p.geom, z.geom) AS point')
    expect(dispatcher).toContain('LEFT JOIN public.zip_centroids z ON p.geom IS NULL')
  })

  it('keeps the gate, rollout lock, ledger dedup, hourly cap, 20 mi radius and privacy rule', () => {
    for (const unchanged of [
      "public.fn_bounty_distribution_gate(\n    b.id, p_source, 1::smallint, false)",
      "hashtextextended('bounty-targeting-mode:' || b.id::text, 0)",
      'ON CONFLICT DO NOTHING RETURNING bounty_id INTO v_claim',
      "n.created_at > now() - interval '1 hour') < 5",
      'FROM scored ORDER BY score DESC, id LIMIT 1000',
      "'New Bounty Near You'",
    ]) {
      expect(dispatcher).toContain(unchanged)
    }
    expect(dispatcher).toContain('20 * 1609.344')
    expect(dispatcher).not.toMatch(/(FROM|JOIN)\s+(public\.)?bounty_private_locations/)
    expect(sql).not.toContain('consolidated_enabled = true')
  })

  it('lets the legacy zip source reach neighbouring ZIPs when the bounty has no coordinates', () => {
    expect(dispatcher).toContain("OR (p_source = 'zip' AND b.geom IS NULL")
  })

  it('only clears a far-off bounty ZIP, before the nearby claim and privatization', () => {
    expect(zipCheck).toContain('GREATEST(25, 3 * v_radius_mi) * 1609.344')
    expect(zipCheck).toContain('NEW.zip_code := NULL')
    expect(zipCheck).toContain('IF NOT FOUND THEN RETURN NEW; END IF;')
    expect(zipCheck).not.toMatch(/NEW\.zip_code := (?!NULL)/)
    // BEFORE triggers fire in name order.
    const names = ['trg_bounties_check_zip_matches_point', 'trg_bounties_claim_nearby_notification',
      'trg_bounties_sync_geom', 'zz_bounties_privatize_location']
    expect([...names].sort()).toEqual(names)
  })

  it('rolls back to the exact previous dispatcher', () => {
    const before = previous.slice(previous.indexOf('CREATE FUNCTION public.fn_dispatch_bounty_targeting'),
      previous.indexOf('-- Keep every INSERT')).trim().replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION')
    expect(down).toContain(before)
    expect(down).toContain('DROP TABLE IF EXISTS public.zip_centroids')
    expect(down).toContain('DROP TRIGGER IF EXISTS trg_bounties_check_zip_matches_point')
  })

  it('ships a well-formed centroid dataset', () => {
    expect(csv[0]).toBe('zip,latitude,longitude,radius_mi')
    expect(csv.length - 1).toBeGreaterThan(33000)
    const zips = new Set<string>()
    for (const line of csv.slice(1)) {
      const [zip, lat, lng, radius] = line.split(',')
      expect(zip).toMatch(/^\d{5}$/)
      expect(Math.abs(Number(lat))).toBeLessThanOrEqual(90)
      expect(Math.abs(Number(lng))).toBeLessThanOrEqual(180)
      expect(Number(radius)).toBeGreaterThanOrEqual(0)
      zips.add(zip)
    }
    expect(zips.size).toBe(csv.length - 1)
  })
})
