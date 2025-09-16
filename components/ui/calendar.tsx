"use client"

import * as React from "react"
import { View } from "react-native"
import { Calendar as RnCalendar } from "react-native-calendars"


type Props = {
  mode?: 'single' | 'range'
  selected?: Date | undefined
  onSelect?: (date: Date) => void
  onDayPress?: (day: { dateString: string }) => void
  markedDates?: Record<string, { selected?: boolean; marked?: boolean; dotColor?: string }>
  initialDate?: string
}

function Calendar({ mode, selected, onSelect, onDayPress, markedDates, initialDate }: Props) {
  // Map selected Date to markedDates expected by react-native-calendars
  const selectedMarkedDates = React.useMemo(() => {
    if (!selected) return markedDates
    const key = selected.toISOString().slice(0, 10)
    return {
      ...(markedDates || {}),
      [key]: { selected: true },
    }
  }, [selected, markedDates])

  return (
    <View style={{ padding: 8 }}>
      <RnCalendar
        onDayPress={(day) => {
          onDayPress?.(day)
          if (onSelect) {
            onSelect(new Date(day.dateString))
          }
        }}
        markedDates={selectedMarkedDates}
        current={initialDate}
        // Basic theme mapping — adjust to match native styling in the app
        theme={{
          todayTextColor: "#0ea5e9",
          selectedDayBackgroundColor: "#1c7ed6",
          arrowColor: "#374151",
          monthTextColor: "#111827",
          textSectionTitleColor: "#6b7280",
        }}
      />
    </View>
  )
}

Calendar.displayName = "Calendar"

export { Calendar }
