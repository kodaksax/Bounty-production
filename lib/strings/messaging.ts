import { trustSafetyStrings } from './trust-safety'

export const messagingStrings = {
  offPlatformDisclaimer: trustSafetyStrings.general,
  confirmTitle: 'Keep this job protected',
  edit: 'Edit',
  sendAnyway: 'Send anyway',
  reportMessage: 'Report this message',
  notificationAcceptance:
    'Before starting, open the bounty and check that you’re the accepted hunter. Keep work and any payment on Bounty.',
} as const
