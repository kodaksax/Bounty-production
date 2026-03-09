import fetch from 'node-fetch'

const EDGE_BASE = process.env.SUPABASE_EDGE_URL?.replace(/\/$/, '')
const EDGE_KEY = process.env.SUPABASE_EDGE_KEY

if (!EDGE_BASE) {
  // Intentionally allow missing config; callers should handle absence
}

export async function sendPushViaEdge(messages: any[]) {
  if (!EDGE_BASE) throw new Error('SUPABASE_EDGE_URL not configured')

  const url = `${EDGE_BASE}/send-expo-push`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (EDGE_KEY) headers['Authorization'] = `Bearer ${EDGE_KEY}`

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(messages),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Edge function request failed: ${res.status} ${res.statusText} ${text}`)
  }

  return res.json()
}
