"use client"

import * as React from 'react';
import { View } from 'react-native';
import { colors } from '../../lib/theme';

// Minimal RN slider wrapper (visual placeholder)
export const Slider = ({ value = 0, onValueChange }: { value?: number; onValueChange?: (v:number)=>void }) => {
  return (
    <View style={{ height: 36, justifyContent: 'center' }}>
      <View style={{ height: 6, backgroundColor: '#e5e7eb', borderRadius: 6, overflow: 'hidden' }}>
        <View style={{ width: `${Math.min(100, Math.max(0, (value||0)*100))}%`, height: '100%', backgroundColor: colors.primary[500] }} />
      </View>
    </View>
  )
}
