import { CURRENT_USER_ID } from 'lib/utils/data-utils'
import { useAuthContext } from './use-auth-context'

export function useValidUserId(): string | null {
  const { session } = useAuthContext()
  const id = session?.user?.id
  if (!id || id === CURRENT_USER_ID) return null
  return id
}

