"use client"

import OTPInputView from '@twotalltotems/react-native-otp-input'
import * as React from "react"


const InputOTP = React.forwardRef<any, any>(({ style, ...props }, ref) => (
  <OTPInputView
    ref={ref}
    pinCount={6}
    autoFocusOnLoad
    codeInputFieldStyle={{
      width: 40,
      height: 40,
      borderWidth: 1,
      borderRadius: 8,
      borderColor: '#ccc',
      color: '#222',
      fontSize: 18,
      textAlign: 'center',
      marginHorizontal: 4,
    }}
    codeInputHighlightStyle={{
      borderColor: '#007AFF',
    }}
  style={{ flexDirection: 'row', justifyContent: 'center', ...(style || {}) }}
    {...props}
  />
))
InputOTP.displayName = "InputOTP"

export { InputOTP }

