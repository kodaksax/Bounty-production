/**
 * "Who offered" — the people who offered to do one of your jobs.
 *
 * Each person opens their conversation for this job, which is where the
 * poster asks questions and chooses someone (the bounty thread's hire card).
 * Nearest first; offers more than 50 miles from an in-person job sit under a
 * closed "Not nearby" group (SBA-02). While this sheet is open, the people on
 * screen count as seen (`application_viewed`, surface inbox_list) exactly as
 * they did on the old Inbox rows.
 */
import { Image as ExpoImage } from 'expo-image'
import * as React from 'react'
import { useMemo, useState } from 'react'
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { MaterialIcons } from '@expo/vector-icons'
import { useApplicationListViews } from '../../hooks/useApplicationListViews'
import type { BountyRequestWithDetails } from '../../lib/services/bounty-request-service'
import { useAppThemeContext } from '../../lib/themes/AppThemeContext'
import type { AppTheme } from '../../lib/themes/types'
import { formatApplicantDistance, partitionApplicantsByDistance } from '../../lib/utils/applicant-distance'
import { getValidAvatarUrl } from '../../lib/utils/avatar-utils'
import { NotNearbyToggle } from '../not-nearby-toggle'
import { MyJobsSheet } from './my-jobs-sheet'

type Row =
  | { kind: 'person'; key: string; request: BountyRequestWithDetails }
  | { kind: 'notNearby'; key: string; count: number }

export interface ApplicantsSheetProps {
  visible: boolean
  jobTitle: string
  applicants: BountyRequestWithDetails[]
  /** Every pending application across the poster's jobs, for the analytics counts. */
  allPending: BountyRequestWithDetails[]
  onClose: () => void
  onOpenPerson: (request: BountyRequestWithDetails) => void
  onOpenJob: () => void
}

function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

export function ApplicantsSheet({ visible, jobTitle, applicants, allPending, onClose, onOpenPerson, onOpenJob }: ApplicantsSheetProps) {
  const { theme } = useAppThemeContext()
  const s = useMemo(() => makeStyles(theme), [theme])
  const [showFar, setShowFar] = useState(false)

  const rows = useMemo<Row[]>(() => {
    const { nearby, notNearby } = partitionApplicantsByDistance(applicants)
    const toRow = (request: BountyRequestWithDetails): Row => ({
      kind: 'person',
      key: String(request.id ?? request.hunter_id),
      request,
    })
    const list: Row[] = nearby.map(toRow)
    if (notNearby.length > 0) {
      list.push({ kind: 'notNearby', key: '__not-nearby__', count: notNearby.length })
      if (showFar) list.push(...notNearby.map(toRow))
    }
    return list
  }, [applicants, showFar])

  const views = useApplicationListViews<Row>({
    surface: 'inbox_list',
    enabled: visible,
    bountyRequests: allPending,
    getApplication: (row) => (row.kind === 'person' ? row.request : null),
  })

  const renderRow = ({ item }: { item: Row }) => {
    if (item.kind === 'notNearby') {
      return <NotNearbyToggle count={item.count} expanded={showFar} onToggle={() => setShowFar((v) => !v)} />
    }
    const r = item.request
    const name = r.profile?.username ?? 'Someone'
    const avatar = getValidAvatarUrl(r.profile?.avatar)
    const distance = formatApplicantDistance(r.distance_mi)
    const note = r.message?.trim()
    return (
      <TouchableOpacity
        onPress={() => onOpenPerson(r)}
        style={s.person}
        accessibilityRole="button"
        accessibilityLabel={`${name}${distance ? `, ${distance}` : ''}. Open your conversation`}
        testID={`applicant-row-${r.hunter_id}`}
      >
        <View style={s.avatar}>
          {avatar ? (
            <ExpoImage source={{ uri: avatar }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <Text style={s.avatarText}>{initials(name)}</Text>
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.name}>{name}</Text>
          {distance ? <Text style={s.meta}>{distance}</Text> : null}
          {note ? (
            <Text style={s.note} numberOfLines={3}>
              “{note}”
            </Text>
          ) : null}
        </View>
        <MaterialIcons name="chevron-right" size={22} color={theme.textSecondary} />
      </TouchableOpacity>
    )
  }

  return (
    <MyJobsSheet
      visible={visible}
      title="Who offered"
      subtitle={jobTitle}
      onClose={onClose}
      scrollable={false}
      testID="applicants-sheet"
    >
      <Text style={s.hint}>Look at each person, then choose one in your conversation with them.</Text>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={renderRow}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListEmptyComponent={<Text style={s.meta}>No one is waiting for an answer right now.</Text>}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ paddingVertical: 12 }}
        {...views}
      />
      <TouchableOpacity onPress={onOpenJob} style={s.jobLink} accessibilityRole="button" accessibilityLabel="Open the job">
        <Text style={s.jobLinkText}>Open the job</Text>
      </TouchableOpacity>
    </MyJobsSheet>
  )
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    hint: { color: t.textSecondary, fontSize: 14, lineHeight: 20 },
    person: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
      padding: 14,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surface,
      minHeight: 72,
    },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: t.surfaceSecondary,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    avatarText: { color: t.text, fontSize: 15, fontWeight: '800' },
    name: { color: t.text, fontSize: 16, fontWeight: '800' },
    meta: { color: t.textSecondary, fontSize: 14, marginTop: 2 },
    note: { color: t.text, fontSize: 14, lineHeight: 20, marginTop: 6 },
    jobLink: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
    jobLinkText: { color: t.primaryLight, fontSize: 16, fontWeight: '800' },
  })
}
