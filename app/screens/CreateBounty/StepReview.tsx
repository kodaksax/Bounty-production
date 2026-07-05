import { MaterialIcons } from '@expo/vector-icons';
import type { BountyDraft } from 'app/hooks/useBountyDraft';
import { formatCategoryLabel } from 'lib/utils/data-utils';
import { PLATFORM_FEE_PERCENTAGE } from 'lib/wallet-context';
import { formatScheduleDescription } from 'lib/utils/schedule-utils';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppThemeContext } from '../../../lib/themes/AppThemeContext';
import { AttachmentViewerModal } from '../../../components/attachment-viewer-modal';
import { EscrowExplainer } from '../../../components/ui/escrow-explainer';
import { TrustBadgesCompact } from '../../../components/ui/trust-badges';
import { useAuthContext } from '../../../hooks/use-auth-context';
import type { Attachment } from '../../../lib/types';

/**
 * Display string for the platform fee percentage. Derived from
 * `PLATFORM_FEE_PERCENTAGE` (the source of truth used at completion time)
 * so this disclosure can never drift from the actual deduction.
 */
const PLATFORM_FEE_DISPLAY = `${(PLATFORM_FEE_PERCENTAGE * 100).toFixed(
  Number.isInteger(PLATFORM_FEE_PERCENTAGE * 100) ? 0 : 1
)}%`;

interface StepReviewProps {
  draft: BountyDraft;
  onSubmit: () => Promise<void>;
  onBack: () => void;
  isSubmitting: boolean;
}

