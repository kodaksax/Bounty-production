import { useRouter, type Href } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { useLocation } from '../app/hooks/useLocation';
import { useFeedLocation } from '../hooks/useFeedLocation';
import { useServiceability } from '../hooks/useServiceability';
import { useValidUserId } from '../hooks/useValidUserId';
import { authProfileService } from '../lib/services/auth-profile-service';
import { getPosterLocalProof, LOCAL_PROOF_MIN } from '../lib/services/bounty-location-service';
import { localProofStrings } from '../lib/strings/local-proof';
import { LOCAL_DEFAULT_RADIUS_MILES } from '../lib/utils/feed-distance-default';
import { isOutOfServiceArea } from '../lib/utils/serviceable-region';

interface PosterLocalNoteProps {
  lineStyle: StyleProp<TextStyle>;
  linkStyle: StyleProp<TextStyle>;
}

/**
 * The one line at the top of the Post tab: the waitlist link for someone
 * outside the service area, else how many people are looking for tasks nearby.
 * Renders nothing when the count is suppressed or unknown. Mount it only with
 * `poster-local-proof` on, because it reads the user's location.
 */
export function PosterLocalNote({ lineStyle, linkStyle }: PosterLocalNoteProps) {
  const router = useRouter();
  const userId = useValidUserId();
  const serviceability = useServiceability();
  const { location, permission } = useLocation();
  const { coords, ready } = useFeedLocation({ userId, deviceLocation: location, permission });
  const [count, setCount] = useState<number | null>(null);

  const outOfArea = isOutOfServiceArea(serviceability);
  const isPoster = authProfileService.getPrimaryRoleForAnalytics() === 'poster';
  const latitude = coords?.latitude;
  const longitude = coords?.longitude;

  useEffect(() => {
    if (!ready || outOfArea || !isPoster || latitude == null || longitude == null) {
      setCount(null);
      return;
    }
    let cancelled = false;
    void getPosterLocalProof({
      latitude,
      longitude,
      radiusMiles: LOCAL_DEFAULT_RADIUS_MILES,
    }).then(result => {
      if (!cancelled) setCount(result?.huntersActive7d ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [ready, outOfArea, isPoster, latitude, longitude]);

  if (outOfArea) {
    const openWaitlist = () =>
      router.push({
        pathname: '/waitlist',
        params: {
          country_code: serviceability.country_code ?? '',
          region: serviceability.region ?? '',
        },
      } as unknown as Href);
    return (
      <Text
        style={lineStyle}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        onPress={openWaitlist}
        accessibilityRole="link"
        accessibilityLabel={`${localProofStrings.outOfAreaLead} ${localProofStrings.outOfAreaLink}`}
      >
        {localProofStrings.outOfAreaLead}{' '}
        <Text style={linkStyle}>{localProofStrings.outOfAreaLink}</Text>
      </Text>
    );
  }

  if (count === null || count < LOCAL_PROOF_MIN) return null;

  return (
    <Text style={lineStyle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
      {localProofStrings.proofLine(count)}
    </Text>
  );
}

export default PosterLocalNote;
