import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { reportService } from '../lib/services/report-service';

type ContentType = 'bounty' | 'profile' | 'message';
type ReportReason = 'spam' | 'harassment' | 'inappropriate' | 'fraud';

interface ReportModalProps {
  visible: boolean;
  onClose: () => void;
  contentType: ContentType;
  contentId: string;
  contentTitle?: string;
}

// Helper to get content type label
const getContentTypeLabel = (contentType: ContentType): string => {
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

// Common report submission logic
const submitReport = async (
  contentType: ContentType,
  contentId: string,
  reason: ReportReason,
  onComplete?: () => void
): Promise<void> => {
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

// Show more options dialog
const showMoreOptions = (
  contentType: ContentType,
  contentId: string,
  onComplete?: () => void
): void => {
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
        onPress: () => submitReport(contentType, contentId, 'inappropriate', onComplete),
      },
      {
        text: 'Scam or Fraud',
        onPress: () => submitReport(contentType, contentId, 'fraud', onComplete),
      },
    ],
    { cancelable: true }
  );
};

// Main report dialog
const showMainReportDialog = (
  contentType: ContentType,
  contentId: string,
  contentTitle: string | undefined,
  onComplete?: () => void
): void => {
  const contentLabel = getContentTypeLabel(contentType);
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
        onPress: () => submitReport(contentType, contentId, 'spam', onComplete),
      },
      {
        text: 'Harassment',
        onPress: () => submitReport(contentType, contentId, 'harassment', onComplete),
      },
      {
        text: 'More...',
        onPress: () => showMoreOptions(contentType, contentId, onComplete),
      },
    ],
    { cancelable: true, onDismiss: onComplete }
  );
};

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
  // Track if dialog has been shown for current visibility state to prevent
  // multiple Alert shows when parent re-renders with unstable onClose reference
  const shownRef = useRef(false);

  useEffect(() => {
    if (visible && !shownRef.current) {
      shownRef.current = true;
      showMainReportDialog(contentType, contentId, contentTitle, onClose);
    } else if (!visible) {
      shownRef.current = false;
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
  contentType: ContentType,
  contentId: string,
  contentTitle?: string,
  onComplete?: () => void
): void {
  showMainReportDialog(contentType, contentId, contentTitle, onComplete);
}
