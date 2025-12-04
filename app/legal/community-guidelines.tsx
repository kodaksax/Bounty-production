import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { COMMUNITY_GUIDELINES_TEXT } from '../../assets/legal/community-guidelines';

export default function CommunityGuidelinesRoute() {
  const router = useRouter();
  const paragraphs = COMMUNITY_GUIDELINES_TEXT.split(/\n\n+/);
  return (
    <View className="flex-1 bg-emerald-600">
      <View className="flex-row justify-between items-center p-4 pt-8">
        <View className="flex-row items-center">
          <MaterialIcons name="security" size={24} color="#fff" />
          <Text className="text-lg font-bold tracking-wider ml-2 text-white">Community Guidelines</Text>
        </View>
        <TouchableOpacity onPress={() => router.back()} className="p-2" accessibilityRole="button" accessibilityLabel="Back">
          <MaterialIcons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
      </View>
      <ScrollView className="px-4" contentContainerStyle={{ paddingBottom: 96 }}>
        {paragraphs.map((p, i) => (
          <Text key={i} className="text-emerald-100 text-sm leading-6 mb-3">{p}</Text>
        ))}
      </ScrollView>
    </View>
  );
}
