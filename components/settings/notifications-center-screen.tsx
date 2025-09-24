import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useState } from 'react';
import { ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';

interface NotificationsCenterScreenProps { onBack: () => void }

interface NotificationPrefs {
  newApplicants: boolean;
  acceptedRequests: boolean;
  reminders: boolean;
  system: boolean;
  chatMessages: boolean;
  reminderLeadMinutes: string; // store as string for input control
}

const NOTIF_KEY = 'settings:notifications';

export const NotificationsCenterScreen: React.FC<NotificationsCenterScreenProps> = ({ onBack }) => {
  const [prefs, setPrefs] = useState<NotificationPrefs>({
    newApplicants: true,
    acceptedRequests: true,
    reminders: true,
    system: true,
    chatMessages: true,
    reminderLeadMinutes: '30',
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(NOTIF_KEY);
        if (raw) setPrefs(prev => ({ ...prev, ...JSON.parse(raw) }));
      } catch (e) {
        console.warn('Failed to load notification prefs', e);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const persist = (patch: Partial<NotificationPrefs>) => {
    setPrefs(prev => {
      const next = { ...prev, ...patch };
      AsyncStorage.setItem(NOTIF_KEY, JSON.stringify(next)).catch(err => console.warn('persist notif failed', err));
      return next;
    });
  };

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
      <ScrollView className="px-4" contentContainerStyle={{ paddingBottom: 96 }}>
        <Text className="text-xl font-semibold text-white mb-4">Notification Center</Text>
        <NotifToggle label="New Applicants" subtitle="Alerts when a hunter applies to your bounty." icon="person-add-alt" value={prefs.newApplicants} onChange={v => persist({ newApplicants: v })} />
        <NotifToggle label="Accepted Requests" subtitle="Updates when your request is accepted." icon="check-circle" value={prefs.acceptedRequests} onChange={v => persist({ acceptedRequests: v })} />
        <NotifToggle label="Reminders" subtitle="Due date & follow-up reminders." icon="schedule" value={prefs.reminders} onChange={v => persist({ reminders: v })} extra={
          prefs.reminders && (
            <View className="mt-3">
              <Text className="text-[10px] text-emerald-200 mb-1">Minutes before due date</Text>
              <TextInput keyboardType="numeric" value={prefs.reminderLeadMinutes} onChangeText={v => /^(\d{0,3})$/.test(v) && persist({ reminderLeadMinutes: v })} placeholder="30" placeholderTextColor="#a7f3d0" className="bg-black/40 rounded-md px-3 py-2 text-white w-24" />
            </View>
          )
        } />
        <NotifToggle label="System" subtitle="Platform updates & maintenance notices." icon="info" value={prefs.system} onChange={v => persist({ system: v })} />
        <NotifToggle label="Chat Messages" subtitle="Direct messages & bounty discussions." icon="chat" value={prefs.chatMessages} onChange={v => persist({ chatMessages: v })} />
      </ScrollView>
    </View>
  );
};

const NotifToggle = ({ label, subtitle, icon, value, onChange, extra }: { label: string; subtitle: string; icon: any; value: boolean; onChange: (v: boolean) => void; extra?: React.ReactNode }) => (
  <View className="bg-black/30 rounded-xl p-4 mb-4">
    <View className="flex-row items-start justify-between">
      <View className="flex-1 pr-3">
        <View className="flex-row items-center mb-1">
          <MaterialIcons name={icon} size={18} color="#34d399" />
          <Text className="ml-2 text-white font-medium text-sm" numberOfLines={1}>{label}</Text>
        </View>
        <Text className="text-emerald-200 text-[11px] leading-4">{subtitle}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} />
    </View>
    {extra}
  </View>
);