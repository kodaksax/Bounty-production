import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Alert,
  Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import type { DisputeEvidence } from '../lib/types';

interface DisputeSubmissionFormProps {
  bountyTitle: string;
  onSubmit: (reason: string, evidence: DisputeEvidence[]) => Promise<void>;
  onCancel?: () => void;
  isSubmitting?: boolean;
  initialReason?: string;
  initialEvidence?: DisputeEvidence[];
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
  const [reason, setReason] = useState(initialReason);
  const [evidence, setEvidence] = useState<DisputeEvidence[]>(initialEvidence);
  const [textEvidence, setTextEvidence] = useState('');

  const handleAddTextEvidence = () => {
    if (!textEvidence.trim()) {
      Alert.alert('Error', 'Please enter evidence details');
      return;
    }

    const newEvidence: DisputeEvidence = {
      id: Date.now().toString(),
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
        const newEvidence: DisputeEvidence = {
          id: Date.now().toString(),
          type: 'image',
          content: result.assets[0].uri,
          description: 'Image evidence',
          uploadedAt: new Date().toISOString(),
        };
        setEvidence([...evidence, newEvidence]);
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Error', 'Failed to pick image');
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
        const newEvidence: DisputeEvidence = {
          id: Date.now().toString(),
          type: 'document',
          content: asset.uri,
          description: asset.name || 'Document evidence',
          uploadedAt: new Date().toISOString(),
        };
        setEvidence([...evidence, newEvidence]);
      }
    } catch (error) {
      console.error('Error picking document:', error);
      Alert.alert('Error', 'Failed to pick document');
    }
  };

  const handleRemoveEvidence = (id: string) => {
    setEvidence(evidence.filter(e => e.id !== id));
  };

  const handleSubmit = async () => {
    if (!reason.trim()) {
      Alert.alert('Error', 'Please provide a reason for the dispute');
      return;
    }

    try {
      await onSubmit(reason, evidence);
    } catch (error) {
      console.error('Error submitting dispute:', error);
      Alert.alert('Error', 'Failed to submit dispute');
    }
  };

  return (
    <ScrollView className="flex-1">
      {/* Bounty Info */}
      <View className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 mb-6">
        <Text className="text-sm text-emerald-600 font-medium mb-1">Bounty</Text>
        <Text className="text-base text-emerald-900 font-semibold" numberOfLines={2}>
          {bountyTitle}
        </Text>
      </View>

      {/* Guidance */}
      {showGuidance && (
        <View className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <View className="flex-row items-start">
            <MaterialIcons name="info-outline" size={20} color="#3b82f6" />
            <View className="flex-1 ml-3">
              <Text className="text-blue-900 font-semibold mb-1">
                Dispute Process
              </Text>
              <Text className="text-blue-800 text-sm mb-2">
                Disputes are reviewed by our team within 24-48 hours. Please provide:
              </Text>
              <Text className="text-blue-800 text-sm">
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
        <Text className="text-base font-semibold text-gray-900 mb-2">
          Reason for Dispute *
        </Text>
        <Text className="text-sm text-gray-600 mb-3">
          Clearly explain why you believe this dispute should be reviewed.
        </Text>
        <TextInput
          value={reason}
          onChangeText={setReason}
          placeholder="Describe the issue in detail..."
          multiline
          numberOfLines={6}
          textAlignVertical="top"
          className="border border-gray-300 rounded-lg p-3 text-base text-gray-900 bg-white"
          style={{ minHeight: 120 }}
          editable={!isSubmitting}
        />
      </View>

      {/* Evidence Section */}
      <View className="mb-6">
        <Text className="text-base font-semibold text-gray-900 mb-2">
          Supporting Evidence
        </Text>
        <Text className="text-sm text-gray-600 mb-3">
          Add evidence to support your dispute (optional but recommended)
        </Text>

        {/* Evidence List */}
        {evidence.length > 0 && (
          <View className="mb-4">
            {evidence.map((item, index) => (
              <View
                key={item.id}
                className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-2 flex-row items-center"
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
                      color="#059669"
                    />
                    <Text className="text-xs text-gray-500 ml-2 uppercase">
                      {item.type}
                    </Text>
                  </View>
                  <Text className="text-sm text-gray-900" numberOfLines={2}>
                    {item.description || item.content}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => handleRemoveEvidence(item.id)}
                  disabled={isSubmitting}
                  className="ml-2 p-2"
                >
                  <MaterialIcons name="close" size={20} color="#dc2626" />
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
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            className="border border-gray-300 rounded-lg p-3 text-sm text-gray-900 bg-white mb-2"
            style={{ minHeight: 80 }}
            editable={!isSubmitting}
          />
          <TouchableOpacity
            onPress={handleAddTextEvidence}
            disabled={isSubmitting || !textEvidence.trim()}
            className={`rounded-lg py-2 px-4 flex-row items-center justify-center ${
              isSubmitting || !textEvidence.trim() ? 'bg-gray-300' : 'bg-emerald-600'
            }`}
          >
            <MaterialIcons
              name="add"
              size={18}
              color={isSubmitting || !textEvidence.trim() ? '#9ca3af' : 'white'}
            />
            <Text
              className={`ml-2 font-medium ${
                isSubmitting || !textEvidence.trim() ? 'text-gray-500' : 'text-white'
              }`}
            >
              Add Text Evidence
            </Text>
          </TouchableOpacity>
        </View>

        {/* Upload Buttons */}
        <View className="flex-row gap-2">
          <TouchableOpacity
            onPress={handlePickImage}
            disabled={isSubmitting}
            className={`flex-1 rounded-lg py-3 px-4 flex-row items-center justify-center border-2 ${
              isSubmitting ? 'border-gray-300 bg-gray-100' : 'border-emerald-600 bg-white'
            }`}
          >
            <MaterialIcons
              name="photo-library"
              size={18}
              color={isSubmitting ? '#9ca3af' : '#059669'}
            />
            <Text
              className={`ml-2 font-medium ${
                isSubmitting ? 'text-gray-500' : 'text-emerald-700'
              }`}
            >
              Image
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handlePickDocument}
            disabled={isSubmitting}
            className={`flex-1 rounded-lg py-3 px-4 flex-row items-center justify-center border-2 ${
              isSubmitting ? 'border-gray-300 bg-gray-100' : 'border-emerald-600 bg-white'
            }`}
          >
            <MaterialIcons
              name="attach-file"
              size={18}
              color={isSubmitting ? '#9ca3af' : '#059669'}
            />
            <Text
              className={`ml-2 font-medium ${
                isSubmitting ? 'text-gray-500' : 'text-emerald-700'
              }`}
            >
              Document
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Action Buttons */}
      <View className="gap-3 pb-6">
        <TouchableOpacity
          onPress={handleSubmit}
          disabled={isSubmitting || !reason.trim()}
          className={`rounded-lg py-4 ${
            isSubmitting || !reason.trim() ? 'bg-gray-300' : 'bg-emerald-600'
          }`}
        >
          {isSubmitting ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text className="text-white text-center font-semibold text-base">
              Submit Dispute
            </Text>
          )}
        </TouchableOpacity>

        {onCancel && (
          <TouchableOpacity
            onPress={onCancel}
            disabled={isSubmitting}
            className="py-3"
          >
            <Text className="text-gray-600 text-center font-medium">
              Cancel
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </ScrollView>
  );
}
