// Supabase Edge Function: process-notification
// POST { id: '<outbox-uuid>' }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { normalizeRecipients } from './recipients.ts'
import { createMessages } from './message.ts'

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

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: 'Supabase Edge Function is not configured' }, 500)

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  try {
    if (req.method !== 'POST') return jsonResponse({ error: 'Invalid method' }, 405)

    let payload: any
    try { 
      payload = await req.json();
    } catch (e) { 
      return jsonResponse({ error: 'Invalid JSON' }, 400);
    }

    // Support both direct {id} and Supabase Webhook {record: {id}} formats
    const id = sanitizeUuid(payload.record?.id || payload.id);

    // Fetch outbox row
    const { data: rows, error: fetchErr } = await supabaseAdmin
      .from('notifications_outbox')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (fetchErr) {
      console.error('[process-notification] fetch error', fetchErr)
      return jsonResponse({ error: 'Failed to fetch outbox item' }, 500)
    }

    if (!rows) return jsonResponse({ error: 'Outbox item not found' }, 404)

    if (rows.status === 'sent') return jsonResponse({ message: 'Already processed' })

    const recipients = normalizeRecipients(rows.recipients)
    if (recipients.length === 0) {
      // Mark as sent to avoid reprocessing
      await supabaseAdmin.from('notifications_outbox').update({ status: 'sent' }).eq('id', id)
      return jsonResponse({ message: 'No recipients, marked sent' })
    }

    // Fetch enabled tokens for recipients
    const { data: tokens, error: tokenErr } = await supabaseAdmin
      .from('push_tokens')
      .select('token')
      .in('profile_id', recipients)
      .eq('enabled', true)

    if (tokenErr) {
      console.error('[process-notification] token lookup error', tokenErr)
      await supabaseAdmin.from('notifications_outbox').update({ status: 'failed', last_error: String(tokenErr), attempts: (rows.attempts || 0) + 1 }).eq('id', id)
      return jsonResponse({ error: 'Failed to lookup tokens' }, 500)
    }

    const tokensList = (tokens || []).map((r: any) => r.token).filter(Boolean)
    if (tokensList.length === 0) {
      await supabaseAdmin.from('notifications_outbox').update({ status: 'sent' }).eq('id', id)
      return jsonResponse({ message: 'No tokens for recipients, marked sent' })
    }

    // Build Expo messages
    const messages = createMessages(tokensList, { title: rows.title || '', body: rows.body || '', data: rows.data || {}, sound: 'default' })

    // Chunk and send directly to Expo Push API
    const chunkSize = 100
    const fetchImpl = fetch
    let sent = 0
    let errors: any[] = []

    for (let i = 0; i < messages.length; i += chunkSize) {
      const chunk = messages.slice(i, i + chunkSize)
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

        sent += chunk.length
      } catch (e) {
        errors.push(String(e))
      }
    }

    if (errors.length > 0) {
      await supabaseAdmin.from('notifications_outbox').update({ status: 'failed', last_error: JSON.stringify(errors), attempts: (rows.attempts || 0) + 1 }).eq('id', id)
      return jsonResponse({ ok: false, sent, errors }, 500)
    }

    await supabaseAdmin.from('notifications_outbox').update({ status: 'sent', attempts: (rows.attempts || 0) + 1 }).eq('id', id)

    return jsonResponse({ ok: true, sent })
  } catch (error) {
    console.error('[process-notification] error', error)
    return jsonResponse({ error: String(error) }, 500)
  }
})
