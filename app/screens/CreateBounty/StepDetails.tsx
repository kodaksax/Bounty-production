import { MaterialIcons } from '@expo/vector-icons';
import { ValidationMessage } from 'app/components/ValidationMessage';
import type { BountyDraft } from 'app/hooks/useBountyDraft';
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface StepDetailsProps {
  draft: BountyDraft;
  onUpdate: (data: Partial<BountyDraft>) => void;
  onNext: () => void;
  onBack: () => void;
}

export function StepDetails({ draft, onUpdate, onNext, onBack }: StepDetailsProps) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const insets = useSafeAreaInsets();
  const BOTTOM_NAV_OFFSET = 60;

  const validateDescription = (value: string): string | null => {
    if (!value || value.trim().length === 0) {
      return 'Description is required';
    }
    if (value.length < 20) {
      return 'Description must be at least 20 characters';
    }
    return null;
  };

  const handleDescriptionChange = (value: string) => {
    onUpdate({ description: value });
    if (touched.description) {
      const error = validateDescription(value);
      setErrors({ ...errors, description: error || '' });
    }
  };

  const handleDescriptionBlur = () => {
    setTouched({ ...touched, description: true });
    const error = validateDescription(draft.description);
    setErrors({ ...errors, description: error || '' });
  };

  const handleNext = () => {
    const descriptionError = validateDescription(draft.description);
    
    if (descriptionError) {
      setErrors({ description: descriptionError });
      setTouched({ description: true });
      return;
    }

    onNext();
  };

  const isValid = !validateDescription(draft.description);

  const scrollRef = useRef<any>(null)
  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollTo?.({ y: 0, animated: false }), 50)
    return () => clearTimeout(t)
  }, [])

  return (
    <View className="flex-1 bg-emerald-600">
      <ScrollView
        ref={scrollRef}
        className="flex-1 px-4 pt-2"
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled={true}
        removeClippedSubviews={false}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: BOTTOM_NAV_OFFSET + Math.max(insets.bottom, 12) + 16 }}
      >
        {/* Description Input */}
        <View className="mb-6">
          <Text className="text-emerald-100 text-base font-semibold mb-2">
            Describe what you need done *
          </Text>
          <TextInput
            value={draft.description}
            onChangeText={handleDescriptionChange}
            onBlur={handleDescriptionBlur}
            placeholder="Provide details about the task, requirements, expectations, etc."
            placeholderTextColor="rgba(110, 231, 183, 0.4)"
            className="bg-emerald-700/50 text-white px-4 py-3 rounded-lg text-base"
            multiline
            numberOfLines={6}
            textAlignVertical="top"
            style={{ minHeight: 120 }}
            accessibilityLabel="Bounty description input"
          />
          <Text className="text-emerald-200/60 text-xs mt-1">
            {draft.description.length} characters (min 20)
          </Text>
          {touched.description && errors.description && (
            <ValidationMessage message={errors.description} />
          )}
        </View>

        {/* Timeline Input (Optional) */}
        <View className="mb-6">
          <Text className="text-emerald-100 text-base font-semibold mb-2">
            Timeline (optional)
          </Text>
          <TextInput
            value={draft.timeline || ''}
            onChangeText={(value) => onUpdate({ timeline: value })}
            placeholder="e.g., Within 2 days, This weekend, ASAP..."
            placeholderTextColor="rgba(110, 231, 183, 0.4)"
            className="bg-emerald-700/50 text-white px-4 py-3 rounded-lg text-base"
            accessibilityLabel="Timeline input"
          />
        </View>

        {/* Skills Input (Optional) */}
        <View className="mb-6">
          <Text className="text-emerald-100 text-base font-semibold mb-2">
            Required skills (optional)
          </Text>
          <TextInput
            value={draft.skills || ''}
            onChangeText={(value) => onUpdate({ skills: value })}
            placeholder="e.g., Moving truck, Design tools, Programming..."
            placeholderTextColor="rgba(110, 231, 183, 0.4)"
            className="bg-emerald-700/50 text-white px-4 py-3 rounded-lg text-base"
            accessibilityLabel="Required skills input"
          />
        </View>

        {/* Attachments Placeholder */}
        <View className="mb-6">
          <Text className="text-emerald-100 text-base font-semibold mb-2">
            Attachments
          </Text>
          <TouchableOpacity
            className="bg-emerald-700/50 border-2 border-dashed border-emerald-500/50 rounded-lg py-6 flex items-center justify-center"
            accessibilityLabel="Add attachments"
            accessibilityRole="button"
          >
            <MaterialIcons name="cloud-upload" size={32} color="rgba(110, 231, 183, 0.6)" />
            <Text className="text-emerald-300/60 mt-2 text-sm">
              Add photos or documents (coming soon)
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Navigation Buttons */}
      <View
        className="px-4 pb-4 pt-3 bg-emerald-600 border-t border-emerald-700/50"
        style={{ marginBottom: BOTTOM_NAV_OFFSET + Math.max(insets.bottom, 8) }}
      >
        <View className="flex-row gap-3">
          <TouchableOpacity
            onPress={onBack}
            className="flex-1 bg-emerald-700/50 py-3 rounded-lg flex-row items-center justify-center"
            accessibilityLabel="Go back"
            accessibilityRole="button"
          >
            <MaterialIcons name="arrow-back" size={20} color="#fff" />
            <Text className="text-white font-semibold ml-2">Back</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleNext}
            disabled={!isValid}
            className={`flex-1 py-3 rounded-lg flex-row items-center justify-center ${
              isValid ? 'bg-emerald-500' : 'bg-emerald-700/30'
            }`}
            accessibilityLabel="Continue to next step"
            accessibilityRole="button"
            accessibilityState={{ disabled: !isValid }}
          >
            <Text
              className={`font-semibold mr-2 ${
                isValid ? 'text-white' : 'text-emerald-400/40'
              }`}
            >
              Next
            </Text>
            <MaterialIcons
              name="arrow-forward"
              size={20}
              color={isValid ? '#fff' : 'rgba(110, 231, 183, 0.4)'}
            />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
