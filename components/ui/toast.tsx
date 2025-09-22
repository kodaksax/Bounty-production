"use client"

import * as React from 'react'
import { Text, View } from 'react-native'

// Minimal RN-friendly Toast API stubs to satisfy imports
export const ToastProvider = ({ children }: { children?: React.ReactNode }) => <>{children}</>
export const ToastViewport = ({ children }: { children?: React.ReactNode }) => <>{children}</>
export const Toast = ({ children }: { children?: React.ReactNode }) => <View>{children}</View>
export const ToastAction = ({ children }: { children?: React.ReactNode }) => <>{children}</>
export const ToastClose = ({ children }: { children?: React.ReactNode }) => <>{children}</>
export const ToastTitle = ({ children }: { children?: React.ReactNode }) => <Text>{children}</Text>
export const ToastDescription = ({ children }: { children?: React.ReactNode }) => <Text>{children}</Text>

export type ToastProps = { children?: React.ReactNode }
export type ToastActionElement = React.ReactElement | null
