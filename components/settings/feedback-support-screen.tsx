import { MaterialIcons } from '@expo/vector-icons';
import { SettingsRow } from 'components/ui/settings-row';
import { SettingsScreenHeader } from 'components/ui/settings-screen-header';
import { SettingsSection } from 'components/ui/settings-section';
import * as Clipboard from 'expo-clipboard';
import React, { useMemo, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { feedbackService } from '../../lib/services/feedback-service';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';
import { FeedbackForm } from './feedback-form';

interface FeedbackSupportScreenProps {
  onBack: () => void;
}

type Panel = 'root' | 'bug' | 'feature';

export const FeedbackSupportScreen: React.FC<FeedbackSupportScreenProps> = ({ onBack }) => {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [panel, setPanel] = useState<Panel>('root');
  const [contactProcessing, setContactProcessing] = useState(false);
  const [rateProcessing, setRateProcessing] = useState(false);
  const [showEmailFallback, setShowEmailFallback] = useState(false);

  const handleContactSupport = async () => {
    if (contactProcessing) return;
    setContactProcessing(true);
    try {
      const url = feedbackService.getSupportMailtoUrl();
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        setShowEmailFallback(true);
      }
    } catch (e) {
      console.error('[FeedbackSupport] Failed to open mail composer:', e);
      setShowEmailFallback(true);
    } finally {
      setContactProcessing(false);
    }
  };

  const handleCopyEmail = async () => {
    try {
      await Clipboard.setStringAsync(feedbackService.getSupportEmail());
      Alert.alert('Copied', 'Support email copied to clipboard.');
    } catch (e) {
      console.error('[FeedbackSupport] Failed to copy email:', e);
    }
  };

  const handleRateBounty = async () => {
    if (rateProcessing) return;
    setRateProcessing(true);
    try {
      const url = feedbackService.getStoreUrl();
      if (!url) {
        Alert.alert('Unavailable', 'App store rating is not available on this device.');
        return;
      }
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        Alert.alert('Unavailable', 'Could not open the app store. Please try again later.');
      }
    } catch (e) {
      console.error('[FeedbackSupport] Failed to open store link:', e);
      Alert.alert('Unavailable', 'Could not open the app store. Please try again later.');
    } finally {
      setRateProcessing(false);
    }
  };

  if (panel === 'bug') {
    return (
      <View style={s.screen} className="flex-1">
        <SettingsScreenHeader icon="bug-report" title="Report a Bug" onBack={() => setPanel('root')} />
        <FeedbackForm
          subjectLabel="Subject"
          subjectPlaceholder="Brief summary of the issue"
          descriptionPlaceholder="What happened? Steps to reproduce, expected vs. actual..."
          allowScreenshot
          submitLabel="Submit Report"
          onSubmit={(values) =>
            feedbackService.submitBugReport({
              subject: values.subject,
              description: values.description,
              screenshotUri: values.screenshotUri,
            })
          }
          onCancel={() => setPanel('root')}
          onSuccess={() => setPanel('root')}
        />
      </View>
    );
  }

  if (panel === 'feature') {
    return (
      <View style={s.screen} className="flex-1">
        <SettingsScreenHeader icon="lightbulb" title="Suggest a Feature" onBack={() => setPanel('root')} />
        <FeedbackForm
          subjectLabel="Feature Title"
          subjectPlaceholder="What would you like to see?"
          descriptionPlaceholder="Describe the feature and how it would help you."
          submitLabel="Submit Request"
          onSubmit={(values) =>
            feedbackService.submitFeatureRequest({
              title: values.subject,
              description: values.description,
            })
          }
          onCancel={() => setPanel('root')}
          onSuccess={() => setPanel('root')}
        />
      </View>
    );
  }

  return (
    <View style={s.screen} className="flex-1">
      <SettingsScreenHeader icon="feedback" title="Feedback & Support" onBack={onBack} />
      <ScrollView className="px-4" contentContainerStyle={{ paddingTop: 16, paddingBottom: 96 }}>
        <SettingsSection description="Report bugs, suggest features, contact our team, or rate the app.">
          <SettingsRow
            icon="bug-report"
            label="Report a Bug"
            description="Tell us about something that isn't working."
            onPress={() => setPanel('bug')}
          />
          <SettingsRow
            icon="lightbulb"
            label="Suggest a Feature"
            description="Share an idea to make Bounty better."
            onPress={() => setPanel('feature')}
          />
          <SettingsRow
            icon="support-agent"
            label="Contact Support"
            description="Email our support team directly."
            onPress={handleContactSupport}
            loading={contactProcessing}
            hideChevron
          />
          <SettingsRow
            icon="star-rate"
            label="Rate Bounty"
            description="Enjoying the app? Leave us a rating."
            onPress={handleRateBounty}
            loading={rateProcessing}
            hideChevron
          />
        </SettingsSection>

        {showEmailFallback && (
          <View style={s.fallbackCard}>
            <Text style={s.fallbackTitle}>Email not available</Text>
            <Text style={s.fallbackDescription}>
              No email app is set up on this device. You can reach us at:
            </Text>
            <View style={s.emailRow}>
              <Text style={s.emailText} selectable>
                {feedbackService.getSupportEmail()}
              </Text>
              <TouchableOpacity
                onPress={handleCopyEmail}
                accessibilityRole="button"
                accessibilityLabel="Copy support email"
                style={s.copyButton}
              >
                <MaterialIcons name="content-copy" size={16} color="#ffffff" />
                <Text style={s.copyButtonText}>Copy</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
};

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    screen: {
      backgroundColor: t.background,
    },
    fallbackCard: {
      backgroundColor: t.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: t.border,
      padding: 16,
      marginTop: 8,
    },
    fallbackTitle: {
      color: t.text,
      fontSize: 14,
      fontWeight: '600',
      marginBottom: 4,
    },
    fallbackDescription: {
      color: t.textSecondary,
      fontSize: 12,
      lineHeight: 16,
      marginBottom: 12,
    },
    emailRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: t.surfaceSecondary,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    emailText: {
      color: t.text,
      fontSize: 13,
      flex: 1,
      marginRight: 8,
    },
    copyButton: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 8,
      backgroundColor: t.primary,
    },
    copyButtonText: {
      color: '#ffffff',
      fontSize: 12,
      fontWeight: '600',
      marginLeft: 4,
    },
  });
}
