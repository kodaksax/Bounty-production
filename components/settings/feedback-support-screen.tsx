import { MaterialIcons } from '@expo/vector-icons';
import { BrandingLogo } from 'components/ui/branding-logo';
import { SettingsRow } from 'components/ui/settings-row';
import * as Clipboard from 'expo-clipboard';
import React, { useState } from 'react';
import { Alert, Linking, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { feedbackService } from '../../lib/services/feedback-service';
import { FeedbackForm } from './feedback-form';

interface FeedbackSupportScreenProps {
  onBack: () => void;
}

type Panel = 'root' | 'bug' | 'feature';

export const FeedbackSupportScreen: React.FC<FeedbackSupportScreenProps> = ({ onBack }) => {
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

  const Header = ({ title, back }: { title: string; back: () => void }) => (
    <>
      <View className="flex-row justify-between items-center p-4 pt-8">
        <View className="flex-row items-center">
          <BrandingLogo size="small" />
        </View>
        <TouchableOpacity onPress={back} className="p-2" accessibilityRole="button" accessibilityLabel="Back">
          <MaterialIcons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
      </View>
      <Text className="text-xl font-semibold text-white px-4 mb-4">{title}</Text>
    </>
  );

  if (panel === 'bug') {
    return (
      <View className="flex-1 bg-emerald-600">
        <Header title="Report a Bug" back={() => setPanel('root')} />
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
      <View className="flex-1 bg-emerald-600">
        <Header title="Suggest a Feature" back={() => setPanel('root')} />
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
    <View className="flex-1 bg-emerald-600">
      <Header title="Feedback & Support" back={onBack} />
      <ScrollView className="px-4" contentContainerStyle={{ paddingBottom: 96 }}>
        <Text className="text-emerald-200 text-xs leading-4 mb-4">
          Report bugs, suggest features, contact our team, or rate the app.
        </Text>

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

        {showEmailFallback && (
          <View className="bg-black/30 rounded-xl p-4 mt-2">
            <Text className="text-white font-medium text-sm mb-1">Email not available</Text>
            <Text className="text-emerald-200 text-xs leading-4 mb-3">
              No email app is set up on this device. You can reach us at:
            </Text>
            <View className="flex-row items-center justify-between bg-black/40 rounded-md px-3 py-2">
              <Text className="text-white text-sm" selectable>
                {feedbackService.getSupportEmail()}
              </Text>
              <TouchableOpacity
                onPress={handleCopyEmail}
                accessibilityRole="button"
                accessibilityLabel="Copy support email"
                className="flex-row items-center px-3 py-1 rounded-md bg-emerald-700 ml-2"
              >
                <MaterialIcons name="content-copy" size={16} color="#fff" />
                <Text className="text-white text-xs font-medium ml-1">Copy</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
};
