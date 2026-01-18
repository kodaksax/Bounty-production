"use client"

import { MaterialIcons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import React, { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar'
import { COLORS } from '../../lib/constants/accessibility'
import { ROUTES } from '../../lib/routes'
import { followService } from '../../lib/services/follow-service'
import { messageService } from '../../lib/services/message-service'
import { navigationIntent } from '../../lib/services/navigation-intent'
import { userProfileService } from '../../lib/services/user-profile-service'

export default function ChoosePeopleScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [mutuals, setMutuals] = useState<any[]>([])
  const [query, setQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      setLoading(true)
      try {
        // Get followers and following for current user
        const followers = await followService.getFollowers('current-user')
        const following = await followService.getFollowing('current-user')

        const followerIds = new Set(followers.map(f => f.followerId))
        const followingIds = new Set(following.map(f => f.followingId))

        // Mutuals = users that are both in followerIds and followingIds
        const mutualIds = Array.from(followerIds).filter(id => followingIds.has(id))

        // Fetch profiles for mutual ids
        const profiles = await Promise.all(mutualIds.map(id => userProfileService.getProfile(id)))
        const list = profiles.filter(Boolean) as any[]
        if (!mounted) return
        setMutuals(list)
      } catch (err) {
        console.error('ChoosePeople: failed to load mutuals', err)
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => { mounted = false }
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length === 0) return mutuals
    return mutuals.filter(p => (p.name || '').toLowerCase().includes(q) || (p.username || '').toLowerCase().includes(q))
  }, [mutuals, query])

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const onRemoveSelected = (id: string) => {
    setSelectedIds(prev => prev.filter(x => x !== id))
  }

  const onDone = async () => {
    if (selectedIds.length === 0) {
      router.back()
      return
    }

    try {
      // For 1:1, create or get conversation with that participant
      let conv
      if (selectedIds.length === 1) {
        conv = await messageService.getOrCreateConversation([selectedIds[0]], '')
      } else {
        const title = 'Group Chat'
        conv = await messageService.createConversation(selectedIds, title, true)
      }

      if (conv && conv.id) {
        await navigationIntent.setPendingConversationId(conv.id)
        // Navigate to bounty-app with screen=create so the in-app Messenger renders (matches bottom nav create behavior)
        router.push({ pathname: ROUTES.TABS.BOUNTY_APP, params: { screen: 'create' } } as any)
      } else {
        router.back()
      }
    } catch (err) {
      console.error('ChoosePeople: failed to create conversation', err)
      router.back()
    }
  }

  const renderItem = ({ item }: { item: any }) => {
    const checked = selectedIds.includes(item.id)
    return (
      <TouchableOpacity style={styles.row} onPress={() => toggleSelect(item.id)}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Avatar className="h-12 w-12">
            <AvatarImage src={item.avatar || '/placeholder.svg?height=48&width=48'} alt={item.name || item.username} />
            <AvatarFallback className="bg-emerald-700 text-emerald-200">{(item.name || '').split(' ').map((s: string) => s[0]).slice(0,2).join('')}</AvatarFallback>
          </Avatar>
          <Text style={styles.name}>{item.name || item.username}</Text>
        </View>
        <View>
          {checked ? (
            <View style={styles.checkboxChecked}><MaterialIcons name="check" size={16} color="#fff" /></View>
          ) : (
            <View style={styles.checkbox} />
          )}
        </View>
      </TouchableOpacity>
    )
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: COLORS.EMERALD_600 }] }>
      {/* Lift the main content up 30px while leaving the bottom bar (Done button and divider) in place */}
      <View style={styles.contentLift}>
        <View style={styles.header}>
        <TouchableOpacity
          onPress={() => {
              // Prefer going back if possible, otherwise navigate to the in-app Messenger
              // by pushing the bounty-app route with screen=create (this matches the left-most bottom-nav behavior).
              try {
                // @ts-ignore
                if (typeof router.canGoBack === 'function' ? router.canGoBack() : false) {
                  router.back()
                } else {
                  router.push({ pathname: ROUTES.TABS.BOUNTY_APP, params: { screen: 'create' } } as any)
                }
              } catch {
                router.push({ pathname: ROUTES.TABS.BOUNTY_APP, params: { screen: 'create' } } as any)
              }
            }}
          style={styles.iconButton}
        >
          <MaterialIcons name="close" size={28} color="#fff" />
        </TouchableOpacity>
        <Text style={[styles.title, { color: '#fff' }]}>Choose people</Text>
        <View style={styles.iconButton} />
      </View>

      <View style={styles.searchWrapper}>
        <View style={[styles.searchInput, { backgroundColor: 'rgba(255,255,255,0.06)' }]}>
          <MaterialIcons name="search" size={18} color="rgba(255,255,255,0.8)" style={{ marginRight: 8 }} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Search" placeholderTextColor="rgba(255,255,255,0.7)" style={{ flex: 1, color: '#fff' }} />
        </View>
      </View>

      {selectedIds.length > 0 && (
        <View style={{ paddingHorizontal: 16 }}>
          <Text style={styles.sectionTitle}>People you selected</Text>
          <ScrollView horizontal style={{ marginVertical: 8 }}>
            {selectedIds.map(id => {
              const p = mutuals.find(m => m.id === id) || { id }
              return (
                <View key={id} style={{ alignItems: 'center', marginRight: 12 }}>
                  <View>
                    <Avatar className="h-14 w-14">
                      <AvatarImage src={p.avatar || '/placeholder.svg?height=56&width=56'} alt={p.name || p.username} />
                      <AvatarFallback className="bg-emerald-700 text-emerald-200">{(p.name || '').split(' ').map((s: string) => s[0]).slice(0,2).join('')}</AvatarFallback>
                    </Avatar>
                    <TouchableOpacity style={styles.removeBadge} onPress={() => onRemoveSelected(id)}>
                      <MaterialIcons name="close" size={14} color="#052e1b" />
                    </TouchableOpacity>
                  </View>
                    <Text style={{ width: 80, textAlign: 'center', marginTop: 6, color: '#fff' }}>{p.name?.split(' ')[0] || p.username}</Text>
                </View>
              )
            })}
          </ScrollView>
        </View>
      )}

      </View>

      <View style={{ flex: 1 }}>
        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator size="large" color="#fff" />
          </View>
        ) : (
          <FlatList data={filtered} keyExtractor={(i:any) => i.id} renderItem={renderItem} contentContainerStyle={{ paddingBottom: 120 }} />
        )}
      </View>

      {/* Bottom bar stays in its original position */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 12), backgroundColor: COLORS.EMERALD_600 }] }>
        <TouchableOpacity style={[styles.doneBtn, { backgroundColor: COLORS.EMERALD_200 }]} onPress={onDone} accessibilityRole="button">
          <Text style={{ color: '#052e1b', fontWeight: '700' }}>Done</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  contentLift: { marginTop: -30 },
  header: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#047857' },
  iconButton: { width: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '600' },
  searchWrapper: { paddingHorizontal: 16, paddingVertical: 8 },
  searchInput: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f1f5f9', paddingHorizontal: 12, borderRadius: 20, height: 44 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginTop: 8, color: '#fff' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  name: { marginLeft: 12, fontSize: 16 },
  checkbox: { width: 26, height: 26, borderRadius: 6, borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)' },
  checkboxChecked: { width: 26, height: 26, borderRadius: 6, backgroundColor: COLORS.EMERALD_200, alignItems: 'center', justifyContent: 'center' },
  removeBadge: { position: 'absolute', right: -6, top: -6, backgroundColor: '#fff', borderRadius: 12, padding: 4, elevation: 2, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 6 },
  bottomBar: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 12, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#047857' },
  doneBtn: { backgroundColor: '#0b63ff', paddingVertical: 14, borderRadius: 10, alignItems: 'center', marginHorizontal: 16 },
})
