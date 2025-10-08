import { MaterialIcons } from '@expo/vector-icons';
import { ValidationMessage } from 'app/components/ValidationMessage';
import type { BountyDraft } from 'app/hooks/useBountyDraft';
import React, { useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface StepTitleProps {
  draft: BountyDraft;
  onUpdate: (data: Partial<BountyDraft>) => void;
  onNext: () => void;
  onBack?: () => void;
}

const CATEGORIES = [
  { id: 'tech', label: 'Tech', icon: 'computer' as const },
  { id: 'design', label: 'Design', icon: 'palette' as const },
  { id: 'writing', label: 'Writing', icon: 'edit' as const },
  { id: 'labor', label: 'Labor', icon: 'build' as const },
  { id: 'delivery', label: 'Delivery', icon: 'local-shipping' as const },
  { id: 'other', label: 'Other', icon: 'more-horiz' as const },
];

export function StepTitle({ draft, onUpdate, onNext, onBack }: StepTitleProps) {
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

  const handleCategorySelect = (categoryId: string) => {
    onUpdate({ category: categoryId });
  };

  const handleNext = () => {
    const titleError = validateTitle(draft.title);
    
    if (titleError) {
      setErrors({ title: titleError });
      setTouched({ title: true });
      return;
    }

    onNext();
  };

  const isValid = !validateTitle(draft.title);

  return (
    <View className="flex-1 bg-emerald-600">
      <ScrollView
        className="flex-1 px-4 pt-2"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: BOTTOM_NAV_OFFSET + Math.max(insets.bottom, 12) + 16 }}
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

        {/* Category Selection */}
        <View className="mb-6">
          <Text className="text-emerald-100 text-base font-semibold mb-3">
            Category (optional)
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {CATEGORIES.map((category) => {
              const isSelected = draft.category === category.id;
              return (
                <TouchableOpacity
                  key={category.id}
                  onPress={() => handleCategorySelect(category.id)}
                  className={`flex-row items-center px-4 py-2 rounded-full ${
                    isSelected ? 'bg-emerald-400' : 'bg-emerald-700/50'
                  }`}
                  accessibilityLabel={`Select ${category.label} category`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                >
                  <MaterialIcons
                    name={category.icon}
                    size={18}
                    color={isSelected ? '#065f46' : '#fff'}
                  />
                  <Text
                    className={`ml-2 font-medium ${
                      isSelected ? 'text-emerald-900' : 'text-white'
                    }`}
                  >
                    {category.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
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
