import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { Text, View } from 'react-native';

interface StepperHeaderProps {
  currentStep: number;
  totalSteps: number;
  stepTitle: string;
}

export function StepperHeader({ currentStep, totalSteps, stepTitle }: StepperHeaderProps) {
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
                className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  isComplete
                    ? 'bg-emerald-400'
                    : isCurrent
                    ? 'bg-emerald-500'
                    : 'bg-emerald-700/50'
                }`}
              >
                {isComplete ? (
                  <MaterialIcons name="check" size={18} color="#fff" />
                ) : (
                  <Text className="text-white text-sm font-bold">{stepNum}</Text>
                )}
              </View>
              {stepNum < totalSteps && (
                <View
                  className={`h-0.5 w-8 ${
                    isComplete ? 'bg-emerald-400' : 'bg-emerald-700/50'
                  }`}
                />
              )}
            </React.Fragment>
          );
        })}
      </View>

      {/* Step Title */}
      <Text className="text-emerald-200 text-sm text-center">
        Step {currentStep} of {totalSteps}
      </Text>
      <Text className="text-emerald-100 text-xl font-bold text-center mt-1">
        {stepTitle}
      </Text>
    </View>
  );
}
