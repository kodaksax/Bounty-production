import { useRouter } from 'expo-router'
import React from 'react'
import { SearchScreen } from '../../components/search-screen'

// Standalone Search route so it receives a navigation context from expo-router.
// BottomNav intentionally omitted (design: no persistent nav over search).
export default function SearchRoute() {
  const router = useRouter()
  return <SearchScreen onBack={() => router.back()} />
}
