import React from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { Bounty } from '../lib/services/database.types';

interface StaleBountyAlertProps {
  bounty: Bounty;
  onCancel: (bountyId: number) => void;
  onRepost: (bountyId: number) => void;
}

/**
 * StaleBountyAlert - Displays an alert banner for stale bounties
 * Shows when a hunter's account has been deleted and provides reconciliation options
 */
export const StaleBountyAlert: React.FC<StaleBountyAlertProps> = ({
  bounty,
  onCancel,
  onRepost,
}) => {
  const handleCancel = () => {
    Alert.alert(
      'Cancel Bounty',
      'This will cancel the bounty and refund the escrowed funds to your wallet. Are you sure?',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, Cancel',
          style: 'destructive',
          onPress: () => onCancel(bounty.id),
        },
      ]
    );
  };

  const handleRepost = () => {
    Alert.alert(
      'Repost Bounty',
      'This will reset the bounty to open status so new hunters can apply. The escrow funds will remain locked until completion.',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, Repost',
          onPress: () => onRepost(bounty.id),
        },
      ]
    );
  };

  return (
    <View className="bg-yellow-50 border border-yellow-300 rounded-lg p-4 mb-3">
      <View className="flex-row items-start mb-3">
        <MaterialIcons name="warning" size={24} color="#f59e0b" />
        <View className="flex-1 ml-3">
          <Text className="font-semibold text-yellow-900 text-base mb-1">
            Action Required
          </Text>
          <Text className="text-yellow-800 text-sm">
            The hunter who accepted this bounty has deleted their account. Please choose how to proceed:
          </Text>
        </View>
      </View>

      <View className="flex-row gap-2">
        <TouchableOpacity
          onPress={handleCancel}
          className="flex-1 bg-red-600 rounded-lg py-3 px-4"
        >
          <Text className="text-white text-center font-semibold text-sm">
            Cancel & Refund
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleRepost}
          className="flex-1 bg-emerald-600 rounded-lg py-3 px-4"
        >
          <Text className="text-white text-center font-semibold text-sm">
            Repost Bounty
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};
