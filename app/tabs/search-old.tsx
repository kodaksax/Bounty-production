import { MaterialIcons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { bountyService } from '../../lib/services/bounty-service'
import type { Bounty } from '../../lib/services/database.types'

import { colors } from '../../lib/theme';
// Minimal, self-contained search screen to replace the prior complex implementation.
// Goals: stable navigation context usage, no external tailwind class dependencies beyond basic ones already in project, and clear states.

interface RowItem {
  id: string
  title: string
  description: string
  amount?: number | null
  created_at?: string
}

export default function SimpleBountySearchScreen() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<RowItem[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [initial, setInitial] = useState<RowItem[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Preload a small list for instant initial UI.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const list = await bountyService.getAll({ status: 'open', limit: 25 })
        if (!cancelled) {
          setInitial(list.map(mapBounty))
        }
      } catch {
        // swallow; initial list optional
      }
    })()
    return () => { cancelled = true }
  }, [])

  const mapBounty = (b: Bounty): RowItem => ({
    id: b.id.toString(),
    title: b.title || 'Untitled',
    description: b.description || '',
    amount: (b as any).amount,
    created_at: (b as any).created_at
  })

  const performSearch = useCallback(async (text: string) => {
    const q = text.trim()
    if (!q) {
      setResults([])
      setError(null)
      return
    }
    setIsSearching(true)
    setError(null)
    try {
      const remote = await bountyService.search(q, { limit: 40 })
      setResults(remote.map(mapBounty))
    } catch (e: any) {
      setError(e?.message || 'Search failed')
    } finally {
      setIsSearching(false)
    }
  }, [])

  // Debounce user input
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => performSearch(query), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, performSearch])

  const data = query.trim() ? results : initial

  const renderItem = ({ item }: { item: RowItem }) => (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{highlight(item.title, query)}</Text>
      {item.description ? (
        <Text style={styles.cardDesc} numberOfLines={2}>{highlight(item.description, query)}</Text>
      ) : null}
      <View style={styles.metaRow}>
        {item.amount != null && (
          <Text style={styles.amount}>${item.amount}</Text>
        )}
        {item.created_at && (
          <Text style={styles.time}>{timeAgo(item.created_at)}</Text>
        )}
      </View>
    </View>
  )

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <MaterialIcons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Search Bounties</Text>
      </View>
      <View style={styles.searchRow}>
        <MaterialIcons name="search" size={20} color="#6ee7b7" style={{ marginHorizontal: 8 }} />
        <TextInput
          value={query}
            placeholder="Search title or description..."
          placeholderTextColor="#93e5c7"
          onChangeText={setQuery}
          onSubmitEditing={() => performSearch(query)}
          returnKeyType="search"
          style={styles.input}
        />
        {!!query && !isSearching && (
          <TouchableOpacity onPress={() => setQuery('')} style={{ padding: 4 }}>
            <MaterialIcons name="close" size={18} color="#6ee7b7" />
          </TouchableOpacity>
        )}
        {isSearching && <ActivityIndicator color="#6ee7b7" size="small" style={{ marginRight: 8 }} />}
      </View>
      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>⚠ {error}</Text>
          <TouchableOpacity onPress={() => performSearch(query)} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}
      {(!query && initial.length === 0 && !isSearching && !error) && (
        <View style={{ padding: 16 }}>
          <Text style={{ color: '#d1fae5', fontSize: 14 }}>No bounties loaded yet.</Text>
          <TouchableOpacity onPress={() => performSearch('')} style={[styles.retryBtn,{marginTop:8}]}> 
            <Text style={styles.retryText}>Refresh</Text>
          </TouchableOpacity>
        </View>
      )}
      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 12, paddingBottom: 100 }}
        keyboardDismissMode="on-drag"
        ListEmptyComponent={
          query && !isSearching && !error ? (
            <View style={{ padding: 24, alignItems: 'center' }}>
              <Text style={{ color: '#ecfdf5' }}>
                No results for {"\""}
                {query}
                {"\""}
              </Text>
            </View>
          ) : null
        }
      />
    </View>
  )
}

// Helpers
function timeAgo(ts?: string) {
  if (!ts) return ''
  const date = new Date(ts)
  const diff = Date.now() - date.getTime()
  const hours = Math.floor(diff / 3600000)
  if (hours < 1) return 'Just now'
  if (hours < 24) return hours + 'h ago'
  const days = Math.floor(hours / 24)
  return days + 'd ago'
}

function highlight(text: string, q: string) {
  if (!q.trim()) return <Text>{text}</Text>
  const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`(${safe})`, 'ig')
  const parts = text.split(regex)
  return (
    <Text>
      {parts.map((p, i) =>
        regex.test(p) ? (
          <Text key={i} style={{ backgroundColor: 'rgba(252,211,77,0.35)', color: '#fff' }}>{p}</Text>
        ) : (
          <Text key={i}>{p}</Text>
        )
      )}
    </Text>
  )
}

// Basic inline styles (avoid tailwind complexity for this recovery implementation)
const styles = {
  container: { flex: 1, backgroundColor: colors.background.secondary },
  header: { flexDirection: 'row', alignItems: 'center', paddingTop: 54, paddingHorizontal: 12, paddingBottom: 12 },
  backBtn: { padding: 8, marginRight: 4 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginLeft: 4 },
  searchRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 24, paddingVertical: 6, marginBottom: 4 },
  input: { flex: 1, color: 'white', paddingVertical: 4, fontSize: 15 },
  card: { backgroundColor: 'rgba(0,0,0,0.15)', borderRadius: 12, padding: 12, marginBottom: 10 },
  cardTitle: { color: '#fff', fontSize: 15, fontWeight: '600', marginBottom: 4 },
  cardDesc: { color: '#d1fae5', fontSize: 13, marginBottom: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  amount: { color: '#6ee7b7', fontWeight: '700', fontSize: 13 },
  time: { color: '#a7f3d0', fontSize: 11 },
  errorBox: { backgroundColor: 'rgba(220,38,38,0.15)', margin: 12, padding: 10, borderRadius: 8 },
  errorText: { color: '#fee2e2', marginBottom: 6, fontSize: 13 },
  retryBtn: { backgroundColor: '#065f46', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, alignSelf: 'flex-start' },
  retryText: { color: 'white', fontSize: 12, fontWeight: '600' },
} as const
