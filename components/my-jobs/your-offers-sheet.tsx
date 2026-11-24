/**
 * Jobs you offered to do, and what happened (design S.2). One action per row:
 * withdraw a waiting offer, open a job you were chosen for, or clear an offer
 * that isn't going ahead.
 */
import { MaterialIcons } from '@expo/vector-icons'
import * as React from 'react'
import { useMemo } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { groupOffers } from '../../lib/my-jobs/build-my-jobs'
import { getOfferAction } from '../../lib/my-jobs/manage-actions'
import type { MyOffer } from '../../lib/my-jobs/types'
import { useAppThemeContext } from '../../lib/themes/AppThemeContext'
import type { AppTheme } from '../../lib/themes/types'
import { JobThumb } from './job-bits'
import { MyJobsSheet, SheetSectionLabel } from './my-jobs-sheet'

export interface YourOffersSheetProps {
  visible: boolean
  offers: MyOffer[]
  onClose: () => void
  onBack?: () => void
  onWithdraw: (offer: MyOffer) => void
  onOpen: (offer: MyOffer) => void
  onRemove: (offer: MyOffer) => void
  onFindWork: () => void
}

export function YourOffersSheet({ visible, offers, onClose, onBack, onWithdraw, onOpen, onRemove, onFindWork }: YourOffersSheetProps) {
  const { theme } = useAppThemeContext()
  const s = useMemo(() => makeStyles(theme), [theme])
  const groups = groupOffers(offers)

  const renderOffer = (offer: MyOffer) => {
    const action = getOfferAction(offer)
    const run = action.key === 'withdraw' ? onWithdraw : action.key === 'open' ? onOpen : onRemove
    const statusColor =
      offer.status === 'chosen' ? theme.primaryLight : offer.status === 'waiting' ? theme.warningText : theme.textSecondary
    return (
      <View key={offer.key} style={s.card} testID={`offer-row-${offer.bountyId}`}>
        <View style={s.top}>
          <JobThumb coverUri={offer.coverUri} icon={offer.icon} size={44} />
          <View style={{ flex: 1 }}>
            <Text style={s.title} numberOfLines={2}>
              {offer.title}
            </Text>
            {offer.subtitle ? <Text style={s.subtitle}>{offer.subtitle}</Text> : null}
          </View>
          <Text style={s.amount}>{offer.amountLabel}</Text>
        </View>
        <View style={s.statusRow}>
          <MaterialIcons name={offer.statusIcon} size={18} color={statusColor} />
          <Text style={[s.status, { color: statusColor }]}>{offer.statusText}</Text>
        </View>
        {offer.detail ? <Text style={s.detail}>{offer.detail}</Text> : null}
        <TouchableOpacity
          onPress={() => run(offer)}
          style={[
            s.action,
            action.tone === 'primary' && { backgroundColor: theme.primary, borderColor: theme.primary },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`${action.label}, ${offer.title}`}
          testID={`offer-action-${action.key}-${offer.bountyId}`}
        >
          <Text
            style={[
              s.actionText,
              action.tone === 'primary' && { color: theme.onPrimary },
              action.tone === 'danger' && { color: theme.errorText },
            ]}
          >
            {action.label}
          </Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <MyJobsSheet
      visible={visible}
      title="Your offers"
      subtitle="Jobs you offered to do, and what happened."
      onClose={onClose}
      onBack={onBack}
      testID="your-offers-sheet"
    >
      {offers.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.detail}>You haven't offered to do any jobs yet.</Text>
          <TouchableOpacity onPress={onFindWork} style={s.action} accessibilityRole="button">
            <Text style={s.actionText}>Find work nearby</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {groups.waiting.length > 0 ? <SheetSectionLabel>Waiting for an answer</SheetSectionLabel> : null}
      {groups.waiting.map(renderOffer)}
      {groups.chosen.length > 0 ? <SheetSectionLabel>Chosen</SheetSectionLabel> : null}
      {groups.chosen.map(renderOffer)}
      {groups.not_going_ahead.length > 0 ? <SheetSectionLabel>Not going ahead</SheetSectionLabel> : null}
      {groups.not_going_ahead.map(renderOffer)}
    </MyJobsSheet>
  )
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    card: {
      borderRadius: 18,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surface,
      padding: 14,
      gap: 8,
    },
    top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    title: { color: t.text, fontSize: 16, fontWeight: '800' },
    subtitle: { color: t.textSecondary, fontSize: 14, marginTop: 2 },
    amount: { color: t.text, fontSize: 16, fontWeight: '800' },
    statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    status: { flex: 1, fontSize: 15, fontWeight: '700' },
    detail: { color: t.textSecondary, fontSize: 14, lineHeight: 20 },
    action: {
      minHeight: 48,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: t.border,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 16,
    },
    actionText: { color: t.text, fontSize: 16, fontWeight: '700' },
    empty: { gap: 12 },
  })
}
