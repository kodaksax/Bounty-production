import React from "react"
import { Dimensions, Text, View } from "react-native"
import { BarChart, LineChart, PieChart } from "react-native-chart-kit"

// Example chart config type for chart-kit
export type ChartKitConfig = {
  backgroundColor?: string
  backgroundGradientFrom?: string
  backgroundGradientTo?: string
  color?: (opacity?: number) => string
  labelColor?: (opacity?: number) => string
  propsForDots?: object
}

type ChartContainerProps = {
  data: any
  config?: ChartKitConfig
  type?: "line" | "bar" | "pie"
  width?: number
  height?: number
  style?: object
  chartProps?: object
}

const ChartContainer: React.FC<ChartContainerProps> = ({
  data,
  config = {},
  type = "line",
  width,
  height,
  style,
  chartProps = {},
}) => {
  const screenWidth = width || Dimensions.get("window").width - 32
  const chartHeight = height || 220

  if (type === "bar") {
    return (
      <BarChart
        data={data}
        width={screenWidth}
        height={chartHeight}
        chartConfig={config}
        style={style}
        {...chartProps}
        yAxisLabel=""      // Add this prop
        yAxisSuffix=""     // Add this prop
      />
    )
  }
  if (type === "pie") {
    return (
      <PieChart
        data={data}
        width={screenWidth}
        height={chartHeight}
        chartConfig={config}
        accessor={"value"}
        style={style}
        backgroundColor="transparent" // Required prop
        paddingLeft="0"              // Required prop (string, e.g. "0" or "16")
        {...chartProps}
      />
    )
  }
  // Default to line chart
  return (
    <LineChart
      data={data}
      width={screenWidth}
      height={chartHeight}
      chartConfig={config}
      style={style}
      {...chartProps}
    />
  )
}

// Simple legend component
const ChartLegend: React.FC<{ labels: string[]; colors?: string[] }> = ({ labels, colors }) => (
  <View style={{ flexDirection: "row", justifyContent: "center", marginTop: 8 }}>
    {labels.map((label, i) => (
      <View key={label} style={{ flexDirection: "row", alignItems: "center", marginHorizontal: 8 }}>
        <View style={{ width: 12, height: 12, backgroundColor: colors?.[i] || "#888", borderRadius: 6, marginRight: 4 }} />
        <Text style={{ fontSize: 12 }}>{label}</Text>
      </View>
    ))}
  </View>
)

export { ChartContainer, ChartLegend }

