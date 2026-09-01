// components/admin/AdminStatusBadge.tsx - Status badge component for admin screens
//
// The colour table used to be a wall of hardcoded hex/rgba pairs that did not
// match the app's semantic tokens (`#00dc50` brand green, `#4caf50` Material
// green, `#f44336` Material red), and it only knew four bounty statuses -- so
// a `cancelled`, `cancellation_requested` or `deleted` bounty fell through to
// the neutral default and read as if it had no status at all. Colours now come
// from the theme's semantic tokens and every enum value is covered.
import React from 'react';
import type { AppTheme } from '../../lib/themes/types';
import { useAppTheme } from '../../hooks/use-app-theme';
import { AdminBadge } from './AdminUI';

type BadgeTone = React.ComponentProps<typeof AdminBadge>['tone'];

interface AdminStatusBadgeProps {
  status: string;
  type?: 'bounty' | 'user' | 'transaction' | 'request' | 'dispute';
}

export function AdminStatusBadge({ status, type = 'bounty' }: AdminStatusBadgeProps) {
  const { theme } = useAppTheme();
  const { tone, label } = describeStatus(status, type, theme);
  return <AdminBadge label={label} tone={tone} />;
}

/**
 * Maps a raw status string onto a semantic tone. Exported so lists can colour
 * other affordances (left borders, icons) to match their badge.
 */
export function describeStatus(
  status: string,
  type: string,
  _theme: AppTheme
): { tone: BadgeTone; label: string } {
  const label = String(status ?? 'unknown').replace(/_/g, ' ');

  if (type === 'bounty') {
    switch (status) {
      case 'open':
        return { tone: 'brand', label };
      case 'in_progress':
        return { tone: 'warning', label };
      case 'completed':
        return { tone: 'success', label };
      case 'archived':
        return { tone: 'neutral', label };
      case 'cancelled':
      case 'cancellation_requested':
        return { tone: 'cancelled', label };
      case 'deleted':
        return { tone: 'error', label };
      default:
        return { tone: 'neutral', label };
    }
  }

  if (type === 'user') {
    switch (status) {
      case 'active':
        return { tone: 'success', label };
      case 'suspended':
        return { tone: 'warning', label };
      case 'banned':
        return { tone: 'error', label };
      default:
        return { tone: 'neutral', label };
    }
  }

  if (type === 'transaction') {
    switch (status) {
      case 'completed':
        return { tone: 'success', label };
      case 'pending':
        return { tone: 'warning', label };
      case 'failed':
        return { tone: 'error', label };
      case 'manually_paid':
        return { tone: 'info', label };
      default:
        return { tone: 'neutral', label };
    }
  }

  if (type === 'request') {
    switch (status) {
      case 'accepted':
        return { tone: 'success', label };
      case 'pending':
        return { tone: 'warning', label };
      case 'rejected':
        return { tone: 'error', label };
      default:
        return { tone: 'neutral', label };
    }
  }

  if (type === 'dispute') {
    switch (status) {
      case 'resolved':
      case 'closed':
        return { tone: 'success', label };
      case 'escalated':
        return { tone: 'error', label };
      case 'open':
      case 'pending':
      case 'under_review':
        return { tone: 'warning', label };
      default:
        return { tone: 'neutral', label };
    }
  }

  return { tone: 'neutral', label };
}
