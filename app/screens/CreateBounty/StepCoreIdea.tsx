import { MaterialIcons } from '@expo/vector-icons';
import { ValidationMessage } from 'app/components/ValidationMessage';
import type { BountyDraft } from 'app/hooks/useBountyDraft';
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface StepCoreIdeaProps {
  draft: BountyDraft;
  onUpdate: (data: Partial<BountyDraft>) => void;
  onNext: () => void;
  onBack?: () => void;
}

export function StepCoreIdea({ draft, onUpdate, onNext, onBack }: StepCoreIdeaProps) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const insets = useSafeAreaInsets();
  const BOTTOM_NAV_OFFSET = 60;

  const validateTitle = (value: string): string | null => {
    if (!value || value.trim().length === 0) {
      return 'Title is required';
    }
    if (value.length < 5) {
      return 'Title must be at least 5 characters';
    }
    if (value.length > 120) {
      return 'Title must not exceed 120 characters';
    }
    return null;
  };

  const validateDescription = (value: string): string | null => {
    if (!value || value.trim().length === 0) {
      return 'Description is required';
    }
    if (value.length < 20) {
      return 'Description must be at least 20 characters';
    }
    return null;
  };

  const handleTitleChange = (value: string) => {
    onUpdate({ title: value });
    if (touched.title) {
      const error = validateTitle(value);
      setErrors({ ...errors, title: error || '' });
    }
  };

  const handleTitleBlur = () => {
    setTouched({ ...touched, title: true });
    const error = validateTitle(draft.title);
    setErrors({ ...errors, title: error || '' });
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
    const titleError = validateTitle(draft.title);
    const descriptionError = validateDescription(draft.description);
    
    if (titleError || descriptionError) {
      setErrors({ 
        title: titleError || '', 
        description: descriptionError || '' 
      });
      setTouched({ title: true, description: true });
      return;
    }

    onNext();
  };

  const isValid = !validateTitle(draft.title) && !validateDescription(draft.description);

  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollTo?.({ y: 0, animated: false }), 50);
    return () => clearTimeout(t);
  }, []);

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
        {/* Title Input */}
        <View className="mb-6">
          <Text className="text-emerald-100 text-base font-semibold mb-2">
            What do you need help with? *
          </Text>
          <TextInput
            value={draft.title}
            onChangeText={handleTitleChange}
            onBlur={handleTitleBlur}
            placeholder="e.g., Help moving furniture, Logo design, Website fixes..."
            placeholderTextColor="rgba(110, 231, 183, 0.4)"
            className="bg-emerald-700/50 text-white px-4 py-3 rounded-lg text-base"
            accessibilityLabel="Bounty title input"
            maxLength={120}
          />
          <Text className="text-emerald-200/60 text-xs mt-1">
            {draft.title.length}/120 characters
          </Text>
          {touched.title && errors.title && (
            <ValidationMessage message={errors.title} />
          )}
        </View>

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

        {/* Info Banner */}
        <View className="mb-6 bg-emerald-700/20 rounded-lg p-4 border border-emerald-500/30">
          <View className="flex-row items-start">
            <MaterialIcons
              name="lightbulb-outline"
              size={20}
              color="rgba(110, 231, 183, 0.8)"
              style={{ marginRight: 8, marginTop: 2 }}
            />
            <View className="flex-1">
              <Text className="text-emerald-100 font-semibold mb-1">
                Quick Tip
              </Text>
              <Text className="text-emerald-200/70 text-sm">
                Be clear and specific about what you need. A good description helps attract the right people for your task.
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Navigation Buttons */}
      <View
        className="px-4 pb-4 pt-3 bg-emerald-600 border-t border-emerald-700/50"
        style={{ marginBottom: BOTTOM_NAV_OFFSET + Math.max(insets.bottom, 8) }}
      >
        <View className="flex-row gap-3">
          {onBack && (
            <TouchableOpacity
              onPress={onBack}
              className="flex-1 bg-emerald-700/50 py-3 rounded-lg flex-row items-center justify-center"
              accessibilityLabel="Go back"
              accessibilityRole="button"
            >
              <MaterialIcons name="arrow-back" size={20} color="#fff" />
              <Text className="text-white font-semibold ml-2">Back</Text>
            </TouchableOpacity>
          )}
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

export default StepCoreIdea;
