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
  try {
    // Lazily required so non-Expo consumers (Jest, edge functions) don't need
    // the native module present just to format a number.
    const { getLocales } = require("expo-localization")
    cachedDeviceLocale = getLocales()?.[0]?.languageTag || "en-US"
  } catch {
    cachedDeviceLocale = "en-US"
  }
  return cachedDeviceLocale as string
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