export function StepReview({ draft, onSubmit, onBack, isSubmitting }: StepReviewProps) {
  const { isEmailVerified } = useAuthContext();
  const [showEscrowModal, setShowEscrowModal] = useState(false);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [selectedAttachment, setSelectedAttachment] = useState<Attachment | null>(null);
  const insets = useSafeAreaInsets();
  const BOTTOM_NAV_OFFSET = 60;
  const { theme } = useAppThemeContext();

  const handleViewAttachment = (attachment: Attachment) => {
    setSelectedAttachment(attachment);
    setViewerVisible(true);
  };

  const handleCloseViewer = () => {
    setViewerVisible(false);
    setSelectedAttachment(null);
  };

  const handleSubmit = async () => {
    // Email verification gate: Block submitting if email is not verified
    if (!isEmailVerified) {
      setShowEscrowModal(false);
      Alert.alert(
        'Email verification required',
        "Please verify your email to post bounties. We've sent a verification link to your inbox.",
        [
          { text: 'OK', style: 'default' }
        ]
      );
      return;
    }
    
    setShowEscrowModal(false);
    await onSubmit();
  };

  const listRef = useRef<FlatList<any> | null>(null)

  

  // When this screen mounts, ensure list is scrolled to top so the header is visible
  useEffect(() => {
    try {
      // Slight delay lets layout settle in nested contexts
      const t = setTimeout(() => {
        listRef.current?.scrollToOffset({ offset: 0, animated: false })
      }, 50)
      return () => clearTimeout(t)
    } catch {
      // ignore
    }
  }, [])

  return (
    <View className="flex-1" style={{ backgroundColor: theme.background }}>
      {/* Use FlatList to ensure reliable scrolling inside available area */}
      {/** build sections dynamically so list can scroll properly **/}
      <FlatList
        ref={(r) => { listRef.current = r }}
        data={useMemo(() => {
          const sections: string[] = ['header', 'trust_badges', 'title', 'description', 'schedule', 'compensation', 'location'];
          if (draft.skills) sections.push('optional');
          if (draft.attachments && draft.attachments.length > 0) sections.push('attachments');
          if (!draft.isForHonor) sections.push('escrow');
          return sections;
        }, [draft])}
        keyExtractor={(item) => item}
        showsVerticalScrollIndicator={true}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled={true}
        scrollEnabled={true}
        bounces={true}
        // Ensure contentContainer expands so the bottom action bar doesn't overlap small content
        removeClippedSubviews={false}
        contentContainerStyle={{ paddingTop: 8, paddingHorizontal: 16, paddingBottom: BOTTOM_NAV_OFFSET + Math.max(insets.bottom, 12) + 100 }}
        renderItem={({ item }) => {
          switch (item) {
            case 'header':
              return (
                <View className="mb-6">
                  <Text className="text-xl font-bold mb-2" style={{ color: theme.text }}>Review Your Bounty</Text>
                  <Text className="text-sm" style={{ color: theme.textSecondary }}>Double-check everything before posting</Text>
                </View>
              );
            case 'trust_badges':
              return (
                <View className="mb-4">
                  <TrustBadgesCompact />
                </View>
              );
            case 'title':
              return (
                <View className="mb-4 rounded-lg p-4" style={{ backgroundColor: theme.surface }}>
                  <View className="flex-row items-center justify-between mb-2">
                    <Text className="text-xs uppercase tracking-wide" style={{ color: theme.textSecondary }}>Title & Category</Text>
                  </View>
                  <Text className="text-lg font-semibold mb-1" style={{ color: theme.text }}>{draft.title}</Text>
                  {draft.category && <Text className="text-sm" style={{ color: theme.primaryLight }}>{formatCategoryLabel(draft.category)}</Text>}
                </View>
              );
            case 'description':
              return (
                <View className="mb-4 rounded-lg p-4" style={{ backgroundColor: theme.surface }}>
                  <Text className="text-xs uppercase tracking-wide mb-2" style={{ color: theme.textSecondary }}>Description</Text>
                  <Text className="text-base" style={{ color: theme.text }}>{draft.description}</Text>
                </View>
              );
            case 'schedule': {
              const scheduleLabel = draft.scheduleType
                ? formatScheduleDescription({
                    type: draft.scheduleType,
                    startDate: draft.startDate,
                    endDate: draft.endDate,
                    latestArrivalTime: draft.latestArrivalTime,
                    durationMinutes: draft.durationMinutes,
                    conditionalEndNote: draft.conditionalEndNote,
                  })
                : 'Not set';
              const scheduleIcon =
                draft.scheduleType === 'asap' ? 'bolt'
                : draft.scheduleType === 'flexible' ? 'tune'
                : 'schedule';
              return (
                <View className="mb-4 rounded-lg p-4" style={{ backgroundColor: theme.surface }}>
                  <Text className="text-xs uppercase tracking-wide mb-2" style={{ color: theme.textSecondary }}>Schedule</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <MaterialIcons name={scheduleIcon} size={20} color={theme.primary} />
                    <Text className="text-base ml-2 flex-1" style={{ color: theme.text }}>{scheduleLabel}</Text>
                  </View>
                </View>
              );
            }
            case 'compensation':
              return (
                <View className="mb-4 rounded-lg p-4" style={{ backgroundColor: theme.surface }}>
                  <Text className="text-xs uppercase tracking-wide mb-2" style={{ color: theme.textSecondary }}>Compensation</Text>
                  <View className="flex-row items-center">
                    <View className="px-4 py-2 rounded-lg" style={{ backgroundColor: theme.primary }}>
                      <Text className="text-white text-lg font-bold">{draft.isForHonor ? 'For Honor' : `$${draft.amount}`}</Text>
                    </View>
                    {!draft.isForHonor && <View className="ml-3 flex-1"><Text className="text-sm" style={{ color: theme.textSecondary }}>Funds held in escrow until completion</Text></View>}
                  </View>
                </View>
              );
            case 'location':
              return (
                <View className="mb-4 rounded-lg p-4" style={{ backgroundColor: theme.surface }}>
                  <Text className="text-xs uppercase tracking-wide mb-2" style={{ color: theme.textSecondary }}>Work Type & Location</Text>
                  <View className="flex-row items-center">
                    <MaterialIcons name={draft.workType === 'online' ? 'language' : 'place'} size={20} color={theme.text} />
                    <Text className="text-base ml-2" style={{ color: theme.text }}>{draft.workType === 'online' ? 'Online / Remote' : draft.location}</Text>
                  </View>
                </View>
              );
            case 'optional':
              return (
                <View className="mb-4 rounded-lg p-4" style={{ backgroundColor: theme.surface }}>
                  <Text className="text-xs uppercase tracking-wide mb-2" style={{ color: theme.textSecondary }}>Additional Details</Text>
                  {draft.skills && <View><Text className="text-sm" style={{ color: theme.primaryLight }}>Skills:</Text><Text className="text-base" style={{ color: theme.text }}>{draft.skills}</Text></View>}
                </View>
              );
            case 'attachments':
              return (
                <View className="mb-4 rounded-lg p-4" style={{ backgroundColor: theme.surface }}>
                  <Text className="text-xs uppercase tracking-wide mb-2" style={{ color: theme.textSecondary }}>Attachments</Text>
                  <View style={{ gap: 12 }}>
                    {draft.attachments?.map((attachment) => (
                      <TouchableOpacity
                        key={attachment.id}
                        onPress={() => handleViewAttachment(attachment)}
                        className="rounded-lg p-3 flex-row items-center"
                        style={{ backgroundColor: theme.surfaceSecondary }}
                        accessibilityLabel={`View ${attachment.name}`}
                        accessibilityRole="button"
                        accessibilityHint="Tap to preview attachment"
                      >
                        <MaterialIcons
                          name={
                            attachment.mimeType?.startsWith('image/')
                              ? 'image'
                              : attachment.mimeType?.startsWith('video/')
                              ? 'videocam'
                              : attachment.mimeType?.includes('pdf')
                              ? 'picture-as-pdf'
                              : 'insert-drive-file'
                          }
                          size={24}
                          color={theme.primaryLight}
                        />
                        <View className="ml-3 flex-1">
                          <Text className="text-sm" numberOfLines={1} style={{ color: theme.text }}>
                            {attachment.name}
                          </Text>
                          <Text className="text-xs" style={{ color: theme.textSecondary }}>
                            Tap to preview
                          </Text>
                        </View>
                        <MaterialIcons name="visibility" size={20} color={theme.primaryLight} />
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              );
            case 'escrow':
              return (
                <View className="mb-6">
                  <EscrowExplainer 
                    amount={draft.amount} 
                    variant="card" 
                    showLearnMore={true}
                  />
                </View>
              );
            default:
              return null;
          }
        }}
      />

      {/* Navigation Buttons */}
      <View
        className="px-4 pb-4 pt-3 border-t"
        style={{ backgroundColor: theme.background, borderColor: theme.border, marginBottom: BOTTOM_NAV_OFFSET + Math.max(insets.bottom, 8) }}
      >
        <View className="flex-row gap-3">
          <TouchableOpacity
            onPress={onBack}
            disabled={isSubmitting}
            className="flex-1 py-3 rounded-lg flex-row items-center justify-center"
            style={{ backgroundColor: theme.surfaceSecondary }}
            accessibilityLabel="Go back"
            accessibilityRole="button"
            accessibilityState={{ disabled: isSubmitting }}
          >
            <MaterialIcons name="arrow-back" size={20} color={theme.text} />
            <Text className="font-semibold ml-2" style={{ color: theme.text }}>Back</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setShowEscrowModal(true)}
            disabled={isSubmitting}
            className="flex-1 py-3 rounded-lg flex-row items-center justify-center"
            style={{ backgroundColor: theme.primary }}
            accessibilityLabel="Post bounty"
            accessibilityRole="button"
            accessibilityState={{ disabled: isSubmitting }}
          >
            {isSubmitting ? (
              <>
                <ActivityIndicator size="small" color="#fff" style={{ marginRight: 8 }} />
                <Text className="text-white font-semibold">Posting...</Text>
              </>
            ) : (
              <>
                <Text className="text-white font-semibold mr-2">Post Bounty</Text>
                <MaterialIcons name="check" size={20} color="#fff" />
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Escrow Modal */}
      <Modal
        visible={showEscrowModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowEscrowModal(false)}
      >
        <View className="flex-1 bg-black/50 justify-center items-center px-4">
          <View className="rounded-2xl w-full max-w-md overflow-hidden" style={{ backgroundColor: theme.surface }}>
            {/* Modal Header */}
            <View className="p-4 flex-row items-center justify-between" style={{ backgroundColor: theme.background }}>
              <View className="flex-row items-center">
                <MaterialIcons name="security" size={24} color={theme.text} />
                <Text className="text-lg font-bold ml-2" style={{ color: theme.text }}>
                  Escrow Protection
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowEscrowModal(false)}
                accessibilityLabel="Close modal"
                accessibilityRole="button"
              >
                <MaterialIcons name="close" size={24} color={theme.text} />
              </TouchableOpacity>
            </View>

            {/* Modal Content */}
            <ScrollView className="p-6" style={{ maxHeight: 400 }}>
              <Text className="text-base mb-4" style={{ color: theme.text }}>
                Your payment is protected with escrow to ensure a safe transaction for both parties.
              </Text>

              {/* How It Works */}
              <View className="mb-4">
                <Text className="font-semibold text-lg mb-3" style={{ color: theme.text }}>
                  How it works:
                </Text>

                {[
                  { n: '1', title: 'Funds Secured', desc: `$${draft.amount} is held securely when someone accepts your bounty` },
                  { n: '2', title: 'Work Completed', desc: 'The hunter completes the task and marks it as done' },
                  { n: '3', title: 'You Approve', desc: 'Review the work and approve payment release' },
                  { n: '4', title: 'Payment Released', desc: "Funds are transferred to the hunter's wallet" },
                ].map(({ n, title, desc }, i, arr) => (
                  <View key={n} className={i < arr.length - 1 ? 'mb-3' : ''}>
                    <View className="flex-row items-start">
                      <View className="w-6 h-6 rounded-full items-center justify-center mr-3" style={{ backgroundColor: theme.primary }}>
                        <Text className="font-bold text-sm" style={{ color: '#fff' }}>{n}</Text>
                      </View>
                      <View className="flex-1">
                        <Text className="font-semibold mb-1" style={{ color: theme.text }}>{title}</Text>
                        <Text className="text-sm" style={{ color: theme.textSecondary }}>{desc}</Text>
                      </View>
                    </View>
                  </View>
                ))}
              </View>

              {/* Fees */}
              <View className="rounded-lg p-4 mb-4" style={{ backgroundColor: theme.surfaceSecondary }}>
                <Text className="font-semibold mb-2" style={{ color: theme.text }}>
                  Platform Fee: {PLATFORM_FEE_DISPLAY} on completion
                </Text>
                <Text className="text-sm mb-2" style={{ color: theme.textSecondary }}>
                  A {PLATFORM_FEE_DISPLAY} service fee is deducted from the bounty
                  amount when work is completed and funds are released to the
                  hunter. You pay only the bounty amount up front; the fee comes
                  out of the hunter payout, not in addition to your escrow.
                </Text>
                <Text className="text-sm" style={{ color: theme.textSecondary }}>
                  Standard payment-processor fees from Stripe (typically 2.9% +
                  $0.30 on card transactions) may also apply when funding your
                  wallet. The exact total is shown before you confirm.
                </Text>
              </View>

              {/* Safety Info */}
              <View className="rounded-lg p-4 border" style={{ backgroundColor: theme.surfaceSecondary, borderColor: theme.border }}>
                <View className="flex-row items-start">
                  <MaterialIcons
                    name="verified-user"
                    size={20}
                    color={theme.primaryLight}
                    style={{ marginRight: 8, marginTop: 2 }}
                  />
                  <View className="flex-1">
                    <Text className="text-sm" style={{ color: theme.textSecondary }}>
                      Your funds are never released without your approval. If there
                      {"'"}
                      s an issue, our support team can help resolve disputes.
                    </Text>
                  </View>
                </View>
              </View>
            </ScrollView>

            {/* Modal Actions */}
            <View className="p-4 border-t" style={{ borderColor: theme.border }}>
              <TouchableOpacity
                onPress={handleSubmit}
                disabled={isSubmitting}
                className="py-3 rounded-lg flex-row items-center justify-center mb-2"
                style={{ backgroundColor: theme.primary }}
                accessibilityLabel="Confirm and post bounty"
                accessibilityRole="button"
                accessibilityState={{ disabled: isSubmitting }}
              >
                {isSubmitting ? (
                  <>
                    <ActivityIndicator size="small" color="#fff" style={{ marginRight: 8 }} />
                    <Text className="font-semibold" style={{ color: '#fff' }}>Posting...</Text>
                  </>
                ) : (
                  <>
                    <Text className="font-semibold mr-2" style={{ color: '#fff' }}>I Understand, Post Bounty</Text>
                    <MaterialIcons name="check-circle" size={20} color="#fff" />
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setShowEscrowModal(false)}
                disabled={isSubmitting}
                className="py-3 rounded-lg"
                style={{ backgroundColor: theme.surfaceSecondary }}
                accessibilityLabel="Cancel"
                accessibilityRole="button"
                accessibilityState={{ disabled: isSubmitting }}
              >
                <Text className="font-semibold text-center" style={{ color: theme.text }}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Attachment Viewer Modal */}
      <AttachmentViewerModal
        visible={viewerVisible}
        attachment={selectedAttachment}
        onClose={handleCloseViewer}
      />
    </View>
  );
}

export default StepReview;
