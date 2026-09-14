// Unit tests for plugins/withStripeIdentity.js — the config plugin that gives
// the Android host Activity a Material Components theme. Without it, Stripe
// Identity's verification sheet inflates Material views against an AppCompat
// theme and crashes the process natively when app/verification/launch.tsx calls
// present(), dropping the user out of the app on identity re-submission.

// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const withStripeIdentity = require('../../plugins/withStripeIdentity');

type StyleResource = {
  resources: { style?: { $: { name: string; parent?: string }; item?: unknown[] }[] };
};

// The plugin registers a single android.styles modifier. Invoke it directly with
// a mock styles.xml so the theme rewrite can be asserted without a full prebuild.
async function runPlugin(modResults: StyleResource): Promise<StyleResource> {
  const configured = withStripeIdentity({ name: 'test', slug: 'test' });
  const stylesMod = configured.mods.android.styles;
  const result = await stylesMod({
    name: 'test',
    slug: 'test',
    modResults,
    modRequest: {},
    modRawConfig: {},
  });
  return result.modResults as StyleResource;
}

describe('withStripeIdentity', () => {
  it('exposes the Material Components Bridge theme it applies', () => {
    expect(withStripeIdentity.MATERIAL_BRIDGE_THEME).toBe(
      'Theme.MaterialComponents.DayNight.NoActionBar.Bridge'
    );
  });

  it('rewrites a non-Material AppTheme to the Material Components Bridge theme', async () => {
    const result = await runPlugin({
      resources: {
        style: [{ $: { name: 'AppTheme', parent: 'Theme.AppCompat.DayNight.NoActionBar' }, item: [] }],
      },
    });
    expect(result.resources.style?.[0].$.parent).toBe(withStripeIdentity.MATERIAL_BRIDGE_THEME);
  });

  it('leaves an already-Material AppTheme untouched (idempotent)', async () => {
    const existing = 'Theme.MaterialComponents.DayNight.NoActionBar';
    const result = await runPlugin({
      resources: { style: [{ $: { name: 'AppTheme', parent: existing }, item: [] }] },
    });
    expect(result.resources.style?.[0].$.parent).toBe(existing);
  });

  it('no-ops when the generated styles have no style array', async () => {
    const result = await runPlugin({ resources: {} });
    expect(result.resources.style).toBeUndefined();
  });
});
