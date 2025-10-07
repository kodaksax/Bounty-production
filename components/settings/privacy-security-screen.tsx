import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';

interface PrivacySecurityScreenProps { onBack: () => void }

interface PrivacyState {
  twoFactor: boolean;
  showProfilePublic: boolean;
  showCompletedBounties: boolean;
  passwordCurrent: string;
  passwordNew: string;
  passwordConfirm: string;
  sessions: { id: string; device: string; location: string; active: boolean }[];
  exporting: boolean;
}

const STORAGE_KEY = 'settings:privacy';

export const PrivacySecurityScreen: React.FC<PrivacySecurityScreenProps> = ({ onBack }) => {
  const [state, setState] = useState<PrivacyState>({
    twoFactor: false,
    showProfilePublic: true,
    showCompletedBounties: true,
    passwordCurrent: '',
    passwordNew: '',
    passwordConfirm: '',
    sessions: [
      { id: 'device-1', device: 'iPhone 15', location: 'NY, USA', active: true },
      { id: 'device-2', device: 'Chrome (Web)', location: 'CA, USA', active: true },
    ],
    exporting: false,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          setState(s => ({ ...s, ...JSON.parse(raw) }));
        }
      } catch (e) {
        console.warn('Failed to load privacy settings', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const persist = async (patch: Partial<PrivacyState>) => {
    setState(prev => {
      const next = { ...prev, ...patch };
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(err => console.warn('persist failed', err));
      return next;
    });
  };

  const changePassword = async () => {
    if (!state.passwordCurrent || !state.passwordNew) {
      Alert.alert('Incomplete', 'Fill in current and new password.');
      return;
    }
    if (state.passwordNew !== state.passwordConfirm) {
      Alert.alert('Mismatch', 'New password & confirmation differ.');
      return;
    }
    
    // Validate strong password
    const strongPasswordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (!strongPasswordPattern.test(state.passwordNew)) {
      Alert.alert(
        'Weak Password', 
        'Password must be at least 8 characters with uppercase, lowercase, number, and special character (@$!%*?&).'
      );
      return;
    }
    
    try {
      // Import supabase here to avoid circular dependencies
      const { supabase } = require('../../lib/supabase');
      
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) {
        Alert.alert('Error', 'Unable to verify current user.');
        return;
      }
      
      // Update password using Supabase
      const { error } = await supabase.auth.updateUser({
        password: state.passwordNew
      });
      
      if (error) {
        Alert.alert('Error', error.message || 'Failed to update password.');
        return;
      }
      
      Alert.alert('Success', 'Your password has been updated successfully.');
      persist({ passwordCurrent: '', passwordNew: '', passwordConfirm: '' });
      
    } catch (err) {
      console.error('Password change error:', err);
      Alert.alert('Error', 'An unexpected error occurred. Please try again.');
    }
  };

  const revokeSession = (id: string) => {
    persist({ sessions: state.sessions.map(s => s.id === id ? { ...s, active: false } : s) });
  };

  const exportData = async () => {
    if (state.exporting) return;
    persist({ exporting: true });
    setTimeout(() => {
      Alert.alert('Export Ready', 'Your data export link has been emailed.');
      persist({ exporting: false });
    }, 1200);
  };

  return (
    <View className="flex-1 bg-emerald-600">
      <View className="flex-row justify-between items-center p-4 pt-8">
        <View className="flex-row items-center">
          <MaterialIcons name="gps-fixed" size={24} color="#000" />
          <Text className="text-lg font-bold tracking-wider ml-2">BOUNTY</Text>
        </View>
        <TouchableOpacity onPress={onBack} className="p-2" accessibilityRole="button" accessibilityLabel="Back">
          <MaterialIcons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
      </View>
      <ScrollView className="px-4" contentContainerStyle={{ paddingBottom: 96 }}>
        <Text className="text-xl font-semibold text-white mb-4">Privacy & Security Settings</Text>

        {/* Password */}
        <View className="bg-black/30 rounded-xl p-4 mb-5">
          <SectionHeader icon="lock" title="Password" subtitle="Change your password to keep account secure." />
          <Text className="text-xs text-emerald-200 mb-1">Current Password</Text>
          <TextInput value={state.passwordCurrent} onChangeText={v => persist({ passwordCurrent: v })} secureTextEntry placeholder="••••••" placeholderTextColor="#a7f3d0" className="bg-black/40 rounded-md px-3 py-2 text-white mb-3" />
          <Text className="text-xs text-emerald-200 mb-1">New Password</Text>
            <TextInput value={state.passwordNew} onChangeText={v => persist({ passwordNew: v })} secureTextEntry placeholder="At least 8 characters" placeholderTextColor="#a7f3d0" className="bg-black/40 rounded-md px-3 py-2 text-white mb-3" />
          <Text className="text-xs text-emerald-200 mb-1">Confirm New Password</Text>
          <TextInput value={state.passwordConfirm} onChangeText={v => persist({ passwordConfirm: v })} secureTextEntry placeholder="Repeat new password" placeholderTextColor="#a7f3d0" className="bg-black/40 rounded-md px-3 py-2 text-white mb-4" />
          <TouchableOpacity onPress={changePassword} className="self-start px-4 py-2 rounded-md bg-emerald-700">
            <Text className="text-white text-xs font-medium">Update Password</Text>
          </TouchableOpacity>
        </View>

        {/* 2FA */}
        <View className="bg-black/30 rounded-xl p-4 mb-5">
          <SectionHeader icon="security" title="Two-Factor Authentication" subtitle="Add an extra layer of protection." />
          <View className="flex-row items-center justify-between mt-1">
            <Text className="text-emerald-100 text-xs mr-4 flex-1">Require a second factor when signing in on a new device.</Text>
            <Switch value={state.twoFactor} onValueChange={v => persist({ twoFactor: v })} />
          </View>
        </View>

        {/* Visibility */}
        <View className="bg-black/30 rounded-xl p-4 mb-5">
          <SectionHeader icon="visibility" title="Visibility" subtitle="Control what other users can see." />
          <ToggleRow label="Public profile visible" value={state.showProfilePublic} onChange={v => persist({ showProfilePublic: v })} />
          <ToggleRow label="Show completed bounties" value={state.showCompletedBounties} onChange={v => persist({ showCompletedBounties: v })} />
        </View>

        {/* Sessions */}
        <View className="bg-black/30 rounded-xl p-4 mb-5">
          <SectionHeader icon="devices" title="Session Management" subtitle="Active devices using your account." />
          {state.sessions.map(s => (
            <View key={s.id} className="flex-row items-center justify-between py-2 border-b border-emerald-700/40 last:border-b-0">
              <View className="flex-1 mr-3">
                <Text className="text-white text-xs font-medium">{s.device}</Text>
                <Text className="text-emerald-300 text-[10px]">{s.location}</Text>
              </View>
              {s.active ? (
                <TouchableOpacity onPress={() => revokeSession(s.id)} className="px-3 py-1 rounded-md bg-emerald-700">
                  <Text className="text-white text-[10px] font-medium">Revoke</Text>
                </TouchableOpacity>
              ) : (
                <Text className="text-[10px] text-emerald-400">Revoked</Text>
              )}
            </View>
          ))}
        </View>

        {/* Data Export */}
        <View className="bg-black/30 rounded-xl p-4 mb-5">
          <SectionHeader icon="file-download" title="Data Export" subtitle="Request a copy of your account data." />
          <TouchableOpacity disabled={state.exporting} onPress={exportData} className={`self-start px-4 py-2 rounded-md ${state.exporting ? 'bg-emerald-900 opacity-60' : 'bg-emerald-700'}`}> 
            <Text className="text-white text-xs font-medium">{state.exporting ? 'Preparing…' : 'Start Export'}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
};

const SectionHeader = ({ icon, title, subtitle }: { icon: any; title: string; subtitle: string }) => (
  <View className="mb-3">
    <View className="flex-row items-center mb-1">
      <MaterialIcons name={icon} size={18} color="#34d399" />
      <Text className="ml-2 text-white font-medium text-sm">{title}</Text>
    </View>
    <Text className="text-emerald-300 text-[11px] leading-4">{subtitle}</Text>
  </View>
);

const ToggleRow = ({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) => (
  <View className="flex-row items-center justify-between py-2">
    <Text className="text-emerald-100 text-xs flex-1 mr-4">{label}</Text>
    <Switch value={value} onValueChange={onChange} />
  </View>
);