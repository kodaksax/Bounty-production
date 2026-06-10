import AsyncStorage from '@react-native-async-storage/async-storage'
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'

export type BountyFormat = 'card' | 'compact' | 'grid'

const STORAGE_KEY = 'bounty_display_format'

interface BountyFormatContextValue {
  bountyFormat: BountyFormat
  setBountyFormat: (format: BountyFormat) => Promise<void>
}

const BountyFormatContext = createContext<BountyFormatContextValue>({
  bountyFormat: 'card',
  setBountyFormat: async () => {},
})

export function BountyFormatProvider({ children }: { children: React.ReactNode }) {
  const [bountyFormat, setFormatState] = useState<BountyFormat>('card')

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === 'card' || stored === 'compact' || stored === 'grid') setFormatState(stored)
    })
  }, [])

  const setBountyFormat = useCallback(async (format: BountyFormat) => {
    setFormatState(format)
    await AsyncStorage.setItem(STORAGE_KEY, format)
  }, [])

  return (
    <BountyFormatContext.Provider value={{ bountyFormat, setBountyFormat }}>
      {children}
    </BountyFormatContext.Provider>
  )
}

export function useBountyFormat() {
  return useContext(BountyFormatContext)
}
