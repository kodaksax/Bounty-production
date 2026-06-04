import { MaterialIcons } from '@expo/vector-icons';
import { ValidationMessage } from 'app/components/ValidationMessage';
import type { BountyDraft } from 'app/hooks/useBountyDraft';
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppThemeContext } from '../../../lib/themes/AppThemeContext';
import { validateTitle } from '../../../lib/utils/bounty-validation';

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
  const { theme } = useAppThemeContext();

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

  const scrollRef = useRef<any>(null)

  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollTo?.({ y: 0, animated: false }), 50)
    return () => clearTimeout(t)
  }, [])

  return (
    <View className="flex-1" style={{ backgroundColor: theme.background }}>
      <ScrollView
        ref={scrollRef}
        className="flex-1 px-4 pt-2"
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled={true}
        removeClippedSubviews={false}
        scrollEnabled={true}
        bounces={true}
        showsVerticalScrollIndicator={true}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: BOTTOM_NAV_OFFSET + Math.max(insets.bottom, 12) + 16 }}
      >
        {/* Title Input */}
        <View className="mb-6">
          <Text className="text-base font-semibold mb-2" style={{ color: theme.text }}>
            What do you need help with? *
          </Text>
          <TextInput
            value={draft.title}
            onChangeText={handleTitleChange}
            onBlur={handleTitleBlur}
            placeholder="e.g., Help moving furniture, Logo design, Website fixes..."
            placeholderTextColor={theme.textDisabled}
            className="px-4 py-3 rounded-lg text-base"
            style={{ backgroundColor: theme.surfaceSecondary, color: theme.text }}
            accessibilityLabel="Bounty title input"
            maxLength={120}
          />
          <Text className="text-xs mt-1" style={{ color: theme.textSecondary }}>
            {draft.title.length}/120 characters
          </Text>
          {touched.title && errors.title && (
            <ValidationMessage message={errors.title} />
          )}
        </View>

        {/* Category Selection */}
        <View className="mb-6">
          <Text className="text-base font-semibold mb-3" style={{ color: theme.text }}>
            Category (optional)
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {CATEGORIES.map((category) => {
              const isSelected = draft.category === category.id;
              return (
                <TouchableOpacity
                  key={category.id}
                  onPress={() => handleCategorySelect(category.id)}
                  className="flex-row items-center px-4 py-2 rounded-full"
                  style={{ backgroundColor: isSelected ? theme.primary : theme.surface }}
                  accessibilityLabel={`Select ${category.label} category`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                >
                  <MaterialIcons
                    name={category.icon}
                    size={18}
                    color={isSelected ? '#fff' : theme.textDisabled}
                  />
                  <Text
                    className="ml-2 font-medium"
                    style={{ color: isSelected ? '#fff' : theme.textSecondary }}
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
        className="px-4 pb-4 pt-3 border-t"
        style={{ backgroundColor: theme.background, borderColor: theme.border, marginBottom: BOTTOM_NAV_OFFSET + Math.max(insets.bottom, 8) }}
      >
        <View className="flex-row gap-3">
          {onBack && (
            <TouchableOpacity
              onPress={onBack}
              className="flex-1 py-3 rounded-lg flex-row items-center justify-center"
              style={{ backgroundColor: theme.surfaceSecondary }}
              accessibilityLabel="Go back"
              accessibilityRole="button"
            >
              <MaterialIcons name="arrow-back" size={20} color={theme.text} />
              <Text className="font-semibold ml-2" style={{ color: theme.text }}>Back</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={handleNext}
            disabled={!isValid}
            className="flex-1 py-3 rounded-lg flex-row items-center justify-center"
            style={{ backgroundColor: isValid ? theme.primary : theme.surface }}
            accessibilityLabel="Continue to next step"
            accessibilityRole="button"
            accessibilityState={{ disabled: !isValid }}
          >
            <Text
              className="font-semibold mr-2"
              style={{ color: isValid ? '#fff' : theme.textDisabled }}
            >
              Next
            </Text>
            <MaterialIcons
              name="arrow-forward"
              size={20}
              color={isValid ? '#fff' : theme.textDisabled}
            />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

export default StepTitle;
