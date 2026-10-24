import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useRef } from 'react'
import { ScreenLoader } from '../../components/ui/screen-loader'
import { useAuthContext } from '../../hooks/use-auth-context'
import { buildManageRoutePath, manageDestinationPath } from '../../lib/navigation/manage-route'
import { analyticsService } from '../../lib/services/analytics-service'

export default function ManageHandoffRoute() {
  const params = useLocalSearchParams<{
    bounty?: string | string[]
    applicant?: string | string[]
    view?: string | string[]
  }>()
  const router = useRouter()
  const { session, isLoading } = useAuthContext()
  const tracked = useRef(false)
  const returnTo = buildManageRoutePath(params)
  const bountyId = new URLSearchParams(returnTo.split('?')[1] ?? '').get('bounty')
  const destination = manageDestinationPath(params)

  useEffect(() => {
    if (tracked.current) return
    tracked.current = true
    analyticsService.trackEvent('email_link_opened', {
      destination: 'manage',
      view: typeof params.view === 'string' ? params.view : 'bounty',
      has_bounty: Boolean(bountyId),
    })
  }, [bountyId, params.view])

  useEffect(() => {
    if (isLoading) return
    if (!session) {
      router.replace({ pathname: '/', params: { redirect_to: returnTo } })
      return
    }
    router.replace(destination as never)
  }, [bountyId, destination, isLoading, returnTo, router, session])

  return <ScreenLoader label={isLoading ? 'Loading...' : 'Opening your bounties...'} />
}
