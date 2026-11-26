import React, { useRef } from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from '../screens/HomeScreen';
import JobScreen from '../screens/JobScreen';
import type { JobPayload } from '../services/fcm';
import type { CleaningRequest } from '../services/api';

export type RootStackParamList = {
  Home: undefined;
  Job: { payload: JobPayload } | { request: CleaningRequest };
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
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: '청소 요청 내역' }} />
        <Stack.Screen name="Job" component={JobScreen} options={({ route }) => ({
          title: 'request' in route.params ? '청소 요청' : '새 요청',
        })} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
