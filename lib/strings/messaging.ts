import { trustSafetyStrings } from './trust-safety'

export const messagingStrings = {
  offPlatformDisclaimer: trustSafetyStrings.general,
  confirmTitle: 'Keep this job protected',
  edit: 'Edit',
  sendAnyway: 'Send anyway',
  reportMessage: 'Report this message',
} as const
