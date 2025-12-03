import NetInfo from '@react-native-community/netinfo';
import type { Bounty } from "lib/services/database.types";
import { isSupabaseConfigured, supabase } from 'lib/supabase';
import { logger } from "lib/utils/error-logger";
import { getReachableApiBaseUrl } from 'lib/utils/network';
import { offlineQueueService } from './offline-queue-service';

// Helper: if the profiles relationship no longer exists in the DB schema, fallback
// to fetching bounties without the join and then separately fetch profiles by poster_id
// and attach username/avatar to the bounty objects.
async function attachProfilesToBounties(items: any[]) {
  if (!items || items.length === 0) return items
  try {
    const ids = Array.from(new Set(items.map(i => i.poster_id).filter(Boolean)))
    if (ids.length === 0) return items
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, username, avatar')
      .in('id', ids)

    if (error) {
      logger.warning('Could not fetch profiles for bounties fallback', { error })
      return items.map((it: any) => ({ ...it }))
    }

    const map = new Map<string, any>()
    ;(profiles || []).forEach((p: any) => map.set(String(p.id), p))
    return items.map((it: any) => ({
      ...it,
      username: map.get(String(it.poster_id))?.username,
      poster_avatar: map.get(String(it.poster_id))?.avatar,
    }))
  } catch (e) {
    // If anything goes wrong, return original items
    logger.warning('attachProfilesToBounties fallback failed', { error: (e as any)?.message })
    return items
  }
}

// API Configuration
function getApiBaseUrl() {
  const preferred = (process.env.EXPO_PUBLIC_API_BASE_URL as string | undefined)
    || (process.env.API_BASE_URL as string | undefined)
    || 'http://localhost:3001'
  const base = getReachableApiBaseUrl(preferred, 3001)
  logOnce('bounties:apiBase', 'warn', `Using API base: ${base}`)
  return base
}

// Simple once-per-key logger to avoid spamming console when backend is offline
const emitted: Record<string, boolean> = {}
function logOnce(key: string, level: 'error' | 'warn', message: string, meta?: any) {
  if (emitted[key]) return
  emitted[key] = true
  if (level === 'error') {
    logger.error(message, meta)
  } else {
    if (typeof (logger as any).warning === 'function') {
      ;(logger as any).warning(message, meta)
    } else {
      logger.error(message, meta)
    }
  }
}

// Spam prevention constants
const DAILY_BOUNTY_LIMIT = 10;  // Maximum bounties a user can create per day
const MIN_TITLE_LENGTH_FOR_DUPLICATE_CHECK = 10;  // Minimum title length for substring matching

