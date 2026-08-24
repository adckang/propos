import React, { useRef } from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from '../screens/HomeScreen';
import JobScreen from '../screens/JobScreen';
import type { JobPayload } from '../services/fcm';

export type RootStackParamList = {
  Home: undefined;
  Job: { payload: JobPayload };
};

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

const Stack = createNativeStackNavigator<RootStackParamList>();

type Props = { initialPayload?: JobPayload | null };

export default function Navigation({ initialPayload }: Props) {
  const handledInitial = useRef(false);

  function handleReady() {
    if (initialPayload && !handledInitial.current && navigationRef.isReady()) {
      handledInitial.current = true;
      navigationRef.navigate('Job', { payload: initialPayload });
    }
  }

  return (
    <NavigationContainer ref={navigationRef} onReady={handleReady}>
      <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: '#fff' }, headerTintColor: '#1a1a2e' }}>
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'PROPOS Worker' }} />
        <Stack.Screen name="Job"  component={JobScreen}  options={{ title: '새 요청' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
