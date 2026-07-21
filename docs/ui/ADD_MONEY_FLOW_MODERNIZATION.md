# Add Money Flow — Design System Modernization

Date: 2026-07-20 (superseded in part on 2026-07-20 — see update below)

> **Update (same day):** the "keep the immersive green" decision below was
> revisited per explicit follow-up feedback: the green full-bleed background
> read as legacy/off-brand and didn't adapt between light/dark mode, and the
> absolute-positioned footer caused the keypad, Apple Pay button, and Add
> Money CTA to clip/overlap on shorter devices. `add-money-screen.tsx` was
> reworked again: root background is now `theme.background` (adapts light/
> dark, like every other screen), all text/icons/chips use theme tokens
> instead of white-on-green, and the layout is a plain flex column (fixed
> header → scrollable body → fixed footer using the shared
> `BOTTOM_NAV_BASE_OFFSET` + safe-area insets convention from
> `withdraw-with-bank-screen.tsx`) instead of `position: 'absolute'`, so the
> footer can no longer overlap the keypad on any device height. The child
> modals (`payment-methods-modal.tsx`, `add-card-modal.tsx`,
> `add-bank-account-modal.tsx`) were **not** touched in this pass and still
> use `theme.primary` as their sheet background, so there is now a
> deliberate visual seam between the (now theme-neutral) main screen and
> those sub-flows — worth a follow-up pass if a fully consistent look is
> wanted across the whole flow.

## Scope

The full "Add Money" flow: the main keypad screen and every modal it can open
(payment method picker, add-card, add-bank-account) plus the shared error
banner they all use.

| File | Role | Status |
|---|---|---|
| `components/add-money-screen.tsx` | Main screen (keypad + Apple Pay + CTA) | Modernized |
| `components/payment-methods-modal.tsx` | Card/bank picker bottom sheet | Modernized (was partially themed already) |
| `components/add-card-modal.tsx` | Add-card sub-flow (Payment Element + manual form) | Modernized (was on legacy `lib/theme.ts`) |
| `components/add-bank-account-modal.tsx` | Add-bank sub-flow (Stripe Financial Connections) | Modernized (had no theme system at all) |
| `components/error-banner.tsx` | Shared error/validation banner (used app-wide, not just here) | Modernized (was on legacy `lib/theme.ts`) |

**No payment/business logic was touched.** Every Stripe SDK call
(`processPaymentSecure`, `createSetupIntent`, `linkBankWithFinancialConnections`,
`createPaymentMethod`, Apple Pay's `isAvailable`/`processPayment`, the
`/wallet/deposit` persistence + retry logic, `refreshFromApi`) is byte-identical
to before. Only colors, a few style values, and one new read-only display
(payment method label) changed.

## Design decision: kept the immersive layout

