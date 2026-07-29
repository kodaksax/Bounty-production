import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Single source of truth for displaying money amounts (adds thousands
// separators, e.g. "$12,345.67" instead of "$12345.67").
export function formatCurrency(amount: number, currency: string = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount)
}

// Formats a minor-unit amount (cents for USD) using the device's locale.
//
// Stripe reports every balance and payout in the smallest currency unit, so
// balances sourced from the Connect account arrive as integers — converting
// them to a float before formatting reintroduces the rounding error that
// working in cents exists to avoid. Prefer this over formatCurrency() for
// anything that came from Stripe.
//
// Locale comes from the device rather than a hardcoded "en-US" so grouping and
// symbol placement match the user's own conventions (e.g. "1.234,56 €").
export function formatCurrencyCents(
  cents: number,
  currency: string = "USD",
  locale?: string
): string {
  const resolvedLocale = locale ?? getDeviceLocale()
  const code = currency.toUpperCase()

  // Zero-decimal currencies (JPY, KRW, …) are already in major units; Intl's
  // own metadata decides the fraction digits, so derive the divisor from it
  // rather than assuming every currency is 1/100.
  const fractionDigits = new Intl.NumberFormat(resolvedLocale, {
    style: "currency",
    currency: code,
  }).resolvedOptions().maximumFractionDigits ?? 2

  const amount = cents / Math.pow(10, fractionDigits)

  return new Intl.NumberFormat(resolvedLocale, {
    style: "currency",
    currency: code,
  }).format(amount)
}

// Resolved once: the device locale does not change without an app restart, and
// Intl.NumberFormat construction is not free on Hermes.
let cachedDeviceLocale: string | null = null

export function getDeviceLocale(): string {
  if (cachedDeviceLocale) return cachedDeviceLocale
  cachedDeviceLocale = resolveDeviceLocale()
  return cachedDeviceLocale
}

function resolveDeviceLocale(): string {
  try {
    // Ask expo-modules-core for the native module rather than importing
    // expo-localization: its entry point calls requireNativeModule() at module
    // scope, which throws when the app binary predates the dependency. Because
    // this require happens lazily (mid-render, not during bundle startup),
    // Metro routes that throw through ErrorUtils.reportFatalError, so it
    // reaches the global handler as a fatal even though we catch it here.
    // requireOptionalNativeModule() returns null instead of throwing.
    const { requireOptionalNativeModule } = require("expo-modules-core")
    const languageTag = requireOptionalNativeModule("ExpoLocalization")
      ?.getLocales?.()?.[0]?.languageTag
    if (languageTag) return languageTag
  } catch {
    // Non-Expo consumers (Jest, edge functions) have no expo-modules-core.
  }

  // Web, and any platform without the native module: Hermes ships full ICU, so
  // Intl still knows the system locale.
  try {
    const intlLocale = new Intl.DateTimeFormat().resolvedOptions().locale
    if (intlLocale) return intlLocale
  } catch {
    // Intl unavailable — fall through.
  }

  return "en-US"
}

// Converts a theme hex color to an rgba() string at the given alpha (0-1).
// Used to derive tinted surfaces/borders from theme tokens instead of
// hardcoding separate light/dark literals.
export function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace("#", "")
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean
  const int = parseInt(full, 16)
  const r = (int >> 16) & 255
  const g = (int >> 8) & 255
  const b = int & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
