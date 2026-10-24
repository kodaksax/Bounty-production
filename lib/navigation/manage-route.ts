import { isUuid } from '../../supabase/functions/_shared/web-links'

type ManageRouteParams = {
  bounty?: unknown
  bountyId?: unknown
  applicant?: unknown
  requestId?: unknown
  view?: unknown
}

const MANAGE_VIEWS = new Set(['bounty', 'applicant', 'complete', 'help'])

function firstString(value: unknown): string | undefined {
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === 'string' ? first : undefined
}

export function buildManageRoutePath(params: ManageRouteParams): string {
  const bountyId = firstString(params.bountyId ?? params.bounty)
  const requestId = firstString(params.requestId ?? params.applicant)
  const view = firstString(params.view)
  const search = new URLSearchParams()

  if (isUuid(bountyId)) search.set('bounty', bountyId.toLowerCase())
  if (isUuid(requestId)) search.set('applicant', requestId.toLowerCase())
  if (view && view !== 'bounty' && MANAGE_VIEWS.has(view)) search.set('view', view)

  const query = search.toString()
  return `/manage/${query ? `?${query}` : ''}`
}

export function safeManageRedirect(value: unknown): string | null {
  const raw = firstString(value)
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null

  try {
    const url = new URL(raw, 'https://www.bountyfinder.net')
    if (
      url.origin !== 'https://www.bountyfinder.net' ||
      (url.pathname !== '/manage' && url.pathname !== '/manage/') ||
      url.hash
    ) {
      return null
    }

    const allowedKeys = new Set(['bounty', 'applicant', 'view'])
    for (const key of url.searchParams.keys()) {
      if (!allowedKeys.has(key) || url.searchParams.getAll(key).length !== 1) return null
    }

    const bounty = url.searchParams.get('bounty')
    const applicant = url.searchParams.get('applicant')
    const view = url.searchParams.get('view')
    if ((bounty && !isUuid(bounty)) || (applicant && !isUuid(applicant))) return null
    if (view && !MANAGE_VIEWS.has(view)) return null

    return buildManageRoutePath({ bounty, applicant, view })
  } catch {
    return null
  }
}