Add Money uses a full-bleed brand-green keypad screen (Cash App style), which
is structurally different from the Withdraw screen's card-based, theme-driven
layout. Rather than presuming a rewrite, this was raised with the user
explicitly — **decision: keep the immersive keypad UX**, but source its color
from `theme.primary` instead of a hardcoded hex (so it follows a future
rebrand), fix every other hardcoded color to theme tokens, and layer in the
missing balance/payment-method visibility as overlay chips. The screen's
background stays a constant brand green in both light and dark mode by design
(same as `payment-methods-modal.tsx`'s sheet, `add-card-modal.tsx`'s sheet, and
`add-bank-account-modal.tsx`'s sheet — this is one consistent "immersive
payment" visual language across the whole flow, not four different one-offs).

## What changed

### `add-money-screen.tsx`
- `bg-[#059669]` (2 hardcoded instances) → `theme.primary`.
- **New: balance + payment-method visibility.** Added a chip row below the
  amount display showing `Balance: $X` and, when a card is on file, `Paying
  with VISA •••• 4242 ›` — tapping it opens the existing payment-methods
  modal (reuses the same `setShowPaymentMethodsModal` call already wired to
  the "Link Payment Method" button; no new selection logic was added since the
  backend still always charges `paymentMethods[0]`, unchanged).
- The bottom CTA ("Add Money" / "Link Payment Method") was hardcoded Tailwind
  `bg-gray-700` / `text-gray-300` — replaced with a `theme.text`/
  `theme.background` inversion (dark pill + light text in light mode, flips to
  a light pill + dark text in dark mode), matching the same inverted-CTA
  pattern now used across the whole flow (see below). Disabled state now uses
  `theme.textDisabled` instead of a hardcoded gray-with-opacity.
- Apple Pay button's black background (`#000000`) was **left untouched** —
  that's an Apple HIG requirement for Apple Pay buttons, not app branding.
- Removed the unused `cn()` className-merging import now that colors are
  resolved via `style` instead of conditional Tailwind classes.

### `payment-methods-modal.tsx`
- Sheet background, active-tab background, and the "Add Method" button's glow
  shadow color: `#059669` (×4) → `theme.primary`.
- Error-state icon/text: `#fee2e2` → `theme.error` for the icon, translucent
  white for the text (was unreadable-adjacent hardcoded pink; now consistent
  with the sibling empty-state text right below it).
- Payment-method list item shadow: inlined `{shadowColor:'#000', opacity:0.05,
  radius:2, offset:{0,1}, elevation:1}` → `...theme.shadows.sm` (identical
  values, now sourced from the token instead of duplicated).

### `add-card-modal.tsx`
- Was importing the **legacy** `lib/theme.ts` singleton (only for
  `.shadows.sm`/`.shadows.emerald`) — migrated to `useAppThemeContext()` +
  a `makeStyles(theme)` function, the same pattern used by
  `app/profile/edit.tsx` and `withdraw-with-bank-screen.tsx`.
- Sheet background `#059669` → `theme.primary`.
- **Fixed a real contrast bug**: `instructions` and `fieldLabel` text were
  `#1F2937` (near-black) sitting directly on the green sheet — nearly
  unreadable. Changed to translucent white, matching every other text
  element on that same sheet.
- "Save Card" button: was `#111827` (near-black) background with white text —
  replaced with the same `theme.text`/`theme.background` inversion used on
  the Add Money CTA, so light/dark mode both render a correctly-contrasted
  button instead of a fixed near-black one.
- `textInputError` border: `#f87171` → `theme.error`.
- `theme.shadows.emerald` (legacy token name) → `theme.shadows.brand` (its
  equivalent in the current token set).
- Left untouched (intentional, documented inline): the dark-navy credit-card
  preview mockup (`#0B0F14` + its fixed accent colors) — this is a decorative
  "physical card face" that should look the same regardless of app theme, and
  the white card wrapping Stripe's native `<PaymentElementWrapper>` — Stripe's
  own UI needs that light background to render its own theming correctly.

### `add-bank-account-modal.tsx`
- Had **no theme system at all** — added `useAppThemeContext()` +
  `makeStyles(theme)`.
- Sheet background `#059669` → `theme.primary`.
- **Fixed a real bug**: the primary "Link Bank with Stripe" button had the
  exact same background color as the sheet it sat on (`#059669` on
  `#059669`) — effectively invisible except for its shadow-less flat edge.
  Replaced with the same `theme.text`/`theme.background` inverted-CTA pattern,
  plus a subtle `theme.shadows.md` so it actually reads as a button.
- **Fixed a contrast bug**: `heroSubtitle`/`bulletText` (`#1F2937`) and
  `securityText` (`#9CA3AF`) sat directly on the green sheet with poor
  readability — changed to translucent white at different opacities (matching
  the visual hierarchy already used elsewhere: full white for headings,
  85% for body copy, 60% for the fine-print security note).

### `error-banner.tsx` (shared — used outside this flow too)
- Was importing the legacy `lib/theme.ts` singleton (only for
  `.shadows.lg`) — migrated to `useAppThemeContext()` + `makeStyles(theme)`.
- Background color: `error.type === 'validation' ? '#f59e0b' : '#dc2626'` →
  `theme.warning` / `theme.error`.
- **Fixed a real contrast bug in the process**: `theme.warning` (`#FBBF24`) is
  a notably brighter amber than the old `#f59e0b`, and white text on it fails
  contrast badly (~1.7:1). The validation/warning variant now uses fixed dark
  "ink" text (`#1F2937`) instead of white — text color is intentionally *not*
  theme-derived here since the warning background itself doesn't change
  between light/dark mode, so the text needs to stay fixed-dark in both. The
  error/red variant keeps white text, consistent with `ThemedButton`'s
  destructive variant using white-on-`theme.error` elsewhere in the app.
- This is a shared component with call sites outside the Add Money flow;
  since the change is a like-for-like color/contrast fix with no API changes,
  every existing caller gets the improvement for free.

### `jest.setup.js` (test infrastructure, not app code)
- The global `useAppThemeContext` mock only had color tokens — it predated
  `spacing`/`radius`/`typography`/`shadows` being added to `AppTheme`. The new
  balance/payment-method chip in `add-money-screen.tsx` was the first
  component under test to reference `theme.radius`/`theme.spacing` directly,
  which surfaced the gap (`Cannot read properties of undefined (reading
  'full')`). Fixed by filling in the mock to match the real token shapes from
  `lib/themes/tokens.ts`. Verified via `__tests__/components/add-money-apple-pay.test.tsx`
  (3/3 passing) and `__tests__/unit/balance-persistence-fix.test.ts` (21/21
  passing, unaffected — it re-implements the persist logic locally).

## Verification

- `npx tsc --noEmit` — clean across the whole project.
- `add-money-apple-pay.test.tsx` — 3/3 passing (Apple Pay button text,
  discoverability-on-unavailable-device, and successful-payment paths all
  still behave identically).
- `balance-persistence-fix.test.ts` — 21/21 passing.
- No visual/simulator verification was performed in this pass — this
  environment has no attached iOS/Android simulator or web preview. Worth a
  manual pass in Expo Go or a simulator before shipping, especially to eyeball
  the new balance/payment-method chip row and the dark-mode CTA inversion on
  a real device.

## Remaining legacy debt / opportunities for a future pass

- **Success/error flow still uses native `Alert.alert()`** for the
  deposit-success and some error messages (`add-money-screen.tsx`,
  `add-card-modal.tsx`, `add-bank-account-modal.tsx`). This wasn't touched —
  swapping native alerts for the app's own success/error UI would be a
  bigger, logic-adjacent change (the alert's `onPress` drives navigation)
  better done as its own reviewed piece of work, not folded into a "restyle
  only" pass. Flagging per the brief's ask for "opportunities for further
  UX improvement."
- **Only ever charges `paymentMethods[0]`** — there's no way to add a second
  card and choose between them for a specific deposit (the new "Paying with"
  chip surfaces this for the first time, but changing *which* method is used
  would be a real functional change, intentionally out of scope here).
- **`components/payment-element-wrapper.tsx`** (renders Stripe's native
  Payment Element) was not audited in this pass — it's Stripe's own UI
  component, largely out of this app's styling control, but worth a quick
  look if Stripe ships new theming hooks.
- **App-wide**: `lib/theme.ts` (legacy) is still imported by other files
  outside this flow (e.g. `components/ui/tooltip.tsx`, `bottom-nav.tsx`,
  `components/ui/input.tsx`) — same migration this pass did for
  `add-card-modal.tsx`/`error-banner.tsx` should eventually be applied there
  too. Not touched here to keep this change scoped to the Add Money flow.
