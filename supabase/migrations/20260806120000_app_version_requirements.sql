-- App version gate
--
-- Publishes the minimum and latest supported *native* build per platform so the
-- client can nudge or block old installs without a store release.
--
-- Deliberately self-served rather than read from the App Store / Play:
--   * the iTunes lookup API caches for hours after a release, exactly when the
--     prompt matters most;
--   * Google Play has no official endpoint, so libraries scrape HTML and break;
--   * only a floor we control can hard-gate a build we know is broken, which is
--     what matters for an app moving money through escrow and Stripe.

CREATE TABLE IF NOT EXISTS app_version_requirements (
  platform        text PRIMARY KEY CHECK (platform IN ('ios', 'android')),
  -- Newest build in the store. Clients below this see a dismissible nudge.
  latest_version  text NOT NULL,
  -- Oldest build still allowed to run. Clients below this are blocked outright,
  -- so raising this value locks people out — change it deliberately.
  minimum_version text NOT NULL,
  -- Optional copy shown in the prompt, e.g. "Fixes a payout issue."
  message         text,
  -- Optional override for the store link (falls back to a platform default).
  store_url       text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_version_requirements ENABLE ROW LEVEL SECURITY;

-- Readable by everyone, including signed-out users: the gate runs before (and
-- independently of) authentication, and the contents are not sensitive.
CREATE POLICY "Anyone can read app version requirements" ON app_version_requirements
  FOR SELECT
  USING (true);

-- No INSERT/UPDATE/DELETE policy: writes are intentionally restricted to the
-- service role (dashboard / admin tooling). A client that could raise
-- minimum_version could lock every user out of the app.

-- Seed with current shipping versions. minimum_version is set to the current
-- store build so nobody is blocked on day one — raise it only when an old build
-- genuinely must stop running.
INSERT INTO app_version_requirements (platform, latest_version, minimum_version)
VALUES
  ('ios', '2.0.4', '2.0.0'),
  ('android', '2.0.4', '2.0.0')
ON CONFLICT (platform) DO NOTHING;
