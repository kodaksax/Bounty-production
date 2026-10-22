# Queued for the next native build: enable Google Pay

**Why it is queued, not applied:** `app.json` plugin config is a fingerprint
input. Changing it on `main` makes every later OTA mismatch the shipped
binaries, so the guarded OTA workflow would refuse to publish the JS fixes
that go with it. Apply this in the commit that cuts the next Android build.

## The change

In `app.json`, add `enableGooglePay` to the Stripe plugin:

```json
[
  "@stripe/stripe-react-native",
  {
    "merchantIdentifier": "merchant.com.bountyexpo-workspace",
    "enableGooglePay": true
  }
]
```

`app.config.js` spreads the existing plugin options and only overrides
`merchantIdentifier`, so the flag passes through unchanged.

## What it does

The plugin's `setGooglePayMetaData` adds
`<meta-data android:name="com.google.android.gms.wallet.api.enabled" android:value="true"/>`
to the main application. Without it (`enableGooglePay` defaults to `false`,
which actively *removes* the tag), Google Pay reports unavailable on every
device, so on today's Android binaries:

- the pay-at-accept Payment Sheet shows saved cards and card entry only;
- `stripeService.isGooglePayAvailable()` returns false, so failure copy and
  the "Use Google Pay or another card" label fall back to "another card".

No JS change is needed when this ships. The sheet already passes
`googlePay: { merchantCountryCode: 'US', testEnv }` and the copy switches on
the runtime check.

## Before release

- Google Pay production access for the Stripe account: Stripe handles the
  Google Pay merchant registration for Payment Sheet integrations, but the
  Google Pay API terms must be accepted in the Stripe Dashboard
  (Settings → Payment methods → Google Pay enabled).
- Verify on a physical Android device with a card in Google Wallet, live key:
  the Payment Sheet shows a Google Pay button at the top.
