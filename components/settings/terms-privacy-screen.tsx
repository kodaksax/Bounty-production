import { MaterialIcons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { PRIVACY_TEXT } from '../../assets/legal/privacy';
import { TERMS_TEXT } from '../../assets/legal/terms';

interface TermsPrivacyScreenProps { onBack: () => void }

export const TermsPrivacyScreen: React.FC<TermsPrivacyScreenProps> = ({ onBack }) => {
  const [tab, setTab] = useState<'terms' | 'privacy'>('terms');
  const content = tab === 'terms' ? TERMS_TEXT : PRIVACY_TEXT;

  const renderMarkdownLike = (text: string) => {
    // Very simple renderer: split by double newlines into paragraphs
    const parts = text.split(/\n\n+/);
    return parts.map((p, idx) => (
      <Text key={idx} className="text-emerald-100 text-sm leading-6 mb-3">{p}</Text>
    ));
  };

  return (
    <View className="flex-1 bg-emerald-600">
      <View className="flex-row justify-between items-center p-4 pt-8">
        <View className="flex-row items-center">
          <MaterialIcons name="gavel" size={24} color="#fff" />
          <Text className="text-lg font-bold tracking-wider ml-2 text-white">Legal</Text>
        </View>
        <TouchableOpacity onPress={onBack} className="p-2" accessibilityRole="button" accessibilityLabel="Back to Settings">
          <MaterialIcons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View className="flex-row mx-4 mb-2 rounded-lg overflow-hidden border border-emerald-500/40">
        <TouchableOpacity onPress={() => setTab('terms')} className={`flex-1 items-center py-3 ${tab==='terms' ? 'bg-emerald-700' : 'bg-black/20'}`} accessibilityRole="tab" accessibilityState={{ selected: tab==='terms' }}>
          <Text className="text-white font-medium">Terms of Service</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setTab('privacy')} className={`flex-1 items-center py-3 ${tab==='privacy' ? 'bg-emerald-700' : 'bg-black/20'}`} accessibilityRole="tab" accessibilityState={{ selected: tab==='privacy' }}>
          <Text className="text-white font-medium">Privacy Policy</Text>
        </TouchableOpacity>
      </View>

      <ScrollView className="px-4" contentContainerStyle={{ paddingBottom: 96 }}>
        {renderMarkdownLike(content)}
        <TouchableOpacity onPress={onBack} className="mt-4 self-start px-4 py-2 rounded-md bg-emerald-700">
          <Text className="text-white text-sm font-medium">Back to Settings</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};