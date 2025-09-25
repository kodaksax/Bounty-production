import { cn } from 'lib/utils';
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

export interface BinaryToggleOption<T extends string> { id: T; label: string }

interface BinaryToggleProps<T extends string> {
  value: T
  onChange: (v: T) => void
  options: readonly BinaryToggleOption<T>[]
  size?: 'sm' | 'md'
  className?: string
}

export function BinaryToggle<T extends string>({ value, onChange, options, size = 'md', className }: BinaryToggleProps<T>) {
  return (
    <View className={cn('flex-row rounded-xl overflow-hidden bg-emerald-800/40 border border-emerald-700', className)}>
      {options.map(opt => {
        const selected = value === opt.id
        return (
          <TouchableOpacity
            key={opt.id}
            onPress={() => onChange(opt.id)}
            className={cn('flex-1 items-center justify-center',
              size === 'sm' ? 'py-2' : 'py-3',
              selected ? 'bg-emerald-500/30' : 'opacity-70'
            )}
            activeOpacity={0.85}
          >
            <Text className={cn('font-medium', selected ? 'text-white' : 'text-emerald-200')}>{opt.label}</Text>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}
