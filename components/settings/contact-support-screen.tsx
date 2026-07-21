import { SettingsScreenHeader } from 'components/ui/settings-screen-header';
import { SettingsSection } from 'components/ui/settings-section';
import { ThemedButton } from 'components/themed/ThemedButton';
import { ThemedInput } from 'components/themed/ThemedInput';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';
import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

interface ContactSupportScreenProps { onBack: () => void }

export const ContactSupportScreen: React.FC<ContactSupportScreenProps> = ({ onBack }) => {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [subject, setSubject] = useState('');
  const [details, setDetails] = useState('');
  const canSubmit = !!subject && !!details;

  const submit = () => {
    // Placeholder: integrate with backend ticket system later
    Alert.alert('Submitted', 'Your support request has been sent.');
    setSubject('');
    setDetails('');
    onBack();
  };

  return (
    <View style={s.container}>
      <SettingsScreenHeader icon="support-agent" title="Contact Support" onBack={onBack} />
      <ScrollView className="px-4" contentContainerStyle={{ paddingBottom: 64, paddingTop: 16 }}>
        <SettingsSection description="Provide detailed information so our team can respond quickly.">
          <View style={s.formBlock}>
            <Text style={s.label}>Subject</Text>
            <ThemedInput
              value={subject}
              onChangeText={setSubject}
              placeholder="Issue subject"
              accessibilityLabel="Subject"
              containerStyle={s.subjectInput}
            />
            <Text style={s.label}>Details</Text>
            <ThemedInput
              value={details}
              onChangeText={setDetails}
              placeholder="Describe the issue or request"
              multiline
              numberOfLines={6}
              textAlignVertical="top"
              accessibilityLabel="Details"
              containerStyle={s.detailsInput}
            />
          </View>
        </SettingsSection>

        <View className="flex-row gap-3">
          <ThemedButton variant="primary" label="Submit Request" onPress={submit} disabled={!canSubmit} />
          <ThemedButton variant="secondary" label="Cancel" onPress={onBack} />
        </View>
      </ScrollView>
    </View>
  );
};

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: t.background,
    },
    formBlock: {
      padding: 16,
    },
    label: {
      fontSize: 13,
      fontWeight: '600',
      color: t.text,
      marginBottom: 6,
    },
    subjectInput: {
      marginBottom: 16,
    },
    detailsInput: {
      marginBottom: 4,
      minHeight: 120,
      alignItems: 'flex-start',
    },
  });
}
