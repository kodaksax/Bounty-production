import { evaluateHunterQualification } from '../../../lib/matching/hunter-qualification.ts'

// Only targeting_version=1 bounty_nearby rows use these durable channel claims.
// A claim is NEVER stolen: interrupted provider calls become unknown, not resent.
// Provider acceptance is not device delivery. Exactly-once delivery is impossible
// when a provider response/DB acknowledgement is lost.
type Channel = 'push' | 'in_app' | 'email'
type State = 'accepted' | 'suppressed' | 'failed' | 'unknown'
type Admin = { from: (table: string) => any; rpc: (name: string, args: any) => any }

function isDefiniteTransactionRollback(error: unknown): boolean {
  return error !== null && typeof error === 'object'
    && ['40001', '40P01'].includes(String((error as { code?: unknown }).code))
}

export function isTargetingOutbox(row: { data?: any }): boolean {
  return row.data?.type === 'bounty_nearby' && row.data?.targeting_version === 1
}

export async function processTargetingOutbox(options: {
  admin: Admin
  row: any
  recipients: string[]
  supabaseUrl: string
  serviceRoleKey: string
  fetcher: typeof fetch
  newClaimId: () => string
  isValidToken: (token: unknown) => boolean
  isQuiet: (start: number | null, end: number | null, timezone: string | null) => boolean
  invalidTokens: (tokens: string[], response: unknown) => string[]
  qualificationMatchingEnabled?: boolean
  emitEvent?: (event: { event: string; distinct_id: string; properties: Record<string, unknown> }) => void
}): Promise<{ ok: boolean; acceptedPushRecipients: number }> {
  const { admin, row, fetcher } = options
  if (!isTargetingOutbox(row)) throw new Error('Not a targeting outbox item')
  const recipients = [...new Set(options.recipients)]
  const bountyId = row.data.bountyId
  const { data: bounty, error: bountyError } = await admin.from('bounties')
    .select('id, status, is_test, poster_id, user_id').eq('id', bountyId).maybeSingle()
  if (bountyError) throw new Error('Targeting bounty lookup failed')
  const qualificationResults = new Map<string, ReturnType<typeof evaluateHunterQualification>>()
  let qualificationTaskId: string | undefined
  let qualificationTaxonomyVersion: number | undefined
  if (options.qualificationMatchingEnabled) {
    const { data: requirements, error: requirementsError } = await admin.from('bounty_requirements')
      .select('taxonomy_version, task_id, term_id, importance').eq('bounty_id', bountyId)
    if (requirementsError) throw new Error('Targeting requirements lookup failed')
    if (requirements?.length) {
      const versions = new Set<number>(requirements.map((term: any) => term.taxonomy_version))
      const tasks = new Set<string>(requirements.map((term: any) => term.task_id))
      if (versions.size !== 1 || tasks.size !== 1) throw new Error('Targeting requirements are inconsistent')
      const { data: declarations, error: capabilitiesError } = recipients.length
        ? await admin.from('hunter_capabilities')
          .select('owner_id, taxonomy_version, task_id, term_id, provenance').in('owner_id', recipients)
        : { data: [], error: null }
      if (capabilitiesError) throw new Error('Targeting capability lookup failed')
      const capabilitiesByHunter = new Map<string, any[]>()
      for (const declaration of declarations ?? []) {
        if (declaration.provenance !== 'self_reported') continue
        const current = capabilitiesByHunter.get(declaration.owner_id) ?? []
        current.push({
          taxonomy_version: declaration.taxonomy_version,
          task_id: declaration.task_id,
          term_id: declaration.term_id,
          provenance: 'self_reported',
        })
        capabilitiesByHunter.set(declaration.owner_id, current)
      }
      const input = {
        taxonomy_version: [...versions][0],
        task_id: [...tasks][0],
        terms: requirements.map(({ term_id, importance }: any) => ({ term_id, importance })),
      }
      qualificationTaskId = input.task_id
      qualificationTaxonomyVersion = input.taxonomy_version
      for (const hunterId of recipients) {
        qualificationResults.set(
          hunterId,
          evaluateHunterQualification(input, capabilitiesByHunter.get(hunterId) ?? []),
        )
      }
      recipients.sort((a, b) =>
        (qualificationResults.get(b)?.score ?? 0) - (qualificationResults.get(a)?.score ?? 0)
        || a.localeCompare(b))
    }
  }
  const { data: gate, error: gateError } = await admin.rpc('fn_bounty_distribution_gate', {
    p_bounty_id: bountyId, p_path: 'targeting', p_stage: row.data.stage ?? 1,
    p_require_credibility: (row.data.stage ?? 1) > 1,
  })
  if (gateError) throw new Error('Targeting distribution gate failed')
  const eligibleBounty = bounty && bounty.status === 'open' && !bounty.is_test && gate?.allowed === true
  const { data: profiles, error: profileError } = await admin.from('profiles')
    .select('id, account_status, deleted_at, quiet_hours_start, quiet_hours_end, notification_timezone')
    .in('id', recipients)
  const { data: preferences, error: preferenceError } = await admin.from('notification_channel_preferences')
    .select('user_id, channel, enabled').in('user_id', recipients).eq('category', 'marketplace')
  const { data: requests, error: requestError } = await admin.from('bounty_requests')
    .select('hunter_id').eq('bounty_id', bountyId).in('hunter_id', recipients)
  // Recruitment must not fail open on a failed privacy/preference lookup.
  if (profileError || preferenceError || requestError) throw new Error('Targeting eligibility lookup failed')
  const profileMap = new Map<string, any>((profiles ?? []).map((p: any) => [p.id, p]))
  const applicantIds = new Set((requests ?? []).map((r: any) => r.hunter_id))
  const prefMap = new Map<string, boolean>((preferences ?? []).map((p: any) => [`${p.user_id}:${p.channel}`, p.enabled]))
  let acceptedPushRecipients = 0

  for (const hunterId of recipients) {
    const qualification = qualificationResults.get(hunterId)
    const profile = profileMap.get(hunterId)
    const candidateEligible = Boolean(eligibleBounty && profile && profile.account_status === 'active'
      && !profile.deleted_at && hunterId !== (bounty.poster_id ?? bounty.user_id) && !applicantIds.has(hunterId))
    if (candidateEligible && qualification) options.emitEvent?.({
      event: 'qualification_match_evaluated',
      distinct_id: hunterId,
      properties: {
        bounty_id: bountyId,
        task_id: qualificationTaskId,
        taxonomy_version: qualificationTaxonomyVersion,
        eligible: qualification.eligible,
        score: qualification.score,
        matched_required_count: qualification.matchedTerms.filter(term => term.importance === 'required').length,
        matched_preferred_count: qualification.matchedTerms.filter(term => term.importance === 'preferred').length,
        missing_required_count: qualification.missingRequiredTerms.length,
        evidence_basis: 'self_reported',
      },
    })
    const eligible = candidateEligible && qualification?.eligible !== false
    for (const channel of ['in_app', 'push', 'email'] as Channel[]) {
      const claimId = options.newClaimId()
      const args = { p_outbox_id: row.id, p_hunter_id: hunterId, p_channel: channel, p_claim_id: claimId }
      const { data: claimed, error: claimError } = await admin.rpc('fn_claim_bounty_targeting_delivery', args)
      if (claimError) throw new Error('Targeting channel claim failed')
      if (claimed !== true) continue
      if (eligible && channel === 'in_app' && (row.attempts ?? 0) === 0) {
        const channels = (['in_app', 'push', 'email'] as Channel[]).filter(c =>
          prefMap.get(`${hunterId}:${c}`) !== false
          && !(c === 'in_app' && row.data.skipInApp === true)
          && (c === 'in_app' || !options.isQuiet(
            profile.quiet_hours_start, profile.quiet_hours_end, profile.notification_timezone)))
        if (channels.length > 0) options.emitEvent?.({
          event: 'notification_generated', distinct_id: hunterId,
          properties: { notification_type: 'bounty_nearby', category: 'marketplace',
            notification_id: row.id, bounty_id: bountyId, channels, targeting_version: 1 },
        })
      }
      let state: State = 'suppressed'
      let reason: string | null = null
      const quiet = channel !== 'in_app' && profile && options.isQuiet(
        profile.quiet_hours_start, profile.quiet_hours_end, profile.notification_timezone)
      if (eligible && prefMap.get(`${hunterId}:${channel}`) !== false && !quiet
        && !(channel === 'in_app' && row.data.skipInApp === true)) {
        if (channel === 'in_app') {
          try {
            const { error } = await admin.from('notifications').insert({
              user_id: hunterId, type: 'bounty_nearby', category: 'marketplace',
              title: row.title ?? '', body: row.body ?? '', data: row.data,
            })
            state = error ? (isDefiniteTransactionRollback(error) ? 'failed' : 'unknown') : 'accepted'
            if (error) reason = isDefiniteTransactionRollback(error)
              ? 'In-app insert rolled back and may be retried'
              : 'In-app insert outcome could not be acknowledged'
          } catch (error) {
            state = isDefiniteTransactionRollback(error) ? 'failed' : 'unknown'
            reason = state === 'failed'
              ? 'In-app insert rolled back and may be retried'
              : 'In-app insert outcome unknown'
          }
        } else if (channel === 'push') {
          let tokens: string[] = []
          try {
            const { data, error } = await admin.from('push_tokens').select('token')
              .eq('profile_id', hunterId).eq('enabled', true)
            if (error) {
              state = 'failed'
              reason = 'Push token lookup failed before sending'
            } else {
              tokens = [...new Set<string>((data ?? []).map((t: any) =>
                typeof t.token === 'string' ? t.token.trim() : '').filter(options.isValidToken))].slice(0, 100)
              if (tokens.length === 0) reason = 'No deliverable push token'
            }
          } catch {
            state = 'failed'
            reason = 'Push token lookup failed before sending'
          }
          if (tokens.length > 0) {
            try {
              const response = await fetcher('https://exp.host/--/api/v2/push/send', {
                method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                signal: AbortSignal.timeout(20000),
                body: JSON.stringify(tokens.map(to => ({
                  to, title: row.title ?? '', body: row.body ?? '', data: row.data, sound: 'default',
                }))),
              })
              const result = await response.json().catch(() => null)
              const invalid = response.ok ? options.invalidTokens(tokens, result) : []
              if (invalid.length > 0) {
                // Reuse the worker's permanent-token classification. Project
                // credential failures must never prune healthy device tokens.
                try {
                  const { error } = await admin.from('push_tokens').delete().in('token', invalid)
                  if (error) console.error('[process-notification] targeting token prune failed', error)
                } catch (error) {
                  console.error('[process-notification] targeting token prune failed', error)
                }
              }
              const tickets: any[] | null = Array.isArray(result?.data) ? result.data : null
              if (response.status === 429) {
                // Expo explicitly rejects a rate-limited request before sending.
                // Unlike a timeout/5xx response, this is safe to retry.
                state = 'failed'
                reason = 'Provider rejected push request due to rate limiting'
              } else if (response.ok && tickets?.some(t => t?.status === 'ok' && typeof t.id === 'string')) {
                state = 'accepted'
                acceptedPushRecipients++
              } else if (response.ok && tickets?.length === tokens.length && tickets.every(t => t?.status === 'error')) {
                state = 'failed'
                reason = 'Provider explicitly rejected all push tickets'
              } else {
                state = 'unknown'
                reason = 'Push provider outcome unknown; not automatically resent'
              }
            } catch {
              state = 'unknown'
              reason = 'Push provider response lost; not automatically resent'
            }
          }
        } else {
          try {
            const response = await fetcher(`${options.supabaseUrl}/functions/v1/send-notification-email`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: ['Bearer', options.serviceRoleKey].join(' ') },
              signal: AbortSignal.timeout(20000),
              body: JSON.stringify({
                userIds: [hunterId], category: 'marketplace', type: 'bounty_nearby',
                title: row.title ?? '', body: row.body ?? '', data: row.data,
              }),
            })
            const result = await response.json().catch(() => null)
            state = response.ok && result?.sent > 0 ? 'accepted'
              : result?.providerConfigured === false ? 'suppressed' : 'unknown'
            if (state === 'unknown') reason = 'Email provider outcome unknown; not automatically resent'
          } catch {
            state = 'unknown'
            reason = 'Email provider response lost; not automatically resent'
          }
        }
      }
      const { data: acknowledged, error: ackError } = await admin.rpc('fn_ack_bounty_targeting_delivery', {
        ...args, p_state: state, p_error: reason,
      })
      if (ackError || acknowledged !== true) throw new Error('Targeting channel acknowledgement failed')
      if (state === 'accepted' || state === 'failed' || state === 'unknown') {
        options.emitEvent?.({
          event: state === 'accepted' ? 'notification_sent' : 'notification_failed',
          distinct_id: hunterId,
          properties: {
            notification_type: 'bounty_nearby', category: 'marketplace', bounty_id: bountyId,
            notification_id: row.id, channel, targeting_version: 1, delivery_state: state,
            ...(state === 'accepted'
              ? { notification_delivered_via: channel,
                  delivery_basis: channel === 'in_app' ? 'in_app_created' : 'provider_accepted',
                  device_delivery_confirmed: false }
              : { reason, provider_outcome_unknown: state === 'unknown' }),
          },
        })
      }
    }
  }
  const { data: finished, error: finishError } = await admin.rpc('fn_finish_bounty_targeting_outbox', { p_outbox_id: row.id })
  if (finishError) throw new Error('Targeting outbox finalization failed')
  return { ok: finished === true, acceptedPushRecipients }
}
