import React, { useEffect } from 'react';
import { Alert, Platform } from 'react-native';
import { reportService } from '../lib/services/report-service';

interface ReportModalProps {
  visible: boolean;
  onClose: () => void;
  contentType: 'bounty' | 'profile' | 'message';
  contentId: string;
  contentTitle?: string; // Optional title/name to display
}

/**
 * ReportModal - Uses native Alert dialogs instead of a modal overlay
 * for better visibility and a cleaner user experience
 */
export function ReportModal({
  visible,
  onClose,
  contentType,
  contentId,
  contentTitle,
}: ReportModalProps) {
  const getContentTypeLabel = () => {
    switch (contentType) {
      case 'bounty':
        return 'Bounty';
      case 'profile':
        return 'User Profile';
      case 'message':
        return 'Message';
      default:
        return 'Content';
    }
  };

  const handleSubmitReport = async (reason: 'spam' | 'harassment' | 'inappropriate' | 'fraud') => {
    try {
      let result;
      if (contentType === 'bounty') {
        result = await reportService.reportBounty(contentId, reason);
      } else if (contentType === 'profile') {
        result = await reportService.reportUser(contentId, reason);
      } else {
        result = await reportService.reportMessage(contentId, reason);
      }

      if (result.success) {
        Alert.alert(
          'Report Submitted',
          'Thank you for helping keep our community safe. We will review this report.',
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert('Error', result.error || 'Failed to submit report. Please try again.');
      }
    } catch (error) {
      console.error('Error submitting report:', error);
      Alert.alert('Error', 'An unexpected error occurred. Please try again.');
    }
  };

  const showMoreOptions = () => {
    Alert.alert(
      'More Report Options',
      'Select another reason:',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Inappropriate Content',
          onPress: () => {
            handleSubmitReport('inappropriate');
            onClose();
          },
        },
        {
          text: 'Scam or Fraud',
          onPress: () => {
            handleSubmitReport('fraud');
            onClose();
          },
        },
      ],
      { cancelable: true }
    );
  };

  // Show the alert when visible becomes true
  useEffect(() => {
    if (visible) {
      const contentLabel = getContentTypeLabel();
      const titleText = contentTitle ? `"${contentTitle}"` : `this ${contentLabel.toLowerCase()}`;
      
      // Show the report reason selection as a native Alert with action buttons
      // Using a maximum of 4 buttons for compatibility
      Alert.alert(
        `Report ${contentLabel}`,
        `Why are you reporting ${titleText}?`,
        [
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: onClose,
          },
          {
            text: 'Spam',
            onPress: () => {
              handleSubmitReport('spam');
              onClose();
            },
          },
          {
            text: 'Harassment',
            onPress: () => {
              handleSubmitReport('harassment');
              onClose();
            },
          },
          {
            text: 'More...',
            onPress: showMoreOptions,
          },
        ],
        { cancelable: true, onDismiss: onClose }
      );
    }
  }, [visible, contentType, contentId, contentTitle, onClose]);

  // This component doesn't render anything visible - it uses native Alert
  return null;
}

/**
 * Alternative: Show report dialog using Alert with all options
 * Call this function directly instead of using the component
 */
export function showReportAlert(
  contentType: 'bounty' | 'profile' | 'message',
  contentId: string,
  contentTitle?: string,
  onComplete?: () => void
) {
  const getContentTypeLabel = () => {
    switch (contentType) {
      case 'bounty':
        return 'Bounty';
      case 'profile':
        return 'User Profile';
      case 'message':
        return 'Message';
      default:
        return 'Content';
    }
  };

  const handleSubmitReport = async (reason: 'spam' | 'harassment' | 'inappropriate' | 'fraud') => {
    try {
      let result;
      if (contentType === 'bounty') {
        result = await reportService.reportBounty(contentId, reason);
      } else if (contentType === 'profile') {
        result = await reportService.reportUser(contentId, reason);
      } else {
        result = await reportService.reportMessage(contentId, reason);
      }

      if (result.success) {
        Alert.alert(
          'Report Submitted',
          'Thank you for helping keep our community safe. We will review this report.',
          [{ text: 'OK', onPress: onComplete }]
        );
      } else {
        Alert.alert('Error', result.error || 'Failed to submit report. Please try again.', [
          { text: 'OK', onPress: onComplete }
        ]);
      }
    } catch (error) {
      console.error('Error submitting report:', error);
      Alert.alert('Error', 'An unexpected error occurred. Please try again.', [
        { text: 'OK', onPress: onComplete }
      ]);
    }
  };

  const showMoreOptions = () => {
    Alert.alert(
      'More Report Options',
      'Select another reason:',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Inappropriate Content',
          onPress: () => handleSubmitReport('inappropriate'),
        },
        {
          text: 'Scam or Fraud',
          onPress: () => handleSubmitReport('fraud'),
        },
      ],
      { cancelable: true }
    );
  };

  const contentLabel = getContentTypeLabel();
  const titleText = contentTitle ? `"${contentTitle}"` : `this ${contentLabel.toLowerCase()}`;

  Alert.alert(
    `Report ${contentLabel}`,
    `Why are you reporting ${titleText}?`,
    [
      {
        text: 'Cancel',
        style: 'cancel',
        onPress: onComplete,
      },
      {
        text: 'Spam',
        onPress: () => handleSubmitReport('spam'),
      },
      {
        text: 'Harassment',
        onPress: () => handleSubmitReport('harassment'),
      },
      {
        text: 'More...',
        onPress: showMoreOptions,
      },
    ],
    { cancelable: true, onDismiss: onComplete }
  );
}
