// Supabase Edge Function: process-notification
// POST { id: '<outbox-uuid>' }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Inlined from ./message (local imports are not supported by the Supabase bundler)
function createExpoMessage(to: string, opts: { title?: string; body?: string; data?: any; sound?: string } = {}) {
  const { title = '', body = '', data = {}, sound = 'default' } = opts
  return { to, title, body, data, sound }
}
function createMessages(tokens: string[], opts?: { title?: string; body?: string; data?: any; sound?: string }) {
  return (tokens || []).map(t => createExpoMessage(t, opts))
}

// Inlined from ./recipients
function normalizeRecipients(raw: any): string[] {
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
      } catch (_e) {
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
  } catch (_e) {
    recipients = []
  }
  return recipients
}

// Inlined from ./preferences (local imports are not supported by the bundler)
function mapTypeToPreferenceKey(type: unknown): string | null {
  switch (type) {
    case 'message': return 'messages'
    case 'application': return 'applications'
    case 'acceptance': return 'acceptances'
    case 'review_needed':
    case 'completion': return 'completions'
    case 'payment': return 'payments'
    case 'follow': return 'follows'
    case 'dispute': return 'disputes'
    default: return null
  }
}

function readToggle(prefs: Record<string, unknown> | null | undefined, base: string): boolean | undefined {
  if (!prefs) return undefined
  const bare = prefs[base]
  const enabled = prefs[`${base}_enabled`]
  const value = bare ?? enabled
  if (value === null || value === undefined) return undefined
  return Boolean(value)
}

function decideChannels(prefs: Record<string, unknown> | null | undefined, type: unknown): { inApp: boolean; push: boolean } {
  if (!prefs) return { inApp: true, push: true }
  const key = mapTypeToPreferenceKey(type)
  if (key !== null) {
    const typeEnabled = readToggle(prefs, key)
    if (typeEnabled === false) return { inApp: false, push: false }
  }
  const inApp = prefs.in_app_enabled === false ? false : true
  const push = prefs.push_enabled === false ? false : true
  return { inApp, push }
}

