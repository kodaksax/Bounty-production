import { MaterialIcons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { REPORT_REASONS, reportService } from '../lib/services/report-service';

interface ReportModalProps {
  visible: boolean;
  onClose: () => void;
  contentType: 'bounty' | 'profile' | 'message';
  contentId: string;
  contentTitle?: string; // Optional title/name to display
}

export function ReportModal({
  visible,
  onClose,
  contentType,
  contentId,
  contentTitle,
}: ReportModalProps) {
  const [selectedReason, setSelectedReason] = useState<
    'spam' | 'harassment' | 'inappropriate' | 'fraud' | null
  >(null);
  const [details, setDetails] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!selectedReason) {
      Alert.alert('Please select a reason', 'You must select a reason for reporting this content.');
      return;
    }

    setIsSubmitting(true);
    try {
      let result;
      if (contentType === 'bounty') {
        result = await reportService.reportBounty(contentId, selectedReason, details);
      } else if (contentType === 'profile') {
        result = await reportService.reportUser(contentId, selectedReason, details);
      } else {
        result = await reportService.reportMessage(contentId, selectedReason, details);
      }

      if (result.success) {
        Alert.alert(
          'Report Submitted',
          'Thank you for helping keep our community safe. We will review this report.',
          [{ text: 'OK', onPress: handleClose }]
        );
      } else {
        Alert.alert('Error', result.error || 'Failed to submit report. Please try again.');
      }
    } catch (error) {
      console.error('Error submitting report:', error);
      Alert.alert('Error', 'An unexpected error occurred. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setSelectedReason(null);
    setDetails('');
    onClose();
  };

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

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      transparent
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <MaterialIcons name="report" size={24} color="white" />
              <Text style={styles.headerTitle}>Report {getContentTypeLabel()}</Text>
            </View>
            <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
              <MaterialIcons name="close" size={24} color="white" />
            </TouchableOpacity>
          </View>

          {/* Content */}
          <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
            {contentTitle && (
              <View style={styles.infoBox}>
                <Text style={styles.infoText}>
                  Reporting: <Text style={styles.infoTextBold}>{contentTitle}</Text>
                </Text>
              </View>
            )}

            <Text style={styles.sectionTitle}>Why are you reporting this?</Text>
            <Text style={styles.sectionDescription}>
              Select the reason that best describes the issue:
            </Text>

            {/* Reason Selection */}
            <View style={styles.reasonList}>
              {REPORT_REASONS.map((reason) => (
                <TouchableOpacity
                  key={reason.id}
                  style={[
                    styles.reasonItem,
                    selectedReason === reason.id && styles.reasonItemSelected,
                  ]}
                  onPress={() => setSelectedReason(reason.id)}
                  activeOpacity={0.7}
                >
                  <View style={styles.reasonRadio}>
                    {selectedReason === reason.id && (
                      <View style={styles.reasonRadioSelected} />
                    )}
                  </View>
                  <Text
                    style={[
                      styles.reasonText,
                      selectedReason === reason.id && styles.reasonTextSelected,
                    ]}
                  >
                    {reason.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Additional Details */}
            <Text style={styles.sectionTitle}>Additional Details (Optional)</Text>
            <TextInput
              style={styles.textInput}
              placeholder="Provide any additional context that might help our review..."
              placeholderTextColor="#a7f3d0"
              multiline
              numberOfLines={4}
              value={details}
              onChangeText={setDetails}
              textAlignVertical="top"
            />

            {/* Disclaimer */}
            <View style={styles.disclaimer}>
              <MaterialIcons name="info" size={16} color="#a7f3d0" />
              <Text style={styles.disclaimerText}>
                Reports are reviewed by our moderation team. False reports may result in account
                restrictions.
              </Text>
            </View>
          </ScrollView>

          {/* Action Buttons */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={handleClose}
              disabled={isSubmitting}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
              onPress={handleSubmit}
              disabled={isSubmitting || !selectedReason}
            >
              {isSubmitting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.submitButtonText}>Submit Report</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: '#059669', // emerald-600
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#047857', // emerald-700
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
  },
  closeButton: {
    padding: 4,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
  },
  infoBox: {
    backgroundColor: '#047857cc',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  infoText: {
    color: '#d1fae5',
    fontSize: 14,
  },
  infoTextBold: {
    fontWeight: '600',
    color: 'white',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
    marginBottom: 8,
    marginTop: 8,
  },
  sectionDescription: {
    fontSize: 14,
    color: '#d1fae5',
    marginBottom: 12,
  },
  reasonList: {
    gap: 8,
    marginBottom: 16,
  },
  reasonItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#047857cc',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  reasonItemSelected: {
    backgroundColor: '#064e3b',
    borderColor: '#10b981',
  },
  reasonRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#a7f3d0',
    marginRight: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reasonRadioSelected: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#10b981',
  },
  reasonText: {
    fontSize: 14,
    color: '#d1fae5',
    flex: 1,
  },
  reasonTextSelected: {
    color: 'white',
    fontWeight: '500',
  },
  textInput: {
    backgroundColor: '#047857cc',
    borderRadius: 8,
    padding: 12,
    color: 'white',
    fontSize: 14,
    minHeight: 100,
    marginBottom: 16,
  },
  disclaimer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    backgroundColor: '#047857cc',
    borderRadius: 8,
    marginTop: 8,
  },
  disclaimerText: {
    flex: 1,
    fontSize: 12,
    color: '#a7f3d0',
    lineHeight: 18,
  },
  actions: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
    backgroundColor: '#047857',
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 12,
    backgroundColor: '#059669',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '500',
  },
  submitButton: {
    flex: 1,
    paddingVertical: 12,
    backgroundColor: '#10b981',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonDisabled: {
    backgroundColor: '#059669',
    opacity: 0.6,
  },
  submitButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});
