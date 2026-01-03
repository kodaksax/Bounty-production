/**
 * Shared utilities for dispute resolution screens
 */

export const getDisputeStatusColor = (status: string): string => {
  switch (status) {
    case 'open':
      return '#f59e0b'; // amber
    case 'under_review':
      return '#3b82f6'; // blue
    case 'resolved':
      return '#10b981'; // emerald
    case 'closed':
      return '#6b7280'; // gray
    default:
      return '#6b7280';
  }
};

export const getDisputeStatusIcon = (status: string): string => {
  switch (status) {
    case 'open':
      return 'error-outline';
    case 'under_review':
      return 'visibility';
    case 'resolved':
      return 'check-circle';
    case 'closed':
      return 'cancel';
    default:
      return 'help-outline';
  }
};

/**
 * Generate a unique ID for evidence items
 * Uses crypto.randomUUID if available, otherwise falls back to timestamp + random
 */
export const generateEvidenceId = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback: timestamp + random number to reduce collision probability
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
};
