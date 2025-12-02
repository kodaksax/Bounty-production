import React from 'react'
import { Text, View } from 'react-native'

const data = [1200,2100,1800,2400,2700,1700,2900,3100,2400,2800,3200,3600]

export function OverviewChart() {
  return (
    <View style={{ padding: 16 }}>
      <Text style={{ color: '#374151', fontWeight: '600', marginBottom: 8 }}>Monthly Totals</Text>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 160, gap: 8 }}>
        {data.map((val, i) => (
          <View key={i} style={{ width: 18, height: (val / 3600) * 160, backgroundColor: '#008e2a', borderRadius: 4 }} />
        ))}
      </View>
    </View>
  )
}

export default OverviewChart
