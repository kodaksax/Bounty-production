import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { BrandingLogo } from 'components/ui/branding-logo';

interface HelpSupportScreenProps { onBack: () => void; onNavigateContact: () => void; onNavigateTerms: () => void; onNavigateFAQ: () => void; }

export const HelpSupportScreen: React.FC<HelpSupportScreenProps> = ({ onBack, onNavigateContact, onNavigateTerms, onNavigateFAQ }) => {
  return (
    <View className="flex-1 bg-emerald-600">
      <View className="flex-row justify-between items-center p-4 pt-8">
        <View className="flex-row items-center">
          <BrandingLogo size="small" />
        </View>
        <TouchableOpacity accessibilityRole="button" onPress={onBack} className="p-2">
          <MaterialIcons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
      </View>
      <ScrollView className="px-4" contentContainerStyle={{ paddingBottom: 64 }}>
        <Text className="text-xl font-semibold text-white mb-4">Help & Support</Text>
        <SupportBlock title="Contact Support" description="Submit issues, disputes, or detailed questions directly." icon="support-agent" actionLabel="Open" onPress={onNavigateContact} />
        <SupportBlock title="Terms & Privacy Policy" description="Read our platform's terms of use and privacy handling." icon="gavel" actionLabel="View" onPress={onNavigateTerms} />
        <SupportBlock title="FAQ" description="Browse common questions and quick answers." icon="help-center" actionLabel="Browse" onPress={onNavigateFAQ} />
      </ScrollView>
    </View>
  );
};

const SupportBlock = ({ title, description, icon, actionLabel, onPress }: { title: string; description: string; icon: any; actionLabel: string; onPress: () => void }) => (
  <View className="bg-black/30 rounded-xl p-4 mb-4">
    <View className="flex-row items-center mb-2">
      <MaterialIcons name={icon} size={20} color="#34d399" />
      <Text className="ml-2 text-white font-medium">{title}</Text>
    </View>
    <Text className="text-emerald-200 text-xs leading-4 mb-3">{description}</Text>
    <TouchableOpacity accessibilityRole="button" onPress={onPress} className="self-start px-3 py-1 rounded-md bg-emerald-700">
      <Text className="text-xs text-white font-medium">{actionLabel}</Text>
    </TouchableOpacity>
  </View>
);