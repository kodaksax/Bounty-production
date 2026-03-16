// Helper to normalize recipients from notifications_outbox.recipients (jsonb)
export function normalizeRecipients(raw: any): string[] {
  let recipients: string[] = []
  try {
    if (raw == null) {
      recipients = []
    } else if (Array.isArray(raw)) {
      recipients = raw.filter((r: any) => typeof r === 'string' && r.trim()).map((s: string) => s.trim())
    } else if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          recipients = parsed.filter((r: any) => typeof r === 'string' && r.trim()).map((s: string) => s.trim())
        } else if (typeof parsed === 'string' && parsed.trim()) {
          recipients = [parsed.trim()]
        }
      } catch (e) {
        if (raw.trim()) recipients = [raw.trim()]
      }
    } else if (typeof raw === 'object') {
      if (Array.isArray((raw as any).ids)) {
        recipients = (raw as any).ids.filter((r: any) => typeof r === 'string' && r.trim()).map((s: string) => s.trim())
      } else {
        const values = Object.values(raw as Record<string, unknown>)
        recipients = values
          .filter((v) => typeof v === 'string' && (v as string).trim())
          .map((v) => (v as string).trim())
      }
    }
  } catch (e) {
    // on error return empty array
    recipients = []
  }
  return recipients
}

export default normalizeRecipients
