import { MaterialIcons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

interface ContactSupportScreenProps { onBack: () => void }

export const ContactSupportScreen: React.FC<ContactSupportScreenProps> = ({ onBack }) => {
  const [subject, setSubject] = useState('');
  const [details, setDetails] = useState('');

  const submit = () => {
    // Placeholder: integrate with backend ticket system later
    Alert.alert('Submitted', 'Your support request has been sent.');
    setSubject('');
    setDetails('');
    onBack();
  };

  return (
    <View className="flex-1 bg-emerald-600">
      <View className="flex-row justify-between items-center p-4 pt-8">
        <View className="flex-row items-center">
          <MaterialIcons name="gps-fixed" size={24} color="#000" />
          <Text className="text-lg font-bold tracking-wider ml-2 text-white">BOUNTY</Text>
        </View>
        <TouchableOpacity onPress={onBack} className="p-2">
          <MaterialIcons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
      </View>
      <ScrollView className="px-4" contentContainerStyle={{ paddingBottom: 64 }}>
        <Text className="text-xl font-semibold text-white mb-4">Contact Support</Text>
        <Text className="text-emerald-200 text-xs leading-4 mb-4">Provide detailed information so our team can respond quickly.</Text>
        <Text className="text-xs text-emerald-100 mb-1">Subject</Text>
        <TextInput value={subject} onChangeText={setSubject} placeholder="Issue subject" placeholderTextColor="#aad9b8" className="bg-black/30 rounded-md px-3 py-2 text-white mb-4" />
        <Text className="text-xs text-emerald-100 mb-1">Details</Text>
        <TextInput value={details} onChangeText={setDetails} placeholder="Describe the issue or request" placeholderTextColor="#aad9b8" multiline numberOfLines={6} textAlignVertical="top" className="bg-black/30 rounded-md px-3 py-2 text-white mb-4" />
        <View className="flex-row gap-3">
          <TouchableOpacity onPress={submit} disabled={!subject || !details} className={`px-4 py-2 rounded-md ${subject && details ? 'bg-emerald-700' : 'bg-emerald-900 opacity-60'}`}>
            <Text className="text-white text-sm font-medium">Submit Request</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onBack} className="px-4 py-2 rounded-md bg-black/30">
            <Text className="text-white text-sm font-medium">Cancel</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
};