export const bountyService = {
  /**
   * Get a bounty by ID
   */
  async getById(id: number | string): Promise<Bounty | null> {
    try {
      // Prefer Supabase when configured; Supabase can match UUID or numeric ids depending on schema
      if (isSupabaseConfigured) {
        const { data, error } = await supabase
          .from('bounties')
          .select(`
            *,
            profiles!bounties_profiles_fkey (
              username,
              avatar
            )
          `)
          .eq('id', id as any)
          .single()

        if (error) {
          // Supabase returns a plain object for errors. If the relationship to
          // profiles was removed, fallback to join-less retrieval and attach profiles.
          const msg = (error as any)?.message ?? JSON.stringify(error)
          logger.error('Supabase getById error', { error })
          if (/Could not find a relationship between 'bounties' and 'profiles'/.test(msg)) {
            // Fetch bounty without join and then attach profile
            const { data: raw, error: rawErr } = await supabase
              .from('bounties')
              .select('*')
              .eq('id', id as any)
              .single()

            if (rawErr) throw new Error((rawErr as any)?.message ?? JSON.stringify(rawErr))
            const withProfile = await attachProfilesToBounties([raw])
            return (withProfile[0] as unknown as Bounty) ?? null
          }
          throw new Error(msg)
        }
        
        // Transform data to flatten profile info
        if (data) {
          const bounty = {
            ...data,
            poster_id: (data as any).user_id ?? (data as any).poster_id,
            user_id: (data as any).user_id ?? (data as any).poster_id,
            username: (data as any).profiles?.username,
            poster_avatar: (data as any).profiles?.avatar,
            profiles: undefined,
          }
          return bounty as Bounty
        }
        return null
      }

  const API_URL = `${getApiBaseUrl()}/api/bounties/${encodeURIComponent(String(id))}`
      const response = await fetch(API_URL, {
        headers: {
          'Content-Type': 'application/json',
        }
      })

      if (!response.ok) {
        if (response.status === 404) {
          logger.warning("Bounty not found", { id })
          return null
        }
        throw new Error(`Failed to fetch bounty: ${response.statusText}`)
      }
      return await response.json()
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error fetching bounty")
      logger.error("Error fetching bounty by ID", { id, error })
      return null
    }
  },

      /**
       * Add an attachment to a bounty's attachments_json (persist via Supabase or API fallback)
       */
      async addAttachmentToBounty(bountyId: number | string, attachment: any): Promise<boolean> {
        try {
              // Fetch existing bounty so we can merge attachments
              const existing = await this.getById(bountyId)
              const rawExisting = (existing as any)?.attachments_json
              let current: any[] = []
              try {
                if (!rawExisting) {
                  current = []
                } else if (typeof rawExisting === 'string') {
                  current = JSON.parse(rawExisting)
                } else if (Array.isArray(rawExisting)) {
                  current = rawExisting
                } else if (rawExisting && typeof rawExisting === 'object') {
                  // Defensive: if DB returned an object, attempt to coerce to array
                  current = Array.isArray((rawExisting as any)) ? (rawExisting as any) : []
                } else {
                  current = []
                }
              } catch (e) {
                // On parse errors, fall back to empty array to avoid blocking upload
                current = []
              }

              current.push(attachment)

              const payload = { attachments_json: JSON.stringify(current) }

              // Persist
              if (isSupabaseConfigured) {
                try {
                  const { data, error } = await supabase
                    .from('bounties')
                    .update(payload)
                    .eq('id', bountyId)
                    .select()

                  if (error) {
                    // Log and attempt API relay fallback (service role) for environments
                    // where client cannot update rows due to RLS or missing permissions.
                    logger.error('Failed to update bounty attachments via Supabase', { error })
                    // Attempt relay to backend API to persist using service credentials
                    try {
                      const API_URL = `${getApiBaseUrl()}/api/bounties/${encodeURIComponent(String(bountyId))}`
                      const res = await fetch(API_URL, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                      })
                      if (!res.ok) {
                        const text = await res.text()
                        logger.error('Failed to update bounty attachments via API fallback after Supabase error', { status: res.status, body: text })
                        return false
                      }
                      return true
                    } catch (apiErr) {
                      logger.error('Error calling API to update bounty attachments after Supabase error', { error: (apiErr as any)?.message })
                      return false
                    }
                  }
                  return true
                } catch (e) {
                  logger.error('Unexpected error updating bounty attachments via Supabase', { error: (e as any)?.message })
                  // Try API fallback once more
                  try {
                    const API_URL = `${getApiBaseUrl()}/api/bounties/${encodeURIComponent(String(bountyId))}`
                    const res = await fetch(API_URL, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(payload),
                    })
                    if (!res.ok) {
                      const text = await res.text()
                      logger.error('Failed to update bounty attachments via API fallback after unexpected Supabase error', { status: res.status, body: text })
                      return false
                    }
                    return true
                  } catch (apiErr) {
                    logger.error('Error calling API to update bounty attachments after unexpected Supabase error', { error: (apiErr as any)?.message })
                    return false
                  }
                }
              }

              // API fallback when not using Supabase client
              try {
                const API_URL = `${getApiBaseUrl()}/api/bounties/${encodeURIComponent(String(bountyId))}`
                const res = await fetch(API_URL, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(payload),
                })
                if (!res.ok) {
                  const text = await res.text()
                  logger.error('Failed to update bounty attachments via API', { status: res.status, body: text })
                  return false
                }
                return true
              } catch (apiErr) {
                logger.error('Error calling API to update bounty attachments', { error: (apiErr as any)?.message })
                return false
              }
        } catch (err) {
          logger.error('addAttachmentToBounty error', { error: (err as any)?.message })
          return false
        }
      },

  /**
   * Search open bounties by text (title / description). Returns an empty list on failure instead of throwing.
   * Server-side filtered to reduce bandwidth; falls back progressively.
   */
  async search(query: string, options?: { limit?: number; offset?: number }): Promise<Bounty[]> {
    const q = query.trim()
    if (!q) return []
    try {
      if (isSupabaseConfigured) {
        // Prefer full text search if a tsvector column exists; otherwise fallback to ilike OR combination.
        // We'll attempt using ilike on both title & description for broad match.
        const limit = options?.limit ?? 20
        const offset = options?.offset ?? 0
        let sbQuery = supabase
          .from('bounties')
          .select(`
            *,
            profiles!bounties_profiles_fkey (
              username,
              avatar
            )
          `)
          .eq('status', 'open')
          .or(`title.ilike.%${q}%,description.ilike.%${q}%`)
          .order('created_at', { ascending: false })
          .range(offset, offset + limit - 1)

        const { data, error } = await sbQuery
        if (error) {
          const msg = (error as any)?.message ?? JSON.stringify(error)
          logger.error('Supabase search error', { error, query: q })
          if (/Could not find a relationship between 'bounties' and 'profiles'/.test(msg)) {
            // Query without join then attach profiles
            const { data: dataNoJoin, error: rawErr } = await supabase
              .from('bounties')
              .select('*')
              .eq('status', 'open')
              .or(`title.ilike.%${q}%,description.ilike.%${q}%`)
              .order('created_at', { ascending: false })
              .range(offset, offset + limit - 1)

            if (rawErr) throw new Error((rawErr as any)?.message ?? JSON.stringify(rawErr))
            const merged = await attachProfilesToBounties(dataNoJoin || [])
            return merged as Bounty[]
          }
          throw new Error(msg)
        }
        
        // Transform data to flatten profile info
        const bounties = (data || []).map((item: any) => ({
          ...item,
          poster_id: item.user_id ?? item.poster_id,
          user_id: item.user_id ?? item.poster_id,
          username: item.profiles?.username,
          poster_avatar: item.profiles?.avatar,
          profiles: undefined,
        }))
        
        return bounties as Bounty[]
      }

      // API fallback: if backend supports /api/bounties?search=...
      try {
        const params = new URLSearchParams()
        params.append('status', 'open')
        params.append('search', q)
        if (options?.limit != null) params.append('limit', String(options.limit))
        if (options?.offset != null) params.append('offset', String(options.offset))
        const response = await fetch(`${getApiBaseUrl()}/api/bounties?${params.toString()}`)
        if (!response.ok) throw new Error(`Search API failed: ${response.status}`)
        const json = await response.json()
        return Array.isArray(json) ? (json as Bounty[]) : []
      } catch (apiErr) {
        logOnce('bounties:searchApi', 'warn', 'Search API fallback failed', { message: (apiErr as any)?.message })
      }
    } catch (err) {
      logOnce('bounties:search', 'warn', 'Search failed (returning empty)', { query, error: (err as any)?.message })
    }
    return []
  },

  /**
   * Advanced search with filtering and sorting
   */
  async searchWithFilters(filters: {
    keywords?: string;
    location?: string;
    minAmount?: number;
    maxAmount?: number;
    status?: string[];
    workType?: 'online' | 'in_person';
    isForHonor?: boolean;
    skills?: string[];
    sortBy?: 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc' | 'distance_asc';
    limit?: number;
    offset?: number;
  }): Promise<Bounty[]> {
    try {
      if (isSupabaseConfigured) {
        const limit = filters.limit ?? 20
        const offset = filters.offset ?? 0
        
        let query = supabase
          .from('bounties')
          .select(`
            *,
            profiles!bounties_profiles_fkey (
              username,
              avatar
            )
          `)

        // Apply filters
        if (filters.status && filters.status.length > 0) {
          query = query.in('status', filters.status)
        } else {
          query = query.neq('status', 'archived')
        }

        if (filters.keywords) {
          query = query.or(`title.ilike.%${filters.keywords}%,description.ilike.%${filters.keywords}%`)
        }

        if (filters.location) {
          query = query.ilike('location', `%${filters.location}%`)
        }

        if (filters.minAmount !== undefined) {
          query = query.gte('amount', filters.minAmount)
        }

        if (filters.maxAmount !== undefined) {
          query = query.lte('amount', filters.maxAmount)
        }

        if (filters.workType) {
          query = query.eq('work_type', filters.workType)
        }

        if (filters.isForHonor !== undefined) {
          query = query.eq('is_for_honor', filters.isForHonor)
        }

        if (filters.skills && filters.skills.length > 0) {
          // Search in skills_required field
          const skillsPattern = filters.skills.join('|')
          query = query.or(filters.skills.map(s => `skills_required.ilike.%${s}%`).join(','))
        }

        // Apply sorting
        switch (filters.sortBy) {
          case 'date_desc':
            query = query.order('created_at', { ascending: false })
            break
          case 'date_asc':
            query = query.order('created_at', { ascending: true })
            break
          case 'amount_desc':
            query = query.order('amount', { ascending: false })
            break
          case 'amount_asc':
            query = query.order('amount', { ascending: true })
            break
          default:
            query = query.order('created_at', { ascending: false })
        }

        query = query.range(offset, offset + limit - 1)

        const { data, error } = await query

        if (error) {
          const msg = (error as any)?.message ?? JSON.stringify(error)
          logger.error('Supabase searchWithFilters error', { error, filters })
          if (/Could not find a relationship between 'bounties' and 'profiles'/.test(msg)) {
            // Try without join
            let queryNoJoin = supabase.from('bounties').select('*')
            
            if (filters.status && filters.status.length > 0) {
              queryNoJoin = queryNoJoin.in('status', filters.status)
            } else {
              queryNoJoin = queryNoJoin.neq('status', 'archived')
            }

            if (filters.keywords) {
              queryNoJoin = queryNoJoin.or(`title.ilike.%${filters.keywords}%,description.ilike.%${filters.keywords}%`)
            }

            // Apply other filters...
            if (filters.location) {
              queryNoJoin = queryNoJoin.ilike('location', `%${filters.location}%`)
            }

            if (filters.minAmount !== undefined) {
              queryNoJoin = queryNoJoin.gte('amount', filters.minAmount)
            }

            if (filters.maxAmount !== undefined) {
              queryNoJoin = queryNoJoin.lte('amount', filters.maxAmount)
            }

            if (filters.workType) {
              queryNoJoin = queryNoJoin.eq('work_type', filters.workType)
            }

            if (filters.isForHonor !== undefined) {
              queryNoJoin = queryNoJoin.eq('is_for_honor', filters.isForHonor)
            }

            // Apply sorting
            switch (filters.sortBy) {
              case 'date_desc':
                queryNoJoin = queryNoJoin.order('created_at', { ascending: false })
                break
              case 'date_asc':
                queryNoJoin = queryNoJoin.order('created_at', { ascending: true })
                break
              case 'amount_desc':
                queryNoJoin = queryNoJoin.order('amount', { ascending: false })
                break
              case 'amount_asc':
                queryNoJoin = queryNoJoin.order('amount', { ascending: true })
                break
              default:
                queryNoJoin = queryNoJoin.order('created_at', { ascending: false })
            }

            queryNoJoin = queryNoJoin.range(offset, offset + limit - 1)

            const { data: dataNoJoin, error: rawErr } = await queryNoJoin
            if (rawErr) throw new Error((rawErr as any)?.message ?? JSON.stringify(rawErr))
            const merged = await attachProfilesToBounties(dataNoJoin || [])
            return merged as Bounty[]
          }
          throw new Error(msg)
        }

        const bounties = (data || []).map((item: any) => ({
          ...item,
          poster_id: item.user_id ?? item.poster_id,
          user_id: item.user_id ?? item.poster_id,
          username: item.profiles?.username,
          poster_avatar: item.profiles?.avatar,
          profiles: undefined,
        }))

        return bounties as Bounty[]
      }

      // API fallback - construct query parameters
      const params = new URLSearchParams()
      if (filters.keywords) params.append('search', filters.keywords)
      if (filters.location) params.append('location', filters.location)
      if (filters.minAmount !== undefined) params.append('minAmount', String(filters.minAmount))
      if (filters.maxAmount !== undefined) params.append('maxAmount', String(filters.maxAmount))
      if (filters.workType) params.append('workType', filters.workType)
      if (filters.isForHonor !== undefined) params.append('isForHonor', String(filters.isForHonor))
      if (filters.sortBy) params.append('sortBy', filters.sortBy)
      if (filters.limit) params.append('limit', String(filters.limit))
      if (filters.offset) params.append('offset', String(filters.offset))

      const response = await fetch(`${getApiBaseUrl()}/api/bounties/search?${params.toString()}`)
      if (!response.ok) throw new Error(`Search API failed: ${response.status}`)
      const json = await response.json()
      return Array.isArray(json) ? (json as Bounty[]) : []
    } catch (err) {
      logger.error('searchWithFilters failed', { filters, error: (err as any)?.message })
      return []
    }
  },

  /**
   * Get all bounties
   */
  async getAll(options?: {
    status?: string;
    userId?: string;
    workType?: 'online' | 'in_person';
    limit?: number;
    offset?: number;
    includeArchived?: boolean;
  }): Promise<Bounty[]> {
    try {
      // Prefer Supabase when configured
      if (isSupabaseConfigured) {
        // Join with profiles to get username and avatar
        let query = supabase
          .from('bounties')
          .select(`
            *,
            profiles!bounties_profiles_fkey (
              username,
              avatar
            )
          `)
          .order('created_at', { ascending: false })

        if (options?.status) query = query.eq('status', options.status)
        if (options?.userId) query = query.eq('poster_id', options.userId)
        if (options?.workType) query = query.eq('work_type', options.workType)
        if (!options?.includeArchived) query = query.neq('status', 'archived')

        const limit = options?.limit ?? 20
        const offset = options?.offset ?? 0
        query = query.range(offset, offset + limit - 1)

        const { data, error } = await query
        if (error) {
          const msg = (error as any)?.message ?? JSON.stringify(error)
          logger.error('Supabase getAll error', { error, options })
          if (/Could not find a relationship between 'bounties' and 'profiles'/.test(msg)) {
            // Fetch without join then attach profiles
            let qNoJoin: any = supabase.from('bounties').select('*').order('created_at', { ascending: false })
            if (options?.status) qNoJoin = qNoJoin.eq('status', options.status)
              if (options?.userId) qNoJoin = qNoJoin.eq('poster_id', options.userId)
            if (options?.workType) qNoJoin = qNoJoin.eq('work_type', options.workType)
            if (!options?.includeArchived) qNoJoin = qNoJoin.neq('status', 'archived')
            qNoJoin = qNoJoin.range(offset, offset + limit - 1)

            const { data: dataNoJoin, error: rawErr } = await qNoJoin
            if (rawErr) throw new Error((rawErr as any)?.message ?? JSON.stringify(rawErr))
            const merged = await attachProfilesToBounties(dataNoJoin || [])
            return (merged || []).map((i: any) => ({ ...i, user_id: i.poster_id })) as Bounty[]
          }
          throw new Error(msg)
        }
        
        // Transform data to flatten profile info into bounty object
        const bounties = (data || []).map((item: any) => ({
          ...item,
          poster_id: item.user_id ?? item.poster_id,
          user_id: item.user_id ?? item.poster_id,
          username: item.profiles?.username,
          poster_avatar: item.profiles?.avatar,
          profiles: undefined, // Remove nested profiles object
        }))
        
        return bounties as Bounty[]
      }

  const API_URL = `${getApiBaseUrl()}/api/bounties`
      const params = new URLSearchParams()

  if (options?.status) params.append("status", options.status)
  if (options?.userId) params.append("poster_id", options.userId)
      if (options?.workType) params.append('work_type', options.workType)
      if (options?.limit != null) params.append('limit', String(options.limit))
      if (options?.offset != null) params.append('offset', String(options.offset))
      // archived filtering handled client-side if API doesn't support it
      
  const response = await fetch(`${API_URL}?${params.toString()}`)
      if (!response.ok) {
        throw new Error(`Failed to fetch bounties: ${response.statusText}`)
      }
      const json = await response.json()
      let list = Array.isArray(json) ? json as Bounty[] : []
      if (!options?.includeArchived) list = list.filter(b => b.status !== 'archived')
      if (options?.limit != null || options?.offset != null) {
        const start = options?.offset ?? 0
        const end = options?.limit != null ? start + options.limit : undefined
        list = list.slice(start, end)
      }
      return list
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error fetching bounties")
      // Heuristics for network issues
      const isNetworkError = error.message.includes('Network') || error.message.includes('fetch') || !(error as any).status
      logOnce(
        'bounties:getAll',
        'error',
        'Error fetching bounties (showing once until reload)',
        {
          options,
          error: { message: error.message, stack: error.stack },
          apiBase: getApiBaseUrl(),
            hint: isNetworkError ? 'Check that the API server is running and device can reach the host (if on physical device, replace localhost with your machine LAN IP).' : undefined,
        }
      )
      return []
    }
  },

  /**
   * Create a new bounty with offline support
   * Includes spam prevention: rate limiting (max 10/day) and duplicate detection
   */
  async create(bounty: Omit<Bounty, "id" | "created_at">): Promise<Bounty | null> {
    try {
      // Spam prevention: rate limiting - max 10 bounties per day
      const posterId = (bounty as any).poster_id || (bounty as any).user_id;
      if (posterId && isSupabaseConfigured) {
        try {
          const oneDayAgo = new Date();
          oneDayAgo.setDate(oneDayAgo.getDate() - 1);
          
          const { count, error: countError } = await supabase
            .from('bounties')
            .select('*', { count: 'exact', head: true })
            .eq('poster_id', posterId)
            .gte('created_at', oneDayAgo.toISOString());
          
          if (!countError && count !== null && count >= DAILY_BOUNTY_LIMIT) {
            logger.warning('Rate limit exceeded for bounty creation', { posterId, count });
            throw new Error(`Rate limit exceeded: You can only create ${DAILY_BOUNTY_LIMIT} bounties per day. Please try again tomorrow.`);
          }
        } catch (rateLimitError) {
          if (rateLimitError instanceof Error && rateLimitError.message.includes('Rate limit exceeded')) {
            throw rateLimitError;
          }
          // Log but don't block if rate limit check fails
          logger.warning('Rate limit check failed, proceeding with creation', { error: rateLimitError });
        }
      }
      
      // Spam prevention: duplicate detection - check for similar titles in last 24 hours
      if (posterId && bounty.title && isSupabaseConfigured) {
        try {
          const oneDayAgo = new Date();
          oneDayAgo.setDate(oneDayAgo.getDate() - 1);
          
          const { data: recentBounties, error: dupError } = await supabase
            .from('bounties')
            .select('title')
            .eq('poster_id', posterId)
            .gte('created_at', oneDayAgo.toISOString());
          
          if (!dupError && recentBounties && recentBounties.length > 0) {
            const normalizedNewTitle = bounty.title.toLowerCase().trim();
            const isDuplicate = recentBounties.some((b: { title: string }) => {
              const existingTitle = (b.title || '').toLowerCase().trim();
              // Check for exact match or substring match for longer titles
              return existingTitle === normalizedNewTitle || 
                     (existingTitle.length > MIN_TITLE_LENGTH_FOR_DUPLICATE_CHECK && normalizedNewTitle.includes(existingTitle)) ||
                     (normalizedNewTitle.length > MIN_TITLE_LENGTH_FOR_DUPLICATE_CHECK && existingTitle.includes(normalizedNewTitle));
            });
            
            if (isDuplicate) {
              logger.warning('Duplicate bounty detected', { posterId, title: bounty.title });
              throw new Error('Duplicate content detected: A similar bounty was recently posted. Please create unique content.');
            }
          }
        } catch (dupError) {
          if (dupError instanceof Error && dupError.message.includes('Duplicate content detected')) {
            throw dupError;
          }
          // Log but don't block if duplicate check fails
          logger.warning('Duplicate check failed, proceeding with creation', { error: dupError });
        }
      }
      
      // Check network connectivity
      const netState = await NetInfo.fetch();
      const isOnline = !!netState.isConnected;

      // If offline, queue the bounty for later
      if (!isOnline) {
        console.log('📴 Offline: queueing bounty for later submission');
        // Ensure attachments_json is included on the queued payload if attachments are present
        try {
          const attachmentsFromPayload = (bounty as any).attachments || (bounty as any).attachments_list || []
          const toInclude = Array.isArray(attachmentsFromPayload)
            ? attachmentsFromPayload.filter((a: any) => !!a && (a.remoteUri || a.status === 'uploaded' || a.uri))
            : []
          if ((!((bounty as any).attachments_json) || (bounty as any).attachments_json === null) && toInclude.length > 0) {
            ;(bounty as any).attachments_json = JSON.stringify(toInclude)
          }
        } catch (e) {
          // ignore
        }

        await offlineQueueService.enqueue('bounty', { bounty });
        
        // Return a temporary bounty object with a temp ID
        return {
          ...bounty,
          id: Date.now(), // temporary ID
          created_at: new Date().toISOString(),
          status: 'open',
        } as Bounty;
      }

      if (isSupabaseConfigured) {
        // Normalize record to prefer poster_id and avoid sending legacy user_id column
        const normalized = Object.assign({}, bounty) as any

        // Ensure attachments_json is populated if attachments were provided as an array
        try {
          const attachmentsFromPayload = (bounty as any).attachments || (bounty as any).attachments_list || []
          // Also accept attachments that have a remoteUri even if status is not strictly 'uploaded'
          const toInclude = Array.isArray(attachmentsFromPayload)
            ? attachmentsFromPayload.filter((a: any) => !!a && (a.remoteUri || a.status === 'uploaded' || a.uri))
            : []
          if ((!normalized.attachments_json || normalized.attachments_json === null) && toInclude.length > 0) {
            normalized.attachments_json = JSON.stringify(toInclude)
          }
        } catch (e) {
          // ignore and continue
        }
        normalized.poster_id = normalized.poster_id || normalized.user_id || undefined
        // Remove legacy user_id to avoid inserting into a column that may not exist
        if (Object.prototype.hasOwnProperty.call(normalized, 'user_id')) delete normalized.user_id

        // Attempt to fetch poster's username from profiles so we can satisfy NOT NULL
        // constraints on the Supabase/Postgres side. If this fails, fall back to a
        // default username to avoid insertion errors.
        try {
          if (normalized.poster_id) {
            const { data: profData, error: profErr } = await supabase
              .from('profiles')
              .select('username')
              .eq('id', normalized.poster_id)
              .maybeSingle()

            if (!profErr && profData && profData.username) {
              normalized.username = profData.username
            } else {
              const compactSource = normalized.poster_id ? ('' + normalized.poster_id) : ''
              const compact = (compactSource.replace(/-/g, '').slice(0, 8)) || 'unknown'
              normalized.username = normalized.username || `@user_${compact}`
            }
          } else {
            const compactSource = normalized.poster_id ? ('' + normalized.poster_id) : ''
            const compact = (compactSource.replace(/-/g, '').slice(0, 8)) || 'unknown'
            normalized.username = normalized.username || `@user_${compact}`
          }
        } catch (e) {
          normalized.username = normalized.username || '@Jon_Doe'
        }

        // Try direct Supabase insert first (works if RLS permits anon/session)
        const { data, error } = await supabase
          .from('bounties')
          .insert(normalized as any)
          .select('*')
          .single()

        if (!error) {
          return (data as unknown as Bounty) ?? null
        }
        // If direct insert failed, decide whether to fallback to relay or bubble up
        {
          const msg = typeof error.message === 'string' ? error.message : String(error)
          // Fallback to relay for RLS/permission errors; otherwise rethrow
          const isPolicy = /row level security|RLS|permission denied|not authorized/i.test(msg)
          if (!isPolicy) {
            let hint: string | undefined
            if (/violates foreign key|foreign key constraint/i.test(msg)) {
              hint = 'Foreign key constraint failed. Ensure user_id references an existing profiles row, or adjust FK/policies.'
            }
            const rich = hint ? `${msg}\n\nHint: ${hint}` : msg
            throw new Error(rich)
          }
        }

        // No session (or direct insert failed before), use server relay (service role) to insert into Supabase
        try {
          const relayResp = await fetch(`${getApiBaseUrl()}/api/supabase/bounties`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(Object.assign({}, normalized, {
              // Defaults to reduce DB constraint issues
              status: (normalized as any).status || 'open',
              timeline: (normalized as any).timeline ?? '',
              skills_required: (normalized as any).skills_required ?? '',
              work_type: (normalized as any).work_type || 'online',
            })),
          })
          if (!relayResp.ok) {
            const text = await relayResp.text()
            throw new Error(`Relay insert failed: ${text}`)
          }
          const json = await relayResp.json()
          return json as Bounty
        } catch (e: any) {
          const msg = e?.message || String(e)
          if (/Network request failed|timed out|TypeError/i.test(msg)) {
            const hint = `Device could not reach API at ${getApiBaseUrl()}. If on a physical device, ensure both are on the same Wi‑Fi and Windows firewall allows inbound on port 3001. Alternatively set EXPO_PUBLIC_API_BASE_URL to your machine LAN IP (e.g., http://192.168.x.x:3001).`
            throw new Error(`${msg}\n\nHint: ${hint}`)
          }
          throw e
        }
      }

  const API_URL = `${getApiBaseUrl()}/api/bounties`
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(bounty),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to create bounty: ${errorText}`)
      }

      return await response.json()
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error")
      logOnce('bounties:create', 'error', 'Error creating bounty (showing once until reload)', { bounty, error: { message: error.message, stack: error.stack } })
      // Re-throw so callers can present actionable messages to the user
      throw error
    }
  },

  /**
   * Update a bounty
   */
  async update(id: any, updates: Partial<Omit<Bounty, "id" | "created_at">>): Promise<Bounty | null> {
    try {
      // Defensive: ensure id is present and not null/undefined/empty
      if (id === null || id === undefined || id === '') {
        const err = new Error('Invalid bounty id provided to bountyService.update')
        logger.error('bounties:update called with invalid id', { id, updates })
        // Return null so callers can handle the failure gracefully without throwing
        return null
      }
      if (isSupabaseConfigured) {
        const { data, error } = await supabase
          .from('bounties')
          .update(updates as any)
          .eq('id', id)
          .select('*')
          .single()

        if (error) throw error
        return (data as unknown as Bounty) ?? null
      }

      // If the code reaches here, we're in API mode and didn't use Supabase
      // Fall through to API creation path handled above


      const API_URL = `${getApiBaseUrl()}/api/bounties/${encodeURIComponent(String(id))}`
      const response = await fetch(API_URL, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updates),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to update bounty: ${errorText}`)
      }

      return await response.json()
    } catch (err) {
      // Build a rich error object for logging (handle plain objects thrown by some libs)
      let richError: any
      try {
        if (err instanceof Error) {
          richError = { name: err.name, message: err.message, stack: err.stack }
        } else if (err && typeof err === 'object') {
          richError = Object.assign({}, err)
        } else {
          richError = { message: String(err) }
        }
      } catch (e) {
        richError = { message: 'Failed to serialize error', raw: String(err) }
      }

      // Log to console immediately for faster visibility during debugging
      try {
        console.error('bountyService.update error', { id, updates, error: richError })
      } catch (e) {
        // ignore
      }

      logOnce('bounties:update', 'error', 'Error updating bounty (showing once until reload)', { id, updates, error: richError })
      return null
    }
  },

  /**
   * Delete a bounty
   */
  async delete(id: number): Promise<boolean> {
    try {
      if (isSupabaseConfigured) {
        const { error } = await supabase
          .from('bounties')
          .delete()
          .eq('id', id)

        if (error) throw error
        return true
      }

  const API_URL = `${getApiBaseUrl()}/api/bounties/${id}`
      const response = await fetch(API_URL, {
        method: "DELETE",
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to delete bounty: ${errorText}`)
      }

      return true
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error")
      logOnce('bounties:delete', 'error', 'Error deleting bounty (showing once until reload)', { id, error })
      return false
    }
  },

  /**
   * Update a bounty's status
   */
  async updateStatus(id: number, status: "open" | "in_progress" | "completed" | "archived" | "cancelled" | "cancellation_requested"): Promise<Bounty | null> {
    return this.update(id, { status })
  },

  /**
   * Get bounties by user ID
   */
  async getByUserId(userId: string): Promise<Bounty[]> {
    return this.getAll({ userId })
  },

  /**
   * Get open bounties
   */
  async getOpenBounties(): Promise<Bounty[]> {
    return this.getAll({ status: "open" })
  },
  
  /**
   * Get bounties by work type (online or in_person)
   */
  async getByWorkType(workType: 'online' | 'in_person'): Promise<Bounty[]> {
    return this.getAll({ workType })
  },

  /**
   * Get in-progress bounties
   */
  async getInProgressBounties(): Promise<Bounty[]> {
    return this.getAll({ status: "in_progress" })
  },

  /**
   * Get completed bounties
   */
  async getCompletedBounties(): Promise<Bounty[]> {
    return this.getAll({ status: "completed" })
  },

  /**
   * Get archived bounties
   */
  async getArchivedBounties(): Promise<Bounty[]> {
    return this.getAll({ status: "archived" })
  },

  /**
   * Process a queued bounty (called by offline queue service)
   */
  async processQueuedBounty(bounty: Omit<Bounty, "id" | "created_at">): Promise<Bounty | null> {
    // Use direct create logic without offline queueing
    try {
      if (isSupabaseConfigured) {
        const { data, error } = await supabase
          .from('bounties')
          .insert(bounty as any)
          .select('*')
          .single()

        if (!error) {
          return (data as unknown as Bounty) ?? null
        }

        // Fallback to relay for RLS/permission errors
        const msg = typeof error.message === 'string' ? error.message : String(error)
        const isPolicy = /row level security|RLS|permission denied|not authorized/i.test(msg)
        if (!isPolicy) {
          throw new Error(msg)
        }

        // Use server relay
        const relayResp = await fetch(`${getApiBaseUrl()}/api/supabase/bounties`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...bounty,
            status: (bounty as any).status || 'open',
            timeline: (bounty as any).timeline ?? '',
            skills_required: (bounty as any).skills_required ?? '',
            work_type: (bounty as any).work_type || 'online',
          }),
        })
        if (!relayResp.ok) {
          const text = await relayResp.text()
          throw new Error(`Relay insert failed: ${text}`)
        }
        return await relayResp.json() as Bounty
      }

      // Direct API call
      const API_URL = `${getApiBaseUrl()}/api/bounties`
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(bounty),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to create bounty: ${errorText}`)
      }

      return await response.json()
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error")
      logger.error('Error processing queued bounty', { bounty, error: { message: error.message } })
      throw error
    }
  },
}
