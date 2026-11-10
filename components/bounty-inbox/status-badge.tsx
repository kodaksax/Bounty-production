import React from 'react';
import type { BountyDisplayStatus } from 'lib/utils/bounty-display-status';
import { StatusPill, type StatusTone } from '../ui/status-pill';

/** Status tag for the inbox cards ("Active", "Completed", "Expired"…). */
const BADGES: Partial<Record<BountyDisplayStatus, { label: string; tone: StatusTone }>> = {
  open: { label: 'Open', tone: 'success' },
  applied: { label: 'Applied', tone: 'info' },
  in_progress: { label: 'Active', tone: 'info' },
  submitted_for_review: { label: 'In review', tone: 'info' },
  review_needed: { label: 'Review', tone: 'warning' },
  completed: { label: 'Completed', tone: 'success' },
  cancellation_requested: { label: 'Cancelling', tone: 'warning' },
  rejected: { label: 'Not selected', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  deadline_passed: { label: 'Expired', tone: 'neutral' },
  archived: { label: 'Archived', tone: 'neutral' },
  deleted: { label: 'Removed', tone: 'neutral' },
};

export function statusBadgeLabel(status: BountyDisplayStatus): string {
  return BADGES[status]?.label ?? 'Bounty';
}

export function StatusBadge({ status }: { status: BountyDisplayStatus }) {
  const badge = BADGES[status] ?? { label: 'Bounty', tone: 'neutral' as const };
  return <StatusPill label={badge.label} tone={badge.tone} />;
}
