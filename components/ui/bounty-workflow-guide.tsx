import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ChevronRight, ChevronDown, X } from 'lucide-react-native';

type WorkflowVariant = 'poster-postings' | 'poster-requests' | 'hunter-inprogress';

interface Step {
  title: string;
  description: string;
}

const WORKFLOW_STEPS: Record<WorkflowVariant, Step[]> = {
  'poster-postings': [
    { title: 'Expand Card', description: 'Tap the bounty card to expand and view details' },
    { title: 'Check Requests Tab', description: 'Review hunter applications in the Requests tab' },
    { title: 'Accept Hunter', description: 'Select a qualified hunter and accept their application' },
    { title: 'Review Submission', description: 'Wait for hunter to complete work and review their submission' },
    { title: 'Release Payment', description: 'Approve the work and release escrow payment to the hunter' },
  ],
  'poster-requests': [
    { title: 'Review Applicants', description: 'Check hunter profiles and past work history' },
    { title: 'Accept Application', description: 'Accept a qualified hunter to start the work' },
    { title: 'Escrow Lock', description: 'Funds are locked in escrow for security' },
    { title: 'Auto-Chat', description: 'Automatic chat channel opens for communication' },
    { title: 'Track in My Postings', description: 'Monitor progress in your My Postings dashboard' },
  ],
  'hunter-inprogress': [
    { title: 'Expand Card', description: 'Tap the bounty card to view full requirements' },
    { title: 'Chat with Poster', description: 'Use the chat feature to clarify requirements' },
    { title: 'Ready to Submit', description: 'Complete work and prepare your submission' },
    { title: 'Submit Work', description: 'Upload deliverables and mark as complete' },
    { title: 'Await Review', description: 'Wait for poster to review and approve payment' },
  ],
};

interface BountyWorkflowGuideProps {
  variant: WorkflowVariant;
  onDismiss: () => void;
}

export const BountyWorkflowGuide: React.FC<BountyWorkflowGuideProps> = ({
  variant,
  onDismiss,
}) => {
  const [expandedStep, setExpandedStep] = useState<number | null>(0);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const steps = WORKFLOW_STEPS[variant];

  if (isCollapsed) {
    return (
      <View style={styles.collapsedContainer}>
        <Text style={styles.collapsedText}>💡 Workflow Guide</Text>
        <TouchableOpacity onPress={() => setIsCollapsed(false)} style={styles.expandButton}>
          <ChevronDown size={20} color="#007AFF" />
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>📋 Workflow Guide</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => setIsCollapsed(true)} style={styles.actionButton}>
            <ChevronDown size={20} color="#666" />
          </TouchableOpacity>
          <TouchableOpacity onPress={onDismiss} style={styles.actionButton}>
            <X size={20} color="#666" />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.stepsContainer}>
        {steps.map((step, index) => (
          <View key={index} style={styles.stepContainer}>
            <TouchableOpacity
              style={styles.stepHeader}
              onPress={() => setExpandedStep(expandedStep === index ? null : index)}
            >
              <View style={styles.stepNumberContainer}>
                <Text style={styles.stepNumber}>{index + 1}</Text>
              </View>
              <View style={styles.stepTitleContainer}>
                <Text style={styles.stepTitle}>{step.title}</Text>
                <Text style={styles.stepDescription}>{step.description}</Text>
              </View>
              <ChevronRight
                size={20}
                color="#666"
                style={[styles.chevron, expandedStep === index && styles.chevronExpanded]}
              />
            </TouchableOpacity>

            {expandedStep === index && (
              <View style={styles.stepContent}>
                <Text style={styles.stepContentText}>
                  {step.description}
                </Text>
              </View>
            )}
          </View>
        ))}
      </View>

      <TouchableOpacity style={styles.dismissButton} onPress={onDismiss}>
        <Text style={styles.dismissButtonText}>Got it, thanks!</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    margin: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e5e5',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    padding: 4,
  },
  collapsedContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f0f9ff',
    borderRadius: 8,
    padding: 12,
    margin: 16,
  },
  collapsedText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#007AFF',
  },
  expandButton: {
    padding: 4,
  },
  stepsContainer: {
    gap: 8,
  },
  stepContainer: {
    borderWidth: 1,
    borderColor: '#e5e5e5',
    borderRadius: 8,
    overflow: 'hidden',
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#fafafa',
  },
  stepNumberContainer: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  stepNumber: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  stepTitleContainer: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 15,
    fontWeight: '500',
    color: '#1a1a1a',
    marginBottom: 2,
  },
  stepDescription: {
    fontSize: 13,
    color: '#666',
  },
  chevron: {
    transition: 'transform 0.2s',
  },
  chevronExpanded: {
    transform: [{ rotate: '90deg' }],
  },
  stepContent: {
    padding: 12,
    paddingTop: 0,
    backgroundColor: '#fff',
  },
  stepContentText: {
    fontSize: 14,
    color: '#444',
    lineHeight: 20,
  },
  dismissButton: {
    backgroundColor: '#007AFF',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  dismissButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default BountyWorkflowGuide;
