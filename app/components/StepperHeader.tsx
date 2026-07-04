import { MaterialIcons } from '@expo/vector-icons';
import { useAppThemeContext } from 'lib/themes/AppThemeContext';
import React from 'react';
import { Text, View } from 'react-native';

interface StepperHeaderProps {
  currentStep: number;
  totalSteps: number;
  stepTitle: string;
}

export function StepperHeader({ currentStep, totalSteps, stepTitle }: StepperHeaderProps) {
  const { theme } = useAppThemeContext();

  const inactiveDotBg = theme.isDark ? '#111827' : theme.surfaceSecondary;
  const inactiveLineBg = theme.isDark ? '#111827' : theme.border;

  return (
    <View className="mb-6">
      {/* Progress Dots */}
      <View className="flex-row items-center justify-center mb-3">
        {Array.from({ length: totalSteps }).map((_, index) => {
          const stepNum = index + 1;
          const isComplete = stepNum < currentStep;
          const isCurrent = stepNum === currentStep;

          return (
            <React.Fragment key={stepNum}>
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: isComplete || isCurrent ? '#059669' : inactiveDotBg,
                }}
              >
                {isComplete ? (
                  <MaterialIcons name="check" size={18} color="#fff" />
                ) : (
                  <Text style={{
                    fontSize: 14,
                    fontWeight: 'bold',
                    color: isCurrent ? '#fff' : (theme.isDark ? '#fff' : theme.textSecondary),
                  }}>
                    {stepNum}
                  </Text>
                )}
              </View>
              {stepNum < totalSteps && (
                <View
                  style={{
                    height: 2,
                    width: 32,
                    backgroundColor: isComplete ? '#059669' : inactiveLineBg,
                  }}
                />
              )}
            </React.Fragment>
          );
        })}
      </View>

      {/* Step Title */}
      <Text style={{ color: theme.textSecondary, fontSize: 14, textAlign: 'center' }}>
        Step {currentStep} of {totalSteps}
      </Text>
      <Text style={{ color: theme.text, fontSize: 20, fontWeight: 'bold', textAlign: 'center', marginTop: 4 }}>
        {stepTitle}
      </Text>
    </View>
  );
}

export default StepperHeader;
