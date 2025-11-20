import { supabase } from '../supabase';

// Simple in-memory dedupe to curb repetitive log spam in terminal
const lastInfo: { message: string; time: number } = { message: '', time: 0 };
const lastError: { message: string; time: number } = { message: '', time: 0 };
const DEDUPE_WINDOW_MS = 2000; // suppress identical messages repeated within 2s
const verboseClientLogs = process.env.EXPO_PUBLIC_LOG_CLIENT_VERBOSE === '1';

type LogLevel = 'info' | 'warn' | 'error'

export async function logClientError(message: string, metadata?: Record<string, any>) {
  const now = Date.now();
  const isDuplicate = !verboseClientLogs && message === lastError.message && (now - lastError.time) < DEDUPE_WINDOW_MS;
  lastError.message = message; lastError.time = now;
  if (isDuplicate) return; // skip console + remote insert
  // Normalize metadata so errors/objects are serializable and readable in logs
  let safeMeta: Record<string, any> = {};
  try {
    if (metadata) {
      for (const k of Object.keys(metadata)) {
        const v = (metadata as any)[k]
        try {
          safeMeta[k] = typeof v === 'string' ? v : JSON.parse(JSON.stringify(v))
        } catch (err) {
          try { safeMeta[k] = String(v) } catch { safeMeta[k] = null }
        }
      }
    }

    // Best-effort: try sending to a 'client_logs' table if it exists
    await supabase.from('client_logs').insert([{ level: 'error', message, metadata: safeMeta, created_at: new Date().toISOString() }])
  } catch (e) {
    // swallow - we don't want monitoring failures to break app logic
    // still print to console for local debugging
    // console.warn('monitoring: failed to send client log', e)
  }

  // Always output to console too - use the safe serialized metadata we built above
  try { console.error('[client_log]', message, Object.keys(safeMeta).length ? JSON.stringify(safeMeta) : undefined) } catch {}
}

export async function logClientInfo(message: string, metadata?: Record<string, any>) {
  const now = Date.now();
  const isDuplicate = !verboseClientLogs && message === lastInfo.message && (now - lastInfo.time) < DEDUPE_WINDOW_MS;
  lastInfo.message = message; lastInfo.time = now;
  if (isDuplicate) return;
  let safeMeta: Record<string, any> = {};
  try {
    if (metadata) {
      for (const k of Object.keys(metadata)) {
        const v = (metadata as any)[k]
        try {
          safeMeta[k] = typeof v === 'string' ? v : JSON.parse(JSON.stringify(v))
        } catch (err) {
          try { safeMeta[k] = String(v) } catch { safeMeta[k] = null }
        }
      }
    }
    await supabase.from('client_logs').insert([{ level: 'info', message, metadata: safeMeta, created_at: new Date().toISOString() }])
  } catch (e) {}
  try { console.log('[client_log]', message, Object.keys(safeMeta).length ? JSON.stringify(safeMeta) : undefined) } catch {}
}

export default { logClientError, logClientInfo }
