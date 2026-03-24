import { MaterialIcons } from '@expo/vector-icons';
import { BrandingLogo } from 'components/ui/branding-logo';
import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';

interface FAQScreenProps { onBack: () => void }

const FAQS = [
  { q: 'How does escrow work?', a: 'Funds are reserved when a bounty is accepted and released on completion.' },
  { q: 'Can I cancel a bounty?', a: 'Open bounties may be archived. Funded disputes will have a formal flow later.' },
  { q: 'What fees apply?', a: 'Currently no platform fees in this prototype. Future versions may apply a small service fee.' },
  { q: 'How do I report abuse?', a: 'Use Contact Support with detailed information. Our moderation team reviews all reports promptly.' },
];

export const FAQScreen: React.FC<FAQScreenProps> = ({ onBack }) => {
  return (
    <View style={{ flex: 1, backgroundColor: '#059669' }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 16, paddingTop: 32 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <BrandingLogo size="small" />
        </View>
        <TouchableOpacity onPress={onBack} style={{ padding: 8 }}>
          <MaterialIcons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
      </View>
      <ScrollView style={{ paddingHorizontal: 16 }} contentContainerStyle={{ paddingBottom: 64 }}>
        <Text style={{ fontSize: 20, fontWeight: '700', color: '#fff', marginBottom: 16 }}>FAQ</Text>
        {FAQS.map((f, i) => (
          <View key={i} style={{ backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <Text style={{ color: '#fff', fontWeight: '500', marginBottom: 4 }}>{f.q}</Text>
            <Text style={{ color: '#a7f3d0', fontSize: 12, lineHeight: 20 }}>{f.a}</Text>
          </View>
        ))}
        <TouchableOpacity
          onPress={onBack}
          style={{ marginTop: 8, alignSelf: 'flex-start', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6, backgroundColor: '#047857' }}
        >
          <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>Back to Settings</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};