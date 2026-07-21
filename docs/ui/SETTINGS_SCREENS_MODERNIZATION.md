# Settings Screens — Design System Audit & Modernization

Date: 2026-07-20

## Scope

Every screen reachable from the main Settings menu (`components/settings-screen.tsx`,
rendered from `app/tabs/profile-screen.tsx`). Admin settings (`app/(admin)/settings/*`)
are a separate, admin-only area not reachable from the user Settings menu and were
**not** included — see "Remaining legacy debt" below.

## Result

Of the 11 screens reachable from Settings, **10 were already fully modernized** —
built on the current theme system (`lib/themes/*` via `useAppThemeContext()`/`useAppTheme()`)
and the shared `SettingsRow` / `SettingsSection` / `SettingsScreenHeader` /
`ThemedButton` / `ThemedInput` components, with no legacy hardcoded green hex codes.

| Screen | Path | Status |
|---|---|---|
| Settings home | `components/settings-screen.tsx` | Already modern |
| Privacy & Security | `components/settings/privacy-security-screen.tsx` | Already modern |
| Notification Center | `components/settings/notifications-center-screen.tsx` | Already modern |
| Location & Visibility | `components/settings/location-settings-screen.tsx` | Already modern |
| Help & Support | `components/settings/help-support-screen.tsx` | Already modern |
| Contact Support | `components/settings/contact-support-screen.tsx` | Already modern |
| FAQ | `components/settings/faq-screen.tsx` | Already modern |
| Feedback & Support | `components/settings/feedback-support-screen.tsx` + `feedback-form.tsx` | Already modern |
| Terms & Privacy | `components/settings/terms-privacy-screen.tsx` | Already modern |
| Community Guidelines | `components/settings/community-guidelines-screen.tsx` | Already modern |
| **Edit Profile** | `app/profile/edit.tsx` | **Modernized this pass** |

## What changed — `app/profile/edit.tsx`

This was the one screen still carrying legacy hardcoded colors instead of theme
tokens. Visual layout, functionality, and navigation are unchanged; only the color
sourcing was fixed:

- `backgroundColor: "#059669"` (save button, avatar, avatar camera badge) → `theme.primary`
- `backgroundColor: "#dc2626"` (error banner) → `theme.error`
- Field-label/help-text color pattern `theme.isDark ? "#6ee7b7" : "#059669"` → `theme.primaryLight`
  (this is literally what `primaryLight` exists for — see `lib/themes/types.ts`)
- Field-focus border `"#059669"` → `theme.primary`
- Field tint backgrounds: the dark-mode variant was accidentally using
  `rgba(16, 185, 129, …)` — the RGB of the `success` token, not the brand green —
  while light mode correctly used `rgba(5, 150, 105, …)` (brand green RGB). Both
  are now computed from the same brand-derived `primaryTint` / `primaryTintFocused`
  constants inside `makeStyles`, matching the pattern already used in
  `location-settings-screen.tsx`.
- `bannerSection` shadow literal → `...theme.shadows.md` (byte-identical values,
  now sourced from the shared token instead of duplicated).
- Remaining literals (`"#ffffff"` for text/icons on top of the solid brand-green
  buttons, `"#000000"` shadow colors) were left as-is — this is the established,
  intentional "on-brand contrast" convention used throughout the app (see
  `components/themed/ThemedButton.tsx` and `lib/themes/tokens.ts`), not a legacy
  color scheme.

No structural/component swap was made (e.g. to `ThemedInput`) because the screen's
Twitter-style pinned header + underlined-field layout is an intentional distinct UX
for profile editing, and `ThemedInput` does not forward refs — swapping would have
broken the field-to-field "next" keyboard navigation. This was a color-token fix
only, per the "visual modernization only" instruction.

## Remaining legacy debt (not touched — future pass)

- **`app/(admin)/settings/security.tsx`** — admin-only route, not reachable from
  the user Settings menu. Heavily legacy: hardcoded `#00912C`/`#1a3d2e`/`#fffef5`
  (the *old* pre-rebrand green, explicitly called out as stale in
  `lib/themes/tokens.ts`), no theme system usage at all. Out of scope for this
  pass since it's admin-only, but should be modernized in an admin-settings pass.
- **`components/settings/notifications.tsx`** — a 6-line dead re-export shim of
  `NotificationsCenterScreen`. Not imported anywhere. Safe to delete.
- **`components/settings/security.tsx`** (`SecuritySettings`, ~457 LOC) — an
  unused, older duplicate of `privacy-security-screen.tsx`'s 2FA/password flow
  (Alert-based QR flow vs. the current `TotpEnrollmentModal`). Already
  theme-token-clean but redundant; not referenced by the live Settings screen.
  Candidate for deletion rather than further modernization.
- **Design-system duplication** (app-wide, not Settings-specific): two parallel
  theme files (`lib/themes/*` — current/canonical — vs `lib/theme.ts` — legacy,
  still imported by `components/ui/input.tsx`, `components/ui/tooltip.tsx`,
  `bottom-nav.tsx`, wallet screens, etc.) and two parallel Button implementations
  (`components/themed/ThemedButton.tsx` vs `components/ui/button.tsx`). None of
  the Settings screens depend on the legacy pair, but a future pass should
  standardize the rest of the app on `lib/themes/*` + one canonical Button/Input.
