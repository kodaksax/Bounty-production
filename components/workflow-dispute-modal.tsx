import { MaterialIcons } from '@expo/vector-icons'
import React, { useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAttachmentUpload } from '../hooks/use-attachment-upload'
import { disputeService } from '../lib/services/dispute-service'
import type { LocalDisputeEvidence } from '../lib/types'

type Props = {
  visible: boolean
  bountyId: string
  bountyTitle: string
  initiatorId: string
  respondentId: string
  stage: 'in_progress' | 'review_verify'
  onClose: () => void
  onDisputeCreated: (disputeId: string) => void
}

type Step = 'info' | 'reason' | 'evidence' | 'confirm'

const STEPS: Step[] = ['info', 'reason', 'evidence', 'confirm']

const DISPUTE_REASONS = [
  'Work quality does not meet requirements',
  'Unresponsive or abandoned work',
  'Scope disagreement',
  'Missed deadline or timeline',
  'Communication breakdown',
  'Other (describe below)',
]

export function WorkflowDisputeModal({
  visible,
  bountyId,
  bountyTitle,
  initiatorId,
  respondentId,
  stage,
  onClose,
  onDisputeCreated,
}: Props) {
  const insets = useSafeAreaInsets()
  const [currentStep, setCurrentStep] = useState<Step>('info')
  const [selectedReason, setSelectedReason] = useState<string | null>(null)
  const [reasonText, setReasonText] = useState('')
  const [evidenceItems, setEvidenceItems] = useState<LocalDisputeEvidence[]>([])
  const [textEvidence, setTextEvidence] = useState('')
  const [linkEvidence, setLinkEvidence] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const { pickAttachment } = useAttachmentUpload({
    bucket: 'bounty-attachments',
    folder: `disputes/${bountyId}`,
    maxSizeMB: 10,
    allowsMultiple: true,
    onUploaded: (attachment) => {
      const evidence: LocalDisputeEvidence = {
        id: attachment.id,
        type: attachment.mimeType?.startsWith('image/') ? 'image' : 'document',
        content: attachment.remoteUri || attachment.uri,
        description: attachment.name,
        mimeType: attachment.mimeType,
        fileSize: attachment.size,
        uploadedAt: new Date().toISOString(),
      }
      setEvidenceItems((prev) => [...prev, evidence])
    },
    onError: (error) => {
      Alert.alert('Upload Error', error.message)
    },
  })

  const resetState = () => {
    setCurrentStep('info')
    setSelectedReason(null)
    setReasonText('')
    setEvidenceItems([])
    setTextEvidence('')
    setLinkEvidence('')
    setIsSubmitting(false)
  }

  const handleClose = () => {
    Alert.alert(
      'Cancel Dispute?',
      'Your dispute draft will be lost.',
      [
        { text: 'Keep Editing', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            resetState()
            onClose()
          },
        },
      ]
    )
  }

  const currentStepIndex = STEPS.indexOf(currentStep)

  const goNext = () => {
    if (currentStepIndex < STEPS.length - 1) {
      setCurrentStep(STEPS[currentStepIndex + 1])
    }
  }

  const goBack = () => {
    if (currentStepIndex > 0) {
      setCurrentStep(STEPS[currentStepIndex - 1])
    }
  }

  const fullReason = selectedReason === 'Other (describe below)'
    ? reasonText
    : selectedReason
      ? `${selectedReason}${reasonText ? ': ' + reasonText : ''}`
      : reasonText

  const canProceedFromReason = fullReason.trim().length >= 20

  const handleAddTextEvidence = () => {
    if (!textEvidence.trim()) return
    const evidence: LocalDisputeEvidence = {
      id: `text-${Date.now()}`,
      type: 'text',
      content: textEvidence.trim(),
      uploadedAt: new Date().toISOString(),
    }
    setEvidenceItems((prev) => [...prev, evidence])
    setTextEvidence('')
  }

  const handleAddLinkEvidence = () => {
    if (!linkEvidence.trim()) return
    const evidence: LocalDisputeEvidence = {
      id: `link-${Date.now()}`,
      type: 'link',
      content: linkEvidence.trim(),
      uploadedAt: new Date().toISOString(),
    }
    setEvidenceItems((prev) => [...prev, evidence])
    setLinkEvidence('')
  }

  const handleRemoveEvidence = (id: string) => {
    setEvidenceItems((prev) => prev.filter((e) => e.id !== id))
  }

  const handleSubmit = async () => {
    if (!canProceedFromReason) {
      Alert.alert('Reason Required', 'Please provide a detailed reason (at least 20 characters).')
      return
    }

    Alert.alert(
      'Submit Dispute?',
      'This will notify the other party and escalate for admin review. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Submit Dispute',
          style: 'destructive',
          onPress: async () => {
            try {
              setIsSubmitting(true)
              const dispute = await disputeService.createWorkflowDispute(
                bountyId,
                initiatorId,
                respondentId,
                stage,
                fullReason,
                evidenceItems.length > 0 ? evidenceItems : undefined
              )

              if (dispute) {
                resetState()
                onDisputeCreated(dispute.id)
              } else {
                Alert.alert('Error', 'Failed to create dispute. Please try again.')
              }
            } catch (err) {
              console.error('Error creating workflow dispute:', err)
              Alert.alert('Error', 'Something went wrong. Please try again.')
            } finally {
              setIsSubmitting(false)
            }
          },
        },
      ]
    )
  }

  const stageLabel = stage === 'in_progress' ? 'Work In Progress' : 'Review & Verify'

  const renderInfoStep = () => (
    <View style={styles.stepContent}>
      <View style={styles.iconContainer}>
        <MaterialIcons name="gavel" size={48} color="#f59e0b" />
      </View>
      <Text style={styles.stepTitle}>Raise a Dispute</Text>
      <Text style={styles.stepDescription}>
        You are raising a dispute during the {stageLabel} stage for:
      </Text>
      <View style={styles.bountyCard}>
        <Text style={styles.bountyTitleText} numberOfLines={2}>{bountyTitle}</Text>
      </View>

      <View style={styles.infoBox}>
        <View style={styles.infoRow}>
          <MaterialIcons name="info" size={20} color="#6ee7b7" />
          <Text style={styles.infoText}>Both parties will be notified immediately</Text>
        </View>
        <View style={styles.infoRow}>
          <MaterialIcons name="lock" size={20} color="#6ee7b7" />
          <Text style={styles.infoText}>Escrow funds remain frozen during review</Text>
        </View>
        <View style={styles.infoRow}>
          <MaterialIcons name="schedule" size={20} color="#6ee7b7" />
          <Text style={styles.infoText}>An admin will review the dispute within 24-48 hours</Text>
        </View>
        <View style={styles.infoRow}>
          <MaterialIcons name="chat" size={20} color="#6ee7b7" />
          <Text style={styles.infoText}>Both parties can submit evidence and communicate</Text>
        </View>
      </View>

      <View style={styles.warningBox}>
        <MaterialIcons name="warning" size={20} color="#f59e0b" />
        <Text style={styles.warningText}>
          Disputes should only be raised for legitimate concerns. Frivolous disputes may affect your account standing.
        </Text>
      </View>
    </View>
  )

  const renderReasonStep = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>What's the issue?</Text>
      <Text style={styles.stepDescription}>Select a category and provide details:</Text>

      <View style={styles.reasonsList}>
        {DISPUTE_REASONS.map((reason) => (
          <TouchableOpacity
            key={reason}
            style={[
              styles.reasonOption,
              selectedReason === reason && styles.reasonOptionSelected,
            ]}
            onPress={() => setSelectedReason(reason)}
          >
            <MaterialIcons
              name={selectedReason === reason ? 'radio-button-checked' : 'radio-button-unchecked'}
              size={20}
              color={selectedReason === reason ? '#10b981' : '#6ee7b7'}
            />
            <Text style={styles.reasonOptionText}>{reason}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.inputLabel}>Additional Details</Text>
      <TextInput
        style={styles.textArea}
        placeholder="Describe the issue in detail (minimum 20 characters)..."
        placeholderTextColor="rgba(255,254,245,0.4)"
        value={reasonText}
        onChangeText={setReasonText}
        multiline
        numberOfLines={4}
        maxLength={2000}
        textAlignVertical="top"
      />
      <Text style={[styles.charCount, fullReason.length >= 20 && styles.charCountValid]}>
        {fullReason.length}/20 minimum characters
      </Text>
    </View>
  )

  const renderEvidenceStep = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Add Evidence (Optional)</Text>
      <Text style={styles.stepDescription}>
        Supporting evidence strengthens your dispute. You can add more later.
      </Text>

      {/* Text evidence */}
      <Text style={styles.inputLabel}>Written Statement</Text>
      <View style={styles.evidenceInputRow}>
        <TextInput
          style={[styles.textInput, { flex: 1 }]}
          placeholder="Type a statement..."
          placeholderTextColor="rgba(255,254,245,0.4)"
          value={textEvidence}
          onChangeText={setTextEvidence}
        />
        <TouchableOpacity
          style={[styles.addButton, !textEvidence.trim() && styles.addButtonDisabled]}
          onPress={handleAddTextEvidence}
          disabled={!textEvidence.trim()}
        >
          <MaterialIcons name="add" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Link evidence */}
      <Text style={styles.inputLabel}>Link / URL</Text>
      <View style={styles.evidenceInputRow}>
        <TextInput
          style={[styles.textInput, { flex: 1 }]}
          placeholder="https://..."
          placeholderTextColor="rgba(255,254,245,0.4)"
          value={linkEvidence}
          onChangeText={setLinkEvidence}
          autoCapitalize="none"
          keyboardType="url"
        />
        <TouchableOpacity
          style={[styles.addButton, !linkEvidence.trim() && styles.addButtonDisabled]}
          onPress={handleAddLinkEvidence}
          disabled={!linkEvidence.trim()}
        >
          <MaterialIcons name="add" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* File upload */}
      <TouchableOpacity
        style={styles.uploadButton}
        onPress={() => pickAttachment()}
      >
        <MaterialIcons name="attach-file" size={20} color="#fff" />
        <Text style={styles.uploadButtonText}>Upload Image or Document</Text>
      </TouchableOpacity>

      {/* Evidence list */}
      {evidenceItems.length > 0 && (
        <View style={styles.evidenceList}>
          <Text style={styles.evidenceCount}>{evidenceItems.length} item(s) attached</Text>
          {evidenceItems.map((item) => (
            <View key={item.id} style={styles.evidenceItem}>
              <MaterialIcons
                name={
                  item.type === 'text' ? 'text-snippet' :
                  item.type === 'link' ? 'link' :
                  item.type === 'image' ? 'image' : 'insert-drive-file'
                }
                size={20}
                color="#6ee7b7"
              />
              <Text style={styles.evidenceItemText} numberOfLines={1}>
                {item.type === 'text' ? item.content.substring(0, 60) + '...' :
                 item.type === 'link' ? item.content :
                 item.description || 'File attached'}
              </Text>
              <TouchableOpacity onPress={() => handleRemoveEvidence(item.id)}>
                <MaterialIcons name="close" size={18} color="#ef4444" />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
    </View>
  )

  const renderConfirmStep = () => (
    <View style={styles.stepContent}>
      <View style={styles.iconContainer}>
        <MaterialIcons name="warning" size={48} color="#f59e0b" />
      </View>
      <Text style={styles.stepTitle}>Confirm Dispute Submission</Text>

      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>Bounty</Text>
        <Text style={styles.summaryValue} numberOfLines={2}>{bountyTitle}</Text>

        <Text style={styles.summaryLabel}>Stage</Text>
        <Text style={styles.summaryValue}>{stageLabel}</Text>

        <Text style={styles.summaryLabel}>Reason</Text>
        <Text style={styles.summaryValue}>{fullReason}</Text>

        <Text style={styles.summaryLabel}>Evidence</Text>
        <Text style={styles.summaryValue}>
          {evidenceItems.length === 0 ? 'None (you can add more later)' : `${evidenceItems.length} item(s)`}
        </Text>
      </View>

      <View style={styles.warningBox}>
        <MaterialIcons name="warning" size={20} color="#f59e0b" />
        <Text style={styles.warningText}>
          Submitting a dispute will notify the other party and freeze the bounty for admin review. Both parties will be able to submit evidence and communicate within the dispute.
        </Text>
      </View>
    </View>
  )

  const renderStep = () => {
    switch (currentStep) {
      case 'info': return renderInfoStep()
      case 'reason': return renderReasonStep()
      case 'evidence': return renderEvidenceStep()
      case 'confirm': return renderConfirmStep()
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={[styles.container, { paddingTop: insets.top }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
            <MaterialIcons name="close" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Raise Dispute</Text>
          <View style={styles.stepIndicator}>
            <Text style={styles.stepIndicatorText}>
              {currentStepIndex + 1}/{STEPS.length}
            </Text>
          </View>
        </View>

        {/* Progress bar */}
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${((currentStepIndex + 1) / STEPS.length) * 100}%` }]} />
        </View>

        {/* Content */}
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {renderStep()}
        </ScrollView>

        {/* Footer buttons */}
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          {currentStepIndex > 0 && (
            <TouchableOpacity style={styles.backBtn} onPress={goBack}>
              <MaterialIcons name="arrow-back" size={20} color="#6ee7b7" />
              <Text style={styles.backBtnText}>Back</Text>
            </TouchableOpacity>
          )}

          <View style={{ flex: 1 }} />

          {currentStep === 'confirm' ? (
            <TouchableOpacity
              style={[styles.submitBtn, isSubmitting && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <MaterialIcons name="gavel" size={20} color="#fff" />
                  <Text style={styles.submitBtnText}>Submit Dispute</Text>
                </>
              )}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[
                styles.nextBtn,
                currentStep === 'reason' && !canProceedFromReason && styles.nextBtnDisabled,
              ]}
              onPress={goNext}
              disabled={currentStep === 'reason' && !canProceedFromReason}
            >
              <Text style={styles.nextBtnText}>
                {currentStep === 'evidence' ? 'Review' : 'Continue'}
              </Text>
              <MaterialIcons name="arrow-forward" size={20} color="#fff" />
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a3d2e',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(110, 231, 183, 0.1)',
  },
  closeButton: {
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  stepIndicator: {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  stepIndicatorText: {
    color: '#f59e0b',
    fontSize: 12,
    fontWeight: '600',
  },
  progressBar: {
    height: 3,
    backgroundColor: 'rgba(110, 231, 183, 0.1)',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#f59e0b',
    borderRadius: 2,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
  },
  stepContent: {
    gap: 16,
  },
  iconContainer: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  stepTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  stepDescription: {
    color: 'rgba(255,254,245,0.7)',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  bountyCard: {
    backgroundColor: 'rgba(5, 150, 105, 0.2)',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.3)',
  },
  bountyTitleText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  infoBox: {
    backgroundColor: 'rgba(5, 150, 105, 0.15)',
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  infoText: {
    flex: 1,
    color: 'rgba(255,254,245,0.8)',
    fontSize: 13,
    lineHeight: 18,
  },
  warningBox: {
    flexDirection: 'row',
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderRadius: 12,
    padding: 14,
    gap: 12,
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  warningText: {
    flex: 1,
    color: '#fbbf24',
    fontSize: 12,
    lineHeight: 18,
  },
  reasonsList: {
    gap: 8,
  },
  reasonOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(5, 150, 105, 0.1)',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  reasonOptionSelected: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderColor: '#10b981',
  },
  reasonOptionText: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
  },
  inputLabel: {
    color: '#6ee7b7',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 4,
  },
  textArea: {
    backgroundColor: 'rgba(5, 150, 105, 0.2)',
    borderRadius: 12,
    padding: 14,
    color: '#fff',
    fontSize: 14,
    minHeight: 100,
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.2)',
  },
  charCount: {
    color: 'rgba(255,254,245,0.4)',
    fontSize: 11,
    textAlign: 'right',
  },
  charCountValid: {
    color: '#10b981',
  },
  evidenceInputRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  textInput: {
    backgroundColor: 'rgba(5, 150, 105, 0.2)',
    borderRadius: 10,
    padding: 12,
    color: '#fff',
    fontSize: 14,
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.2)',
  },
  addButton: {
    backgroundColor: '#10b981',
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButtonDisabled: {
    backgroundColor: 'rgba(16, 185, 129, 0.3)',
  },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(5, 150, 105, 0.3)',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.3)',
    borderStyle: 'dashed',
  },
  uploadButtonText: {
    color: '#6ee7b7',
    fontSize: 14,
    fontWeight: '500',
  },
  evidenceList: {
    gap: 8,
    marginTop: 4,
  },
  evidenceCount: {
    color: '#6ee7b7',
    fontSize: 12,
    fontWeight: '600',
  },
  evidenceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(5, 150, 105, 0.2)',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.15)',
  },
  evidenceItemText: {
    flex: 1,
    color: 'rgba(255,254,245,0.8)',
    fontSize: 13,
  },
  summaryCard: {
    backgroundColor: 'rgba(5, 150, 105, 0.2)',
    borderRadius: 12,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.3)',
  },
  summaryLabel: {
    color: '#6ee7b7',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 4,
  },
  summaryValue: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 20,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(110, 231, 183, 0.1)',
    backgroundColor: '#1a3d2e',
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  backBtnText: {
    color: '#6ee7b7',
    fontSize: 14,
    fontWeight: '500',
  },
  nextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#10b981',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
  },
  nextBtnDisabled: {
    backgroundColor: 'rgba(16, 185, 129, 0.3)',
  },
  nextBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#f59e0b',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
  },
  submitBtnDisabled: {
    backgroundColor: 'rgba(245, 158, 11, 0.4)',
  },
  submitBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
})
