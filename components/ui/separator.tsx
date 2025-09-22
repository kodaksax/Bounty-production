"use client"

import * as React from 'react';
import { View } from 'react-native';

// Simple RN separator that forwards ref to the underlying View
export const Separator = React.forwardRef<
  React.ElementRef<typeof View>,
  React.ComponentProps<typeof View> & { orientation?: 'horizontal' | 'vertical' }
>(({ orientation = 'horizontal', style, ...props }: React.ComponentProps<typeof View> & { orientation?: 'horizontal' | 'vertical' }, ref) => (
  <View
    ref={ref}
    style={
      orientation === 'horizontal'
        ? [ { height: 1, width: '100%', backgroundColor: '#e5e7eb' }, style ]
        : [ { width: 1, height: '100%', backgroundColor: '#e5e7eb' }, style ]
    }
    {...props}
  />
))
