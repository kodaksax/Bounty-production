import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { API_BASE_URL } from '../../lib/config/api';
import { supabase } from '../../lib/supabase';

interface NotificationsCenterScreenProps { onBack: () => void }

interface NotificationPrefs {
  newApplicants: boolean;
  acceptedRequests: boolean;
  reminders: boolean;
  system: boolean;
  chatMessages: boolean;
  follows: boolean;
  completions: boolean;
  payments: boolean;
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
    follows: true,
    completions: true,
    payments: true,
    reminderLeadMinutes: '30',
  });
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    loadPreferences();
  }, []);

  const loadPreferences = async () => {
    try {
      // First, try to load from backend
      const { data: { session } } = await supabase.auth.getSession();
      
      if (session?.access_token) {
        try {
          const response = await fetch(
            `${API_BASE_URL}/notifications/preferences`,
            {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${session.access_token}`,
              },
            }
          );

          if (response.ok) {
            const data = await response.json();
            const backendPrefs = data.preferences;
            
            // Map backend preferences to frontend format
            setPrefs({
              newApplicants: backendPrefs.applications_enabled,
              acceptedRequests: backendPrefs.acceptances_enabled,
              reminders: backendPrefs.reminders_enabled,
              system: backendPrefs.system_enabled,
              chatMessages: backendPrefs.messages_enabled,
              follows: backendPrefs.follows_enabled,
              completions: backendPrefs.completions_enabled,
              payments: backendPrefs.payments_enabled,
              reminderLeadMinutes: '30', // This is still local only
            });
            
            // Also save to local storage as backup
            await AsyncStorage.setItem(NOTIF_KEY, JSON.stringify({
              newApplicants: backendPrefs.applications_enabled,
              acceptedRequests: backendPrefs.acceptances_enabled,
              reminders: backendPrefs.reminders_enabled,
              system: backendPrefs.system_enabled,
              chatMessages: backendPrefs.messages_enabled,
              follows: backendPrefs.follows_enabled,
              completions: backendPrefs.completions_enabled,
              payments: backendPrefs.payments_enabled,
            }));
            
            setLoaded(true);
            return;
          }
        } catch (apiError) {
          console.warn('Failed to load preferences from API, falling back to local:', apiError);
        }
      }

      // Fallback to local storage
      const raw = await AsyncStorage.getItem(NOTIF_KEY);
      if (raw) {
        const localPrefs = JSON.parse(raw);
        setPrefs(prev => ({ ...prev, ...localPrefs }));
      }
    } catch (e) {
      console.warn('Failed to load notification prefs', e);
    } finally {
      setLoaded(true);
    }
  };

  const persist = async (patch: Partial<NotificationPrefs>) => {
    setPrefs(prev => {
      const next = { ...prev, ...patch };
      
      // Save locally immediately for responsive UI
      AsyncStorage.setItem(NOTIF_KEY, JSON.stringify(next)).catch(err => 
        console.warn('persist notif failed', err)
      );
      
      // Sync with backend
      syncToBackend(next);
      
      return next;
    });
  };

  const syncToBackend = async (preferences: NotificationPrefs) => {
    setSyncing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session?.access_token) {
        console.log('No session, skipping backend sync');
        return;
      }

      // Map frontend preferences to backend format
      const backendPrefs = {
        applications_enabled: preferences.newApplicants,
        acceptances_enabled: preferences.acceptedRequests,
        reminders_enabled: preferences.reminders,
        system_enabled: preferences.system,
        messages_enabled: preferences.chatMessages,
        follows_enabled: preferences.follows,
        completions_enabled: preferences.completions,
        payments_enabled: preferences.payments,
      };

      const response = await fetch(
        `${API_BASE_URL}/notifications/preferences`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(backendPrefs),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to sync preferences with backend');
      }

      console.log('✅ Notification preferences synced with backend');
    } catch (error) {
      console.error('Failed to sync preferences with backend:', error);
      // Continue silently, preferences are still saved locally
    } finally {
      setSyncing(false);
    }
  };

  return (
    <View className="flex-1 bg-emerald-600">
      <View className="flex-row justify-between items-center p-4 pt-8">
        <View className="flex-row items-center">
          <MaterialIcons name="gps-fixed" size={24} color="#ffffff" />
          <Text className="text-lg font-bold tracking-wider ml-2 text-white">BOUNTY</Text>
        </View>
        <View className="flex-row items-center">
          {syncing && <ActivityIndicator size="small" color="#fff" style={{ marginRight: 8 }} />}
          <TouchableOpacity onPress={onBack} className="p-2">
            <MaterialIcons name="arrow-back" size={24} color="#ffffff" />
          </TouchableOpacity>
        </View>
      </View>
      {!loaded ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#fff" />
          <Text className="text-white mt-2">Loading preferences...</Text>
        </View>
      ) : (
        <ScrollView className="px-4" contentContainerStyle={{ paddingBottom: 96 }}>
          <Text className="text-xl font-semibold text-white mb-4">Notification Center</Text>
          <Text className="text-emerald-200 text-xs mb-4">Control which push notifications you receive. Settings are synced across all your devices.</Text>
          
          <NotifToggle 
            label="New Applicants" 
            subtitle="Alerts when a hunter applies to your bounty." 
            icon="person-add-alt" 
            value={prefs.newApplicants} 
            onChange={v => persist({ newApplicants: v })} 
          />
          
          <NotifToggle 
            label="Accepted Requests" 
            subtitle="Updates when your request is accepted." 
            icon="check-circle" 
            value={prefs.acceptedRequests} 
            onChange={v => persist({ acceptedRequests: v })} 
          />
          
          <NotifToggle 
            label="Bounty Completions" 
            subtitle="Notifications when bounties are completed." 
            icon="task-alt" 
            value={prefs.completions} 
            onChange={v => persist({ completions: v })} 
          />
          
          <NotifToggle 
            label="Payments" 
            subtitle="Alerts when you receive payments." 
            icon="attach-money" 
            value={prefs.payments} 
            onChange={v => persist({ payments: v })} 
          />
          
          <NotifToggle 
            label="Chat Messages" 
            subtitle="Direct messages & bounty discussions." 
            icon="chat" 
            value={prefs.chatMessages} 
            onChange={v => persist({ chatMessages: v })} 
          />
          
          <NotifToggle 
            label="New Followers" 
            subtitle="Notifications when someone follows you." 
            icon="favorite" 
            value={prefs.follows} 
            onChange={v => persist({ follows: v })} 
          />
          
          <NotifToggle 
            label="Reminders" 
            subtitle="Due date & follow-up reminders." 
            icon="schedule" 
            value={prefs.reminders} 
            onChange={v => persist({ reminders: v })} 
            extra={
              prefs.reminders && (
                <View className="mt-3">
                  <Text className="text-[10px] text-emerald-200 mb-1">Minutes before due date</Text>
                  <TextInput 
                    keyboardType="numeric" 
                    value={prefs.reminderLeadMinutes} 
                    onChangeText={v => /^(\d{0,3})$/.test(v) && persist({ reminderLeadMinutes: v })} 
                    placeholder="30" 
                    placeholderTextColor="#a7f3d0" 
                    className="bg-black/40 rounded-md px-3 py-2 text-white w-24" 
                  />
                </View>
              )
            } 
          />
          
          <NotifToggle 
            label="System" 
            subtitle="Platform updates & maintenance notices." 
            icon="info" 
            value={prefs.system} 
            onChange={v => persist({ system: v })} 
          />
        </ScrollView>
      )}
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