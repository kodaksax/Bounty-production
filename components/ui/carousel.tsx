import { MaterialIcons } from "@expo/vector-icons"
import * as React from "react"
import { Dimensions, StyleSheet, Text, TouchableOpacity, View } from "react-native"
import CarouselLib from "react-native-reanimated-carousel"


type CarouselProps = {
  data: any[]
  renderItem: ({ item, index }: { item: any; index: number }) => React.ReactElement
  width?: number
  height?: number
  loop?: boolean
  autoPlay?: boolean
  style?: any
}

const Carousel = React.forwardRef<View, CarouselProps>(
  ({ data, renderItem, width, height, loop = false, autoPlay = false, style }, ref) => {
    const windowWidth = width || Dimensions.get('window').width;
    const windowHeight = height || 200;
    return (
      <View ref={ref} style={style}>
        <CarouselLib
          width={windowWidth}
          height={windowHeight}
          data={data}
          renderItem={renderItem}
          loop={loop}
          autoPlay={autoPlay}
        />
      </View>
    );
  }
);
Carousel.displayName = "Carousel";

const CarouselContent = React.forwardRef<View, { style?: any; children?: React.ReactNode }>(
  ({ style, children }, ref) => (
    <View ref={ref} style={style}>
      {children}
    </View>
  )
);
CarouselContent.displayName = "CarouselContent";

const CarouselItem = React.forwardRef<View, { style?: any; children?: React.ReactNode }>(
  ({ style, children }, ref) => (
    <View ref={ref} style={style}>
      {children}
    </View>
  )
);
CarouselItem.displayName = "CarouselItem";

const CarouselPrevious = React.forwardRef<React.ComponentRef<typeof TouchableOpacity>, { onPress: () => void; disabled?: boolean; style?: any }>(
  ({ onPress, disabled, style }, ref) => (
    <TouchableOpacity accessibilityRole="button"
      ref={ref}
      onPress={onPress}
      disabled={disabled}
      style={[styles.arrowButton, style]}
    >
      <MaterialIcons name="arrow-back" size={24} color="#000000" />
      <Text style={styles.srOnly}>Previous slide</Text>
    </TouchableOpacity>
  )
);
CarouselPrevious.displayName = "CarouselPrevious";

const CarouselNext = React.forwardRef<React.ComponentRef<typeof TouchableOpacity>, { onPress: () => void; disabled?: boolean; style?: any }>(
  ({ onPress, disabled, style }, ref) => (
    <TouchableOpacity accessibilityRole="button"
      ref={ref}
      onPress={onPress}
      disabled={disabled}
      style={[styles.arrowButton, style]}
    >
      <MaterialIcons name="arrow-forward" size={24} color="#000000" />
      <Text style={styles.srOnly}>Next slide</Text>
    </TouchableOpacity>
  )
);
CarouselNext.displayName = "CarouselNext";

const styles = StyleSheet.create({
  arrowButton: {
    position: 'absolute',
    height: 32,
    width: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  srOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    top: -9999,
    left: -9999,
    opacity: 0,
  },
});

export {
  Carousel,
  CarouselContent,
  CarouselItem, CarouselNext, CarouselPrevious
}