// Inlined from ./push-receipts
const PERMANENT_TOKEN_ERRORS = new Set(['DeviceNotRegistered', 'InvalidCredentials'])
function extractInvalidTokens(chunkTokens: string[], expoResponseBody: unknown): string[] {
  const tickets = (expoResponseBody as { data?: unknown })?.data
  if (!Array.isArray(tickets)) return []
  const invalid: string[] = []
  tickets.forEach((ticket: unknown, index: number) => {
    const t = ticket as { status?: string; details?: { error?: string } } | null
    if (t && t.status === 'error') {
      const errorCode = t.details?.error
      if (errorCode && PERMANENT_TOKEN_ERRORS.has(errorCode) && chunkTokens[index]) {
        invalid.push(chunkTokens[index])
      }
    }
  })
  return invalid
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function sanitizeUuid(value: unknown): string {
  const text = String(value ?? '').trim()
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  if (!uuidPattern.test(text)) throw new Error('Invalid UUID')
  return text
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // Track the outbox id and supabase client so the top-level catch can record
  // the failure reason on the row instead of swallowing it as an opaque 500.
  let supabaseAdmin: ReturnType<typeof createClient> | null = null
  let outboxId: string | null = null
  let outboxAttempts = 0

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: 'Supabase Edge Function is not configured' }, 500)

    supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    if (req.method !== 'POST') return jsonResponse({ error: 'Invalid method' }, 405)

    let payload: any
    try { 
      payload = await req.json();
    } catch (e) { 
      return jsonResponse({ error: 'Invalid JSON' }, 400);
    }

    // Support both direct {id} and Supabase Webhook {record: {id}} formats
    const id = sanitizeUuid(payload.record?.id || payload.id);
    outboxId = id;

    // Fetch outbox row
    const { data: rows, error: fetchErr } = await supabaseAdmin
      .from('notifications_outbox')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (fetchErr) {
      console.error('[process-notification] fetch error', fetchErr)
      const { error: markFailedErr } = await supabaseAdmin
        .from('notifications_outbox')
        .update({ status: 'failed', last_error: String(fetchErr), attempts: outboxAttempts + 1 })
        .eq('id', id)
      if (markFailedErr) {
        console.error('[process-notification] failed to mark outbox row failed after fetch error', markFailedErr)
      }
      return jsonResponse({ error: 'Failed to fetch outbox item' }, 500)
    }

    if (!rows) return jsonResponse({ error: 'Outbox item not found' }, 404)

    outboxAttempts = typeof rows.attempts === 'number' ? rows.attempts : 0

    if (rows.status === 'sent') return jsonResponse({ message: 'Already processed' })

    const recipients = normalizeRecipients(rows.recipients)
    if (recipients.length === 0) {
      // Mark as sent to avoid reprocessing
      await supabaseAdmin.from('notifications_outbox').update({ status: 'sent' }).eq('id', id)
      return jsonResponse({ message: 'No recipients, marked sent' })
    }

    // Determine the notification type from the outbox payload so we can honor
    // per-type user preferences and stamp the in-app `notifications` row.
    const outboxData: Record<string, unknown> = (rows.data && typeof rows.data === 'object') ? rows.data : {}
    const notificationType = typeof outboxData.type === 'string' ? outboxData.type : 'system'

    // Load notification preferences for all recipients in a single query.
    // Missing rows / columns default to "allow" inside decideChannels().
    const prefsByUser = new Map<string, Record<string, unknown>>()
    try {
      const { data: prefsRows } = await supabaseAdmin
        .from('notification_preferences')
        .select('*')
        .in('user_id', recipients)
      for (const p of ((prefsRows || []) as Record<string, unknown>[])) {
        const userId = p?.user_id
        if (typeof userId === 'string') {
          prefsByUser.set(userId, p)
        }
      }
    } catch (e) {
      // Non-fatal: without preferences we fall back to delivering to everyone.
      console.error('[process-notification] preferences lookup failed (continuing with defaults)', e)
    }

    // Split recipients into those who should receive an in-app bell entry and
    // those who should receive a push, based on their preferences.
    const inAppRecipients: string[] = []
    const pushRecipients: string[] = []
    for (const userId of recipients) {
      const decision = decideChannels(prefsByUser.get(userId), notificationType)
      if (decision.inApp) inAppRecipients.push(userId)
      if (decision.push) pushRecipients.push(userId)
    }

    // Persist in-app notifications so the feed bell badge + list update for
    // every outbox-driven event (messages, applications, acceptances, etc.).
    // Guard on 'pending' so a retry of a previously-'failed' row does not
    // create duplicate bell entries (the rows were inserted on the first pass).
    if (rows.status === 'pending' && inAppRecipients.length > 0) {
      const notificationRows = inAppRecipients.map((userId) => ({
        user_id: userId,
        type: notificationType,
        title: rows.title || '',
        body: rows.body || '',
        data: rows.data || {},
      }))
      const { error: insertErr } = await supabaseAdmin.from('notifications').insert(notificationRows)
      if (insertErr) {
        // Non-fatal for push delivery, but surface it for observability.
        console.error('[process-notification] failed to insert in-app notifications', insertErr)
      }
    }

    if (pushRecipients.length === 0) {
      // No one wants a push for this event; in-app rows (if any) are saved.
      await supabaseAdmin.from('notifications_outbox').update({ status: 'sent', attempts: (rows.attempts || 0) + 1 }).eq('id', id)
      return jsonResponse({ message: 'In-app notifications saved; no push recipients', inApp: inAppRecipients.length })
    }

    // Fetch enabled tokens for push recipients only.
    const { data: tokens, error: tokenErr } = await supabaseAdmin
      .from('push_tokens')
      .select('token')
      .in('profile_id', pushRecipients)
      .eq('enabled', true)

    if (tokenErr) {
      console.error('[process-notification] token lookup error', tokenErr)
      await supabaseAdmin.from('notifications_outbox').update({ status: 'failed', last_error: String(tokenErr), attempts: (rows.attempts || 0) + 1 }).eq('id', id)
      return jsonResponse({ error: 'Failed to lookup tokens' }, 500)
    }

    const tokensList = (tokens || []).map((r: any) => r.token).filter(Boolean)
    if (tokensList.length === 0) {
      await supabaseAdmin.from('notifications_outbox').update({ status: 'sent', attempts: (rows.attempts || 0) + 1 }).eq('id', id)
      return jsonResponse({ message: 'In-app notifications saved; no tokens for recipients', inApp: inAppRecipients.length })
    }

    // Build Expo messages, keeping them positionally aligned with tokensList so
    // we can map Expo error tickets back to the originating token.
    const messages = createMessages(tokensList, { title: rows.title || '', body: rows.body || '', data: rows.data || {}, sound: 'default' })

    // Chunk and send directly to Expo Push API
    const chunkSize = 100
    const fetchImpl = fetch
    let sent = 0
    let errors: any[] = []
    const invalidTokens: string[] = []

    for (let i = 0; i < messages.length; i += chunkSize) {
      const chunk = messages.slice(i, i + chunkSize)
      const chunkTokens = tokensList.slice(i, i + chunkSize)
      try {
        const resp = await fetchImpl('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(chunk),
        })

        if (!resp.ok) {
          const text = await resp.text().catch(() => '')
          errors.push({ status: resp.status, body: text })
          continue
        }

        // Inspect per-message tickets to detect dead tokens for pruning.
        const respBody = await resp.json().catch(() => null)
        for (const dead of extractInvalidTokens(chunkTokens, respBody)) {
          invalidTokens.push(dead)
        }

        sent += chunk.length
      } catch (e) {
        errors.push(String(e))
      }
    }

    // Disable tokens Expo reported as permanently undeliverable so future
    // sends skip them and deliverability metrics stay healthy.
    if (invalidTokens.length > 0) {
      try {
        await supabaseAdmin
          .from('push_tokens')
          .update({ enabled: false, last_failed_at: new Date().toISOString() })
          .in('token', invalidTokens)
      } catch (e) {
        console.error('[process-notification] failed to disable invalid tokens', e)
      }
    }

    if (errors.length > 0) {
      await supabaseAdmin.from('notifications_outbox').update({ status: 'failed', last_error: JSON.stringify(errors), attempts: (rows.attempts || 0) + 1 }).eq('id', id)
      return jsonResponse({ ok: false, sent, errors, prunedTokens: invalidTokens.length }, 500)
    }

    await supabaseAdmin.from('notifications_outbox').update({ status: 'sent', attempts: (rows.attempts || 0) + 1 }).eq('id', id)

    return jsonResponse({ ok: true, sent, inApp: inAppRecipients.length, prunedTokens: invalidTokens.length })
  } catch (error) {
    console.error('[process-notification] error', error)
    // Best-effort: persist the failure reason on the outbox row so the cause is
    // diagnosable in the DB instead of being lost as an opaque 500. Marks the row
    // 'failed' and bumps attempts, consistent with the Expo-delivery error path,
    // rather than leaving it stuck in 'pending' with no last_error.
    if (supabaseAdmin && outboxId) {
      try {
        const { error: markFailedErr } = await supabaseAdmin
          .from('notifications_outbox')
          .update({ status: 'failed', last_error: String(error), attempts: outboxAttempts + 1 })
          .eq('id', outboxId)
        if (markFailedErr) {
          console.error('[process-notification] failed to record error on outbox row', markFailedErr)
        }
      } catch (updateErr) {
        console.error('[process-notification] failed to record error on outbox row (exception)', updateErr)
      }
    }
    return jsonResponse({ error: String(error) }, 500)
  }
})
