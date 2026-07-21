import { useRouter } from 'expo-router';
import React from 'react';
import { CommunityGuidelinesScreen } from '../../components/settings/community-guidelines-screen';

export default function CommunityGuidelinesRoute() {
  const router = useRouter();
  return (
    <CommunityGuidelinesScreen onBack={() => router.back()} backLabel="Back" />
  );
}
