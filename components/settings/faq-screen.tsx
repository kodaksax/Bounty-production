import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { BrandingLogo } from 'components/ui/branding-logo';

interface FAQScreenProps { onBack: () => void }

const FAQS = [
  { q: 'How does escrow work?', a: 'Funds are reserved when a bounty is accepted and released on completion.' },
  { q: 'Can I cancel a bounty?', a: 'Open bounties may be archived. Funded disputes will have a formal flow later.' },
  { q: 'What fees apply?', a: 'Currently no platform fees in this prototype. Future versions may apply a small service fee.' },
  { q: 'How do I report abuse?', a: 'Use Contact Support with detailed information. Our moderation team reviews all reports promptly.' },
];

export const FAQScreen: React.FC<FAQScreenProps> = ({ onBack }) => {
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
        <Text className="text-xl font-semibold text-white mb-4">FAQ</Text>
        {FAQS.map((f, i) => (
          <View key={i} className="bg-black/30 rounded-xl p-4 mb-4">
            <Text className="text-white font-medium mb-1">{f.q}</Text>
            <Text className="text-emerald-200 text-xs leading-5">{f.a}</Text>
          </View>
        ))}
        <TouchableOpacity accessibilityRole="button" onPress={onBack} className="mt-2 self-start px-4 py-2 rounded-md bg-emerald-700">
          <Text className="text-white text-sm font-medium">Back to Settings</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};