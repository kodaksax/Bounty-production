import { MaterialIcons } from '@expo/vector-icons';
import type { BountyDraft } from 'app/hooks/useBountyDraft';
import React, { useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';

interface StepReviewProps {
  draft: BountyDraft;
  onSubmit: () => Promise<void>;
  onBack: () => void;
  isSubmitting: boolean;
}

export function StepReview({ draft, onSubmit, onBack, isSubmitting }: StepReviewProps) {
  const [showEscrowModal, setShowEscrowModal] = useState(false);

  const handleSubmit = async () => {
    setShowEscrowModal(false);
    await onSubmit();
  };

  return (
    <View className="flex-1 bg-emerald-600">
      <ScrollView className="flex-1 px-4 pt-6">
        {/* Review Header */}
        <View className="mb-6">
          <Text className="text-emerald-100 text-xl font-bold mb-2">
            Review Your Bounty
          </Text>
          <Text className="text-emerald-200/70 text-sm">
            Double-check everything before posting
          </Text>
        </View>

        {/* Title & Category */}
        <View className="mb-4 bg-emerald-700/30 rounded-lg p-4">
          <View className="flex-row items-center justify-between mb-2">
            <Text className="text-emerald-200/70 text-xs uppercase tracking-wide">
              Title & Category
            </Text>
          </View>
          <Text className="text-white text-lg font-semibold mb-1">
            {draft.title}
          </Text>
          {draft.category && (
            <Text className="text-emerald-300 text-sm capitalize">
              {draft.category}
            </Text>
          )}
        </View>

        {/* Description */}
        <View className="mb-4 bg-emerald-700/30 rounded-lg p-4">
          <Text className="text-emerald-200/70 text-xs uppercase tracking-wide mb-2">
            Description
          </Text>
          <Text className="text-white text-base">
            {draft.description}
          </Text>
        </View>

        {/* Compensation */}
        <View className="mb-4 bg-emerald-700/30 rounded-lg p-4">
          <Text className="text-emerald-200/70 text-xs uppercase tracking-wide mb-2">
            Compensation
          </Text>
          <View className="flex-row items-center">
            <View className="bg-emerald-500 px-4 py-2 rounded-lg">
              <Text className="text-white text-lg font-bold">
                {draft.isForHonor ? 'For Honor' : `$${draft.amount}`}
              </Text>
            </View>
            {!draft.isForHonor && (
              <View className="ml-3 flex-1">
                <Text className="text-emerald-200 text-sm">
                  Funds held in escrow until completion
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Location */}
        <View className="mb-4 bg-emerald-700/30 rounded-lg p-4">
          <Text className="text-emerald-200/70 text-xs uppercase tracking-wide mb-2">
            Work Type & Location
          </Text>
          <View className="flex-row items-center">
            <MaterialIcons
              name={draft.workType === 'online' ? 'language' : 'place'}
              size={20}
              color="#fff"
            />
            <Text className="text-white text-base ml-2">
              {draft.workType === 'online' ? 'Online / Remote' : draft.location}
            </Text>
          </View>
        </View>

        {/* Optional Fields */}
        {(draft.timeline || draft.skills) && (
          <View className="mb-4 bg-emerald-700/30 rounded-lg p-4">
            <Text className="text-emerald-200/70 text-xs uppercase tracking-wide mb-2">
              Additional Details
            </Text>
            {draft.timeline && (
              <View className="mb-2">
                <Text className="text-emerald-300 text-sm">Timeline:</Text>
                <Text className="text-white text-base">{draft.timeline}</Text>
              </View>
            )}
            {draft.skills && (
              <View>
                <Text className="text-emerald-300 text-sm">Skills:</Text>
                <Text className="text-white text-base">{draft.skills}</Text>
              </View>
            )}
          </View>
        )}

        {/* Escrow Info Banner */}
        {!draft.isForHonor && (
          <TouchableOpacity
            onPress={() => setShowEscrowModal(true)}
            className="mb-6 bg-emerald-500/20 rounded-lg p-4 border border-emerald-400/30"
            accessibilityLabel="View escrow information"
            accessibilityRole="button"
          >
            <View className="flex-row items-start">
              <MaterialIcons
                name="security"
                size={24}
                color="rgba(52, 211, 153, 0.9)"
                style={{ marginRight: 12 }}
              />
              <View className="flex-1">
                <Text className="text-emerald-100 font-semibold mb-1">
                  Escrow Protection Active
                </Text>
                <Text className="text-emerald-200/70 text-sm mb-2">
                  ${draft.amount} will be held securely until you approve completion
                </Text>
                <View className="flex-row items-center">
                  <Text className="text-emerald-300 text-sm font-medium">
                    Learn how it works
                  </Text>
                  <MaterialIcons
                    name="arrow-forward"
                    size={16}
                    color="rgba(52, 211, 153, 0.9)"
                    style={{ marginLeft: 4 }}
                  />
                </View>
              </View>
            </View>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Navigation Buttons */}
      <View className="px-4 pb-6 pt-4 bg-emerald-600 border-t border-emerald-700/50">
        <View className="flex-row gap-3">
          <TouchableOpacity
            onPress={onBack}
            disabled={isSubmitting}
            className="flex-1 bg-emerald-700/50 py-3 rounded-lg flex-row items-center justify-center"
            accessibilityLabel="Go back"
            accessibilityRole="button"
            accessibilityState={{ disabled: isSubmitting }}
          >
            <MaterialIcons name="arrow-back" size={20} color="#fff" />
            <Text className="text-white font-semibold ml-2">Back</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setShowEscrowModal(true)}
            disabled={isSubmitting}
            className="flex-1 bg-emerald-500 py-3 rounded-lg flex-row items-center justify-center"
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
          <View className="bg-emerald-600 rounded-2xl w-full max-w-md overflow-hidden">
            {/* Modal Header */}
            <View className="bg-emerald-700 p-4 flex-row items-center justify-between">
              <View className="flex-row items-center">
                <MaterialIcons name="security" size={24} color="#fff" />
                <Text className="text-white text-lg font-bold ml-2">
                  Escrow Protection
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowEscrowModal(false)}
                accessibilityLabel="Close modal"
                accessibilityRole="button"
              >
                <MaterialIcons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>

            {/* Modal Content */}
            <ScrollView className="p-6" style={{ maxHeight: 400 }}>
              <Text className="text-emerald-100 text-base mb-4">
                Your payment is protected with escrow to ensure a safe transaction for both parties.
              </Text>

              {/* How It Works */}
              <View className="mb-4">
                <Text className="text-emerald-100 font-semibold text-lg mb-3">
                  How it works:
                </Text>

                <View className="mb-3">
                  <View className="flex-row items-start">
                    <View className="bg-emerald-500 w-6 h-6 rounded-full items-center justify-center mr-3">
                      <Text className="text-white font-bold text-sm">1</Text>
                    </View>
                    <View className="flex-1">
                      <Text className="text-emerald-100 font-semibold mb-1">
                        Funds Secured
                      </Text>
                      <Text className="text-emerald-200/70 text-sm">
                        ${draft.amount} is held securely when someone accepts your bounty
                      </Text>
                    </View>
                  </View>
                </View>

                <View className="mb-3">
                  <View className="flex-row items-start">
                    <View className="bg-emerald-500 w-6 h-6 rounded-full items-center justify-center mr-3">
                      <Text className="text-white font-bold text-sm">2</Text>
                    </View>
                    <View className="flex-1">
                      <Text className="text-emerald-100 font-semibold mb-1">
                        Work Completed
                      </Text>
                      <Text className="text-emerald-200/70 text-sm">
                        The hunter completes the task and marks it as done
                      </Text>
                    </View>
                  </View>
                </View>

                <View className="mb-3">
                  <View className="flex-row items-start">
                    <View className="bg-emerald-500 w-6 h-6 rounded-full items-center justify-center mr-3">
                      <Text className="text-white font-bold text-sm">3</Text>
                    </View>
                    <View className="flex-1">
                      <Text className="text-emerald-100 font-semibold mb-1">
                        You Approve
                      </Text>
                      <Text className="text-emerald-200/70 text-sm">
                        Review the work and approve payment release
                      </Text>
                    </View>
                  </View>
                </View>

                <View>
                  <View className="flex-row items-start">
                    <View className="bg-emerald-500 w-6 h-6 rounded-full items-center justify-center mr-3">
                      <Text className="text-white font-bold text-sm">4</Text>
                    </View>
                    <View className="flex-1">
                      <Text className="text-emerald-100 font-semibold mb-1">
                        Payment Released
                      </Text>
                      <Text className="text-emerald-200/70 text-sm">
                        Funds are transferred to the hunter's wallet
                      </Text>
                    </View>
                  </View>
                </View>
              </View>

              {/* Fees */}
              <View className="bg-emerald-700/30 rounded-lg p-4 mb-4">
                <Text className="text-emerald-100 font-semibold mb-2">
                  Service Fee: 2.9% + $0.30
                </Text>
                <Text className="text-emerald-200/70 text-sm">
                  Standard payment processing fee. You'll see the exact amount before confirming.
                </Text>
              </View>

              {/* Safety Info */}
              <View className="bg-emerald-500/20 rounded-lg p-4 border border-emerald-400/30">
                <View className="flex-row items-start">
                  <MaterialIcons
                    name="verified-user"
                    size={20}
                    color="rgba(52, 211, 153, 0.9)"
                    style={{ marginRight: 8, marginTop: 2 }}
                  />
                  <View className="flex-1">
                    <Text className="text-emerald-200/70 text-sm">
                      Your funds are never released without your approval. If there's an issue, our support team can help resolve disputes.
                    </Text>
                  </View>
                </View>
              </View>
            </ScrollView>

            {/* Modal Actions */}
            <View className="p-4 border-t border-emerald-700/50">
              <TouchableOpacity
                onPress={handleSubmit}
                disabled={isSubmitting}
                className="bg-emerald-500 py-3 rounded-lg flex-row items-center justify-center mb-2"
                accessibilityLabel="Confirm and post bounty"
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
                    <Text className="text-white font-semibold mr-2">I Understand, Post Bounty</Text>
                    <MaterialIcons name="check-circle" size={20} color="#fff" />
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setShowEscrowModal(false)}
                disabled={isSubmitting}
                className="bg-emerald-700/50 py-3 rounded-lg"
                accessibilityLabel="Cancel"
                accessibilityRole="button"
                accessibilityState={{ disabled: isSubmitting }}
              >
                <Text className="text-white font-semibold text-center">Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
