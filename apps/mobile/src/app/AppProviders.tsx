import NetInfo from '@react-native-community/netinfo';
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
} from '@react-navigation/native';
import {
  focusManager,
  onlineManager,
  QueryClientProvider,
} from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState, StatusBar, StyleSheet, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { linking } from '../navigation/linking';
import { RootNavigator } from '../navigation/RootNavigator';
import { FeedbackDeliveryPump } from './FeedbackDeliveryPump';
import { GatewayProvider } from './GatewayProvider';
import { PrivateBootstrapGate } from './PrivateBootstrapGate';
import { queryClient } from './queryClient';

export function AppProviders({ runtimeConfig }: { runtimeConfig?: unknown }) {
  const dark = useColorScheme() === 'dark';

  useEffect(() => {
    onlineManager.setEventListener(setOnline =>
      NetInfo.addEventListener(state =>
        setOnline(
          Boolean(state.isConnected && state.isInternetReachable !== false),
        ),
      ),
    );
    const appStateSubscription = AppState.addEventListener('change', state => {
      focusManager.setFocused(state === 'active');
    });

    return () => {
      appStateSubscription.remove();
    };
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
          <GatewayProvider runtimeConfig={runtimeConfig}>
            <PrivateBootstrapGate>
              {privateStatus => (
                <>
                  {privateStatus === 'ready' ? <FeedbackDeliveryPump /> : null}
                  <NavigationContainer
                    linking={linking}
                    theme={dark ? DarkTheme : DefaultTheme}
                  >
                    <RootNavigator privateStatus={privateStatus} />
                  </NavigationContainer>
                </>
              )}
            </PrivateBootstrapGate>
          </GatewayProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
