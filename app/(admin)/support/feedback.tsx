// app/(admin)/support/feedback.tsx - Admin Feedback Form
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { AdminHeader } from '../../../components/admin/AdminHeader';

type FeedbackType = 'bug' | 'feature' | 'improvement' | 'other';
type Priority = 'low' | 'medium' | 'high' | 'critical';

interface FeedbackOption {
  id: FeedbackType | Priority;
  label: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  color?: string;
}

const feedbackTypes: FeedbackOption[] = [
  { id: 'bug', label: 'Bug Report', icon: 'bug-report', color: '#f44336' },
  { id: 'feature', label: 'Feature Request', icon: 'lightbulb', color: '#2196F3' },
  { id: 'improvement', label: 'Improvement', icon: 'trending-up', color: '#4caf50' },
  { id: 'other', label: 'Other', icon: 'help', color: '#9e9e9e' },
];

const priorities: FeedbackOption[] = [
  { id: 'low', label: 'Low', icon: 'arrow-downward', color: '#9e9e9e' },
  { id: 'medium', label: 'Medium', icon: 'remove', color: '#ffc107' },
  { id: 'high', label: 'High', icon: 'arrow-upward', color: '#ff9800' },
  { id: 'critical', label: 'Critical', icon: 'priority-high', color: '#f44336' },
];

export default function AdminFeedbackScreen() {
  const router = useRouter();
  const [type, setType] = useState<FeedbackType>('bug');
  const [priority, setPriority] = useState<Priority>('medium');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [stepsToReproduce, setStepsToReproduce] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!title.trim()) {
      Alert.alert('Error', 'Please enter a title for your feedback.');
      return;
    }
    if (!description.trim()) {
      Alert.alert('Error', 'Please provide a description.');
      return;
    }

    setIsSubmitting(true);
    
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    setIsSubmitting(false);
    Alert.alert(
      'Feedback Submitted',
      'Thank you for your feedback! Our team will review it shortly.',
      [
        {
          text: 'OK',
          onPress: () => router.back(),
        },
      ]
    );
  };

  const selectedType = feedbackTypes.find(t => t.id === type);

  return (
    <View style={styles.container}>
      <AdminHeader title="Send Feedback" onBack={() => router.back()} />
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView 
          style={styles.scrollView} 
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {/* Feedback Type */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Type of Feedback</Text>
            <View style={styles.typeGrid}>
              {feedbackTypes.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={[
                    styles.typeCard,
                    type === item.id && styles.typeCardActive,
                    type === item.id && { borderColor: item.color },
                  ]}
                  onPress={() => setType(item.id as FeedbackType)}
                >
                  <MaterialIcons 
                    name={item.icon} 
                    size={24} 
                    color={type === item.id ? item.color : 'rgba(255,254,245,0.6)'} 
                  />
                  <Text 
                    style={[
                      styles.typeLabel,
                      type === item.id && { color: item.color },
                    ]}
                  >
                    {item.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Priority */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Priority</Text>
            <View style={styles.priorityRow}>
              {priorities.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={[
                    styles.priorityChip,
                    priority === item.id && styles.priorityChipActive,
                    priority === item.id && { backgroundColor: item.color + '30', borderColor: item.color },
                  ]}
                  onPress={() => setPriority(item.id as Priority)}
                >
                  <MaterialIcons 
                    name={item.icon} 
                    size={16} 
                    color={priority === item.id ? item.color : 'rgba(255,254,245,0.5)'} 
                  />
                  <Text 
                    style={[
                      styles.priorityLabel,
                      priority === item.id && { color: item.color },
                    ]}
                  >
                    {item.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Title */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Title *</Text>
            <TextInput
              style={styles.textInput}
              placeholder="Brief summary of your feedback"
              placeholderTextColor="rgba(255,254,245,0.4)"
              value={title}
              onChangeText={setTitle}
              maxLength={100}
            />
            <Text style={styles.charCount}>{title.length}/100</Text>
          </View>

          {/* Description */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Description *</Text>
            <TextInput
              style={[styles.textInput, styles.textArea]}
              placeholder="Provide detailed information about your feedback..."
              placeholderTextColor="rgba(255,254,245,0.4)"
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={5}
              textAlignVertical="top"
            />
          </View>

          {/* Steps to Reproduce (for bugs) */}
          {type === 'bug' && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Steps to Reproduce</Text>
              <TextInput
                style={[styles.textInput, styles.textArea]}
                placeholder="1. Go to...&#10;2. Click on...&#10;3. Observe that..."
                placeholderTextColor="rgba(255,254,245,0.4)"
                value={stepsToReproduce}
                onChangeText={setStepsToReproduce}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
            </View>
          )}

          {/* Info Box */}
          <View style={styles.infoBox}>
            <MaterialIcons name="info-outline" size={20} color="#00dc50" />
            <Text style={styles.infoText}>
              Your feedback will be reviewed by the development team. You may be contacted 
              for additional information if needed.
            </Text>
          </View>

          {/* Submit Button */}
          <TouchableOpacity 
            style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <Text style={styles.submitButtonText}>Submitting...</Text>
            ) : (
              <>
                <MaterialIcons name="send" size={20} color="#fffef5" />
                <Text style={styles.submitButtonText}>Submit Feedback</Text>
              </>
            )}
          </TouchableOpacity>

          {/* Bottom padding */}
          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a3d2e',
  },
  keyboardView: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255,254,245,0.6)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  typeCard: {
    width: '48%',
    backgroundColor: '#2d5240',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    gap: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  typeCardActive: {
    backgroundColor: 'rgba(45,82,64,0.8)',
  },
  typeLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(255,254,245,0.7)',
  },
  priorityRow: {
    flexDirection: 'row',
    gap: 8,
  },
  priorityChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2d5240',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 6,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  priorityChipActive: {
    borderWidth: 1,
  },
  priorityLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,254,245,0.6)',
  },
  textInput: {
    backgroundColor: '#2d5240',
    borderRadius: 12,
    padding: 16,
    fontSize: 15,
    color: '#fffef5',
    borderWidth: 1,
    borderColor: 'rgba(0,145,44,0.2)',
  },
  textArea: {
    minHeight: 120,
    paddingTop: 16,
  },
  charCount: {
    fontSize: 12,
    color: 'rgba(255,254,245,0.4)',
    textAlign: 'right',
    marginTop: 4,
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0,220,80,0.1)',
    borderRadius: 12,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,220,80,0.2)',
    marginBottom: 24,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: 'rgba(255,254,245,0.7)',
    lineHeight: 18,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#00912C',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fffef5',
  },
});
