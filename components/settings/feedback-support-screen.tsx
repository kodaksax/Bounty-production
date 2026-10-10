import { SettingsRow } from 'components/ui/settings-row';
import { SettingsScreenHeader } from 'components/ui/settings-screen-header';
import { SettingsSection } from 'components/ui/settings-section';
import React, { useMemo, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, View } from 'react-native';
import { feedbackService } from '../../lib/services/feedback-service';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';
import { ContactSupportScreen } from './contact-support-screen';
import { FeedbackForm } from './feedback-form';

interface FeedbackSupportScreenProps {
  onBack: () => void;
}

type Panel = 'root' | 'bug' | 'feature' | 'support';

export const FeedbackSupportScreen: React.FC<FeedbackSupportScreenProps> = ({ onBack }) => {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [panel, setPanel] = useState<Panel>('root');
  const [rateProcessing, setRateProcessing] = useState(false);

  const handleRateBounty = async () => {
    if (rateProcessing) return;
    setRateProcessing(true);
    try {
      const url = feedbackService.getStoreUrl();
      if (!url) {
        Alert.alert('Unavailable', 'App store rating is not available on this device.');
        return;
      }
      await Linking.openURL(url);
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

  if (panel === 'support') {
    return <ContactSupportScreen onBack={() => setPanel('root')} />;
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
            description="Send a message to our support team."
            onPress={() => setPanel('support')}
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
      </ScrollView>
    </View>
  );
};

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    screen: {
      backgroundColor: t.background,
    },
  });
}
