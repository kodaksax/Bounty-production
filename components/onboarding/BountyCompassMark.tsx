/**
 * Bounty's own compass mark — the hero art for the location step
 * (app/onboarding/location.tsx).
 *
 * Deliberately not the platform-template compass (a glossy Safari-style app
 * icon): this is the bounty crosshair with a compass needle inside it, so the
 * screen reads as "we point you at the money near you" rather than "we want
 * your GPS". Every colour comes from AppTheme, so the mark inverts correctly
 * in light and dark mode instead of baking in a dark plate.
 */

import { View } from 'react-native';
import Svg, { Circle, G, Line, Path } from 'react-native-svg';
import type { AppTheme } from '../../lib/themes/types';

interface BountyCompassMarkProps {
  theme: AppTheme;
  /** Rendered width/height in px. The artwork is drawn on a 200x200 viewBox and scales cleanly. */
  size?: number;
}

// Tick marks around the dial: skipped at the four cardinal points, where the
// crosshair arms already break the ring.
const TICK_ANGLES = Array.from({ length: 36 }, (_, i) => i * 10).filter(a => a % 90 !== 0);

export function BountyCompassMark({ theme, size = 160 }: BountyCompassMarkProps) {
  const center = 100;
  const ringRadius = 74;
  const tickOuter = 64;

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="Bounty compass"
      style={{ width: size, height: size }}
    >
      <Svg width={size} height={size} viewBox="0 0 200 200">
        {/* Soft plate so the mark sits on its own surface on either theme. */}
        <Circle cx={center} cy={center} r={92} fill={theme.surface} />
        <Circle cx={center} cy={center} r={92} stroke={theme.border} strokeWidth={1.5} fill="none" />

        {/* Dial */}
        <Circle
          cx={center}
          cy={center}
          r={ringRadius}
          stroke={theme.border}
          strokeWidth={3}
          fill="none"
        />

        {TICK_ANGLES.map(angle => {
          const rad = (angle * Math.PI) / 180;
          const long = angle % 30 === 0;
          const inner = long ? tickOuter - 12 : tickOuter - 6;
          return (
            <Line
              key={angle}
              x1={center + Math.sin(rad) * tickOuter}
              y1={center - Math.cos(rad) * tickOuter}
              x2={center + Math.sin(rad) * inner}
              y2={center - Math.cos(rad) * inner}
              stroke={theme.textSecondary}
              strokeWidth={long ? 3 : 2}
              strokeLinecap="round"
              opacity={long ? 0.75 : 0.4}
            />
          );
        })}

        {/* Crosshair arms — they cross the ring and stop short of the needle,
            leaving the centre clear for it. */}
        <G stroke={theme.primary} strokeWidth={4} strokeLinecap="round">
          <Line x1={center} y1={12} x2={center} y2={46} />
          <Line x1={center} y1={154} x2={center} y2={188} />
          <Line x1={12} y1={center} x2={46} y2={center} />
          <Line x1={154} y1={center} x2={188} y2={center} />
        </G>

        {/* Needle: the north half is the brand accent, the trailing half stays
            muted so the direction it points is unambiguous at icon size. */}
        <Path d={`M${center} 44 L114 ${center} L${center} 112 L86 ${center} Z`} fill={theme.primary} />
        <Path
          d={`M${center} 156 L86 ${center} L${center} 88 L114 ${center} Z`}
          fill={theme.textSecondary}
          opacity={0.45}
        />

        <Circle cx={center} cy={center} r={7} fill={theme.background} />
        <Circle cx={center} cy={center} r={7} stroke={theme.primary} strokeWidth={3} fill="none" />
      </Svg>
    </View>
  );
}
