import { SettingsScreenHeader } from 'components/ui/settings-screen-header';
import { feedbackService } from '../../lib/services/feedback-service';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';
import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { FeedbackForm } from './feedback-form';

interface ContactSupportScreenProps { onBack: () => void }

/**
 * In-app Contact Support form. Sends the message to the support inbox via the
 * `contact-support` edge function (no mail app needed). Reached from both
 * Help & Support and Feedback & Support.
 */
export const ContactSupportScreen: React.FC<ContactSupportScreenProps> = ({ onBack }) => {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);

  return (
    <View style={s.container}>
      <SettingsScreenHeader icon="support-agent" title="Contact Support" onBack={onBack} />
      <FeedbackForm
        subjectLabel="Subject"
        subjectPlaceholder="What do you need help with?"
        descriptionLabel="Details"
        descriptionPlaceholder="Describe the issue or request. We'll reply to your account email."
        submitLabel="Send Message"
        onSubmit={(values) =>
          feedbackService.submitSupportRequest({
            subject: values.subject,
            message: values.description,
          })
        }
        onCancel={onBack}
        onSuccess={onBack}
      />
    </View>
  );
};

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: t.background,
    },
  });
}
