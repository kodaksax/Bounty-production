import { MaterialIcons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

interface Props {
  message?: string;
}

export default function WorkInProgressBanner({ message }: Props) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])
    ).start();
  }, [pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0.45] });

  return (
    <View style={styles.container}>
      <View style={styles.iconRow}>
        <Animated.View style={[styles.pulse, { transform: [{ scale }], opacity }]} />
        <View style={styles.iconInner}>
          <MaterialIcons name="hourglass-top" size={22} color="#fff" />
        </View>
        <View style={styles.textCol}>
          <Text style={styles.title}>Work in progress</Text>
          <Text style={styles.message}>{message || 'Your hunter is working on this. We’ll let you know when it’s ready for review.'}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(251, 191, 36, 0.12)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.22)',
    marginBottom: 16,
  },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pulse: {
    position: 'absolute',
    left: 0,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#f59e0b',
  },
  iconInner: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#f59e0b',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  textCol: {
    flex: 1,
  },
  title: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
    marginBottom: 2,
  },
  message: {
    color: '#fff',
    opacity: 0.9,
    fontSize: 12,
  },
});
