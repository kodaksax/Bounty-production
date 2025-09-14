import { format, formatDistanceToNow, isToday, isYesterday } from "date-fns"

/**
 * Format a date in a human-readable way
 */
export function formatDate(date: Date): string {
  if (isToday(date)) {
    return `Today, ${format(date, "h:mm a")}`
  } else if (isYesterday(date)) {
    return `Yesterday, ${format(date, "h:mm a")}`
  } else {
    return format(date, "MMM d, yyyy")
  }
}

/**
 * Format a date relative to now (e.g., "2 hours ago")
 */
export function formatRelativeTime(date: Date): string {
  return formatDistanceToNow(date, { addSuffix: true })
}

/**
 * Format a date for grouping transactions by day
 */
export function formatDateForGrouping(date: Date): string {
  if (isToday(date)) {
    return "Today"
  } else if (isYesterday(date)) {
    return "Yesterday"
  } else {
    return format(date, "EEEE, MMMM d, yyyy")
  }
}

/**
 * Format a time (e.g., "3:45 PM")
 */
export function formatTime(date: Date): string {
  return format(date, "h:mm a")
}
