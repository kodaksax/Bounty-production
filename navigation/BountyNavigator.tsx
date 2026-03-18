import React from 'react';
import { createStackNavigator } from '@react-navigation/stack';
import BountyAppScreen from '../screens/BountyAppScreen';
import BountyDetailScreen from '../screens/BountyDetailScreen';
import CreateBountyScreen from '../screens/CreateBountyScreen';
import MyBountiesScreen from '../screens/MyBountiesScreen';

export type BountyStackParamList = {
  BountyApp: undefined;
  BountyDetail: { bountyId: string; isPublic?: boolean };
  CreateBounty: undefined;
  MyBounties: undefined;
};

const Stack = createStackNavigator<BountyStackParamList>();

const BountyNavigator: React.FC = () => {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: {
          backgroundColor: '#6366F1',
        },
        headerTintColor: '#FFFFFF',
        headerTitleStyle: {
          fontWeight: 'bold',
        },
      }}
    >
      <Stack.Screen
        name="BountyApp"
        component={BountyAppScreen}
        options={{ title: 'Bounties' }}
      />
      <Stack.Screen
        name="BountyDetail"
        component={BountyDetailScreen}
        options={{ title: 'Bounty Details' }}
      />
      <Stack.Screen
        name="CreateBounty"
        component={CreateBountyScreen}
        options={{ title: 'Create Bounty' }}
      />
      <Stack.Screen
        name="MyBounties"
        component={MyBountiesScreen}
        options={{ title: 'My Bounties' }}
      />
    </Stack.Navigator>
  );
};

export default BountyNavigator;