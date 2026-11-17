import { SettingsScreenHeader } from 'components/ui/settings-screen-header';
import { feedbackService, SUPPORT_SUBJECT_MAX_LENGTH } from '../../lib/services/feedback-service';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FeedbackForm } from './feedback-form';

interface ContactSupportScreenProps {
  onBack: () => void;
  /**
   * The job this message is about, when support was opened from one. The
   * contact-support edge function only takes a subject and a message, so the
   * job is written into the message itself for the support inbox to see.
   */
  bountyId?: string | null;
  bountyTitle?: string | null;
  /**
   * 'assist' is "Have Bounty help me with this job": the request is written
   * for the poster, so asking for a person's help is one tap on Send. It
   * promises an email reply, as the form always has, and nothing more.
   */
  topic?: 'assist';
}

/** The job reference appended to a support message sent from a job. */
export function withJobReference(
  message: string,
  bountyId?: string | null,
  bountyTitle?: string | null
): string {
  if (!bountyId) return message;
  const title = bountyTitle?.trim();
  return `${message}\n\n---\n${title ? `Job: "${title}"\n` : ''}Job ID: ${bountyId}`;
}

/**
 * In-app Contact Support form. Sends the message to the support inbox via the
 * `contact-support` edge function (no mail app needed). Reached from both
 * Help & Support and Feedback & Support, and from a job's "Contact support"
 * action through the /support/contact route.
 */
export const ContactSupportScreen: React.FC<ContactSupportScreenProps> = ({ onBack, bountyId, bountyTitle, topic }) => {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const title = bountyTitle?.trim() || null;
  const assist = topic === 'assist';
  const initialSubject = bountyId
    ? (assist
        ? title ? `Please help me with "${title}"` : 'Please help me with my job'
        : title ? `Help with "${title}"` : 'Help with my job'
      ).slice(0, SUPPORT_SUBJECT_MAX_LENGTH)
    : undefined;
  const initialDescription = assist
    ? "I'd like someone at Bounty to help me with this job. "
    : undefined;

  return (
    <View style={s.container}>
      <SettingsScreenHeader icon="support-agent" title={assist ? 'Ask for help' : 'Contact Support'} onBack={onBack} />
      {assist && (
        <Text style={s.assistIntro} testID="contact-support-assist-intro">
          {"Tell us what you'd like help with: choosing someone, keeping in touch with them, or sorting out a problem. A person on our team will reply to your account email."}
        </Text>
      )}
      {!!bountyId && (
        <Text style={s.context} testID="contact-support-job-context">
          {title ? `About your job: ${title}` : 'About this job'}
        </Text>
      )}
      <FeedbackForm
        subjectLabel="Subject"
        subjectPlaceholder="What do you need help with?"
        descriptionLabel="Details"
        descriptionPlaceholder="Describe the issue or request. We'll reply to your account email."
        submitLabel="Send Message"
        initialSubject={initialSubject}
        initialDescription={initialDescription}
        onSubmit={(values) =>
          feedbackService.submitSupportRequest({
            subject: values.subject,
            message: withJobReference(values.description, bountyId, title),
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
    assistIntro: {
      paddingHorizontal: 16,
      paddingTop: 12,
      fontSize: 17,
      lineHeight: 24,
      color: t.text,
    },
    context: {
      paddingHorizontal: 16,
      paddingTop: 12,
      fontSize: 15,
      color: t.textSecondary,
    },
  });
}
