import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import type { LocalDisputeEvidence } from '../lib/types';
import { generateEvidenceId } from '../lib/utils/dispute-helpers';
import { KeyboardAwareScrollView } from './ui/keyboard-avoiding';
import { withAlpha } from '../lib/utils';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';

interface DisputeSubmissionFormProps {
  bountyTitle: string;
  onSubmit: (reason: string, evidence: LocalDisputeEvidence[]) => Promise<void>;
  onCancel?: () => void;
  isSubmitting?: boolean;
  initialReason?: string;
  initialEvidence?: LocalDisputeEvidence[];
  showGuidance?: boolean;
}

export function DisputeSubmissionForm({
  bountyTitle,
  onSubmit,
  onCancel,
  isSubmitting = false,
  initialReason = '',
  initialEvidence = [],
  showGuidance = true,
}: DisputeSubmissionFormProps) {
  const { theme } = useAppThemeContext();
  const [reason, setReason] = useState(initialReason);
  const [evidence, setEvidence] = useState<LocalDisputeEvidence[]>(initialEvidence);
  const [textEvidence, setTextEvidence] = useState('');

  const handleAddTextEvidence = () => {
    if (!textEvidence.trim()) {
      Alert.alert("Something went wrong", 'Please enter evidence details');
      return;
    }

    const newEvidence: LocalDisputeEvidence = {
      id: generateEvidenceId(),
      type: 'text',
      content: textEvidence.trim(),
      uploadedAt: new Date().toISOString(),
    };

    setEvidence([...evidence, newEvidence]);
    setTextEvidence('');
  };

  const handlePickImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please allow access to your photo library');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        const newEvidence: LocalDisputeEvidence = {
          id: generateEvidenceId(),
          type: 'image',
          content: result.assets[0].uri,
          description: 'Image evidence',
          uploadedAt: new Date().toISOString(),
        };
        setEvidence([...evidence, newEvidence]);
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert("Couldn't pick image", "Please try again.");
    }
  };

  const handlePickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });

      if (result.canceled === false && result.assets && result.assets[0]) {
        const asset = result.assets[0];
        const newEvidence: LocalDisputeEvidence = {
          id: generateEvidenceId(),
          type: 'document',
          content: asset.uri,
          description: asset.name || 'Document evidence',
          uploadedAt: new Date().toISOString(),
        };
        setEvidence([...evidence, newEvidence]);
      }
    } catch (error) {
      console.error('Error picking document:', error);
      Alert.alert("Couldn't pick document", "Please try again.");
    }
  };

  const handleRemoveEvidence = (id: string) => {
    setEvidence(evidence.filter(e => e.id !== id));
  };

  const handleSubmit = async () => {
    if (!reason.trim()) {
      Alert.alert("Something went wrong", 'Please provide a reason for the dispute');
      return;
    }

    try {
      await onSubmit(reason, evidence);
    } catch (error) {
      console.error('Error submitting dispute:', error);
      Alert.alert("Couldn't submit dispute", "Please try again.");
    }
  };

  return (
    <KeyboardAwareScrollView className="flex-1">
      {/* Bounty Info */}
      <View className="border rounded-lg p-4 mb-6" style={{ backgroundColor: theme.successTint, borderColor: withAlpha(theme.success, 0.4) }}>
        <Text className="text-sm font-medium mb-1" style={{ color: theme.successText }}>Bounty</Text>
        <Text className="text-base font-semibold" numberOfLines={2} style={{ color: theme.text }}>
          {bountyTitle}
        </Text>
      </View>

      {/* Guidance */}
      {showGuidance && (
        <View className="border rounded-lg p-4 mb-6" style={{ backgroundColor: theme.infoTint, borderColor: withAlpha(theme.info, 0.4) }}>
          <View className="flex-row items-start">
            <MaterialIcons name="info-outline" size={20} color={theme.infoText} />
            <View className="flex-1 ml-3">
              <Text className="font-semibold mb-1" style={{ color: theme.infoText }}>
                Dispute Process
              </Text>
              <Text className="text-sm mb-2" style={{ color: theme.infoText }}>
                Disputes are reviewed by our team within 24-48 hours. Please provide:
              </Text>
              <Text className="text-sm" style={{ color: theme.infoText }}>
                • Clear explanation of the issue{'\n'}
                • Supporting evidence (messages, screenshots, etc.){'\n'}
                • Expected resolution
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Reason Input */}
      <View className="mb-6">
        <Text className="text-base font-semibold mb-2" style={{ color: theme.text }}>
          Reason for dispute *
        </Text>
        <Text className="text-sm mb-3" style={{ color: theme.textSecondary }}>
          Clearly explain why you believe this dispute should be reviewed.
        </Text>
        <TextInput
          value={reason}
          onChangeText={setReason}
          placeholder="Describe the issue in detail..."
          placeholderTextColor={theme.textSecondary}
          multiline
          numberOfLines={6}
          textAlignVertical="top"
          className="border rounded-lg p-3 text-base"
          style={{ color: theme.text, backgroundColor: theme.surface, borderColor: theme.border, minHeight: 120 }}
          editable={!isSubmitting}
        />
      </View>

      {/* Evidence Section */}
      <View className="mb-6">
        <Text className="text-base font-semibold mb-2" style={{ color: theme.text }}>
          Supporting Evidence
        </Text>
        <Text className="text-sm mb-3" style={{ color: theme.textSecondary }}>
          Add evidence to support your dispute (optional but recommended)
        </Text>

        {/* Evidence List */}
        {evidence.length > 0 && (
          <View className="mb-4">
            {evidence.map((item, index) => (
              <View
                key={item.id}
                className="border rounded-lg p-3 mb-2 flex-row items-center"
                style={{ backgroundColor: theme.surface, borderColor: theme.border }}
              >
                <View className="flex-1">
                  <View className="flex-row items-center mb-1">
                    <MaterialIcons
                      name={
                        item.type === 'image'
                          ? 'image'
                          : item.type === 'document'
                          ? 'description'
                          : item.type === 'link'
                          ? 'link'
                          : 'text-fields'
                      }
                      size={16}
                      color={theme.primaryLight}
                    />
                    <Text className="text-xs ml-2 uppercase" style={{ color: theme.textSecondary }}>
                      {item.type}
                    </Text>
                  </View>
                  <Text className="text-sm" numberOfLines={2} style={{ color: theme.text }}>
                    {item.description || item.content}
                  </Text>
                </View>
                <TouchableOpacity accessibilityLabel="Close" accessibilityRole="button"
                  onPress={() => handleRemoveEvidence(item.id)}
                  disabled={isSubmitting}
                  className="ml-2 p-2"
                >
                  <MaterialIcons name="close" size={20} color={theme.errorText} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* Text Evidence Input */}
        <View className="mb-3">
          <TextInput
            value={textEvidence}
            onChangeText={setTextEvidence}
            placeholder="Describe evidence or add details..."
            placeholderTextColor={theme.textSecondary}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            className="border rounded-lg p-3 text-sm mb-2"
            style={{ color: theme.text, backgroundColor: theme.surface, borderColor: theme.border, minHeight: 80 }}
            editable={!isSubmitting}
          />
          <TouchableOpacity accessibilityRole="button"
            onPress={handleAddTextEvidence}
            disabled={isSubmitting || !textEvidence.trim()}
            className="rounded-lg py-2 px-4 flex-row items-center justify-center"
            style={{ backgroundColor: isSubmitting || !textEvidence.trim() ? theme.surfaceSecondary : theme.primary }}
          >
            <MaterialIcons
              name="add"
              size={18}
              color={isSubmitting || !textEvidence.trim() ? theme.textSecondary : theme.onPrimary}
            />
            <Text
              className="ml-2 font-medium"
              style={{ color: isSubmitting || !textEvidence.trim() ? theme.textSecondary : theme.onPrimary }}
            >
              Add Text Evidence
            </Text>
          </TouchableOpacity>
        </View>

        {/* Upload Buttons */}
        <View className="flex-row gap-2">
          <TouchableOpacity accessibilityRole="button"
            onPress={handlePickImage}
            disabled={isSubmitting}
            className="flex-1 rounded-lg py-3 px-4 flex-row items-center justify-center border-2"
            style={{
              backgroundColor: isSubmitting ? theme.surfaceSecondary : theme.surface,
              borderColor: isSubmitting ? theme.border : theme.primary,
            }}
          >
            <MaterialIcons
              name="photo-library"
              size={18}
              color={isSubmitting ? theme.textSecondary : theme.primaryLight}
            />
            <Text
              className="ml-2 font-medium"
              style={{ color: isSubmitting ? theme.textSecondary : theme.primaryLight }}
            >
              Image
            </Text>
          </TouchableOpacity>

          <TouchableOpacity accessibilityRole="button"
            onPress={handlePickDocument}
            disabled={isSubmitting}
            className="flex-1 rounded-lg py-3 px-4 flex-row items-center justify-center border-2"
            style={{
              backgroundColor: isSubmitting ? theme.surfaceSecondary : theme.surface,
              borderColor: isSubmitting ? theme.border : theme.primary,
            }}
          >
            <MaterialIcons
              name="attach-file"
              size={18}
              color={isSubmitting ? theme.textSecondary : theme.primaryLight}
            />
            <Text
              className="ml-2 font-medium"
              style={{ color: isSubmitting ? theme.textSecondary : theme.primaryLight }}
            >
              Document
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Action Buttons */}
      <View className="gap-3 pb-6">
        <TouchableOpacity accessibilityRole="button"
          onPress={handleSubmit}
          disabled={isSubmitting || !reason.trim()}
          className="rounded-lg py-4"
          style={{ backgroundColor: isSubmitting || !reason.trim() ? theme.surfaceSecondary : theme.primary }}
        >
          {isSubmitting ? (
            <ActivityIndicator color={theme.textSecondary} />
          ) : (
            <Text className="text-center font-semibold text-base" style={{ color: !reason.trim() ? theme.textSecondary : theme.onPrimary }}>
              Submit Dispute
            </Text>
          )}
        </TouchableOpacity>

        {onCancel && (
          <TouchableOpacity accessibilityRole="button"
            onPress={onCancel}
            disabled={isSubmitting}
            className="py-3"
          >
            <Text className="text-center font-medium" style={{ color: theme.textSecondary }}>
              Cancel
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAwareScrollView>
  );
}
