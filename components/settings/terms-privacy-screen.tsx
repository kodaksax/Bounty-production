import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';

interface TermsPrivacyScreenProps { onBack: () => void }

export const TermsPrivacyScreen: React.FC<TermsPrivacyScreenProps> = ({ onBack }) => {
  return (
    <View className="flex-1 bg-emerald-600">
      <View className="flex-row justify-between items-center p-4 pt-8">
        <View className="flex-row items-center">
          <MaterialIcons name="gps-fixed" size={24} color="#000" />
          <Text className="text-lg font-bold tracking-wider ml-2">BOUNTY</Text>
        </View>
        <TouchableOpacity onPress={onBack} className="p-2">
          <MaterialIcons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
      </View>
      <ScrollView className="px-4" contentContainerStyle={{ paddingBottom: 64 }}>
        <Text className="text-xl font-semibold text-white mb-4">Terms & Privacy Policy</Text>
        <Text className="text-emerald-200 text-xs leading-5 mb-4">
          This is placeholder text for the platform's Terms of Service and Privacy Policy. In production, this will
          outline user rights, acceptable use, data handling, retention policies, and dispute resolution processes.
          By using BOUNTY you agree to these terms. Continue checking this screen for updates. For legal inquiries
          contact support.
        </Text>
        <Text className="text-white font-medium mb-2">Data Handling</Text>
        <Text className="text-emerald-200 text-xs leading-5 mb-4">We store minimal personal information required for escrow, compliance, and platform functionality. You may request a data export at any time from Privacy & Security settings.</Text>
        <Text className="text-white font-medium mb-2">User Responsibilities</Text>
        <Text className="text-emerald-200 text-xs leading-5 mb-4">Users must ensure tasks posted are lawful and payments are funded. Dispute processes will be available in a future release.</Text>
        <TouchableOpacity onPress={onBack} className="mt-2 self-start px-4 py-2 rounded-md bg-emerald-700">
          <Text className="text-white text-sm font-medium">Back to Settings</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};