/* global globalThis */

import 'react-native-get-random-values';
import 'react-native-gesture-handler';

import NetInfo from '@react-native-community/netinfo';
import { GatewayClient } from '@crew/mobile-client';
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
import React, { useEffect } from 'react';
import {
  Alert,
  AppRegistry,
  AppState,
  Linking,
  StyleSheet,
  StatusBar,
  useColorScheme,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { FeedbackDeliveryPump } from '../src/app/FeedbackDeliveryPump';
import { GatewayProvider } from '../src/app/GatewayProvider';
import { PrivateBootstrapGate } from '../src/app/PrivateBootstrapGate';
import { queryClient } from '../src/app/queryClient';
import { linking, sanitizeInboundUrl } from '../src/navigation/linking';
import { RootNavigator } from '../src/navigation/RootNavigator';
import { keychainPendingAuthReturnStore } from '../src/storage/pendingAuthReturn';
import { keychainPendingRouteStore } from '../src/storage/pendingRoute';
import { secureDeviceIdStore } from '../src/storage/deviceIdentity';
import { secureSessionStore } from '../src/storage/secureSession';

const invalidLink = 'crewnext://unavailable?reason=invalid_link';
const releaseCryptoShape = Object.freeze({
  randomUuidAbsent: typeof globalThis.crypto?.randomUUID !== 'function',
  secureRandomPresent: typeof globalThis.crypto?.getRandomValues === 'function',
  subtleAbsent: typeof globalThis.crypto?.subtle?.digest !== 'function',
});

if (Object.values(releaseCryptoShape).some(value => !value)) {
  throw new Error('Unexpected React Native Release crypto shape');
}

const gatewayClient = new GatewayClient({
  baseUrl: 'http://127.0.0.1:3000',
  requestId: () => 'crew-e2e.android',
  sessionStore: secureSessionStore,
});

const releaseEvidenceLinking = {
  ...linking,
  async getInitialURL() {
    try {
      const inboundUrl = await Linking.getInitialURL();
      if (inboundUrl === 'crewnext://evidence/release-crypto') return null;
      if (inboundUrl) {
        return await sanitizeInboundUrl(
          inboundUrl,
          keychainPendingRouteStore,
          true,
        );
      }
      const authHandle = await keychainPendingRouteStore.current('auth');
      if (authHandle) return `crewnext://inbound/auth/${authHandle}`;
      const inviteHandle =
        (await keychainPendingAuthReturnStore.peek()) ??
        (await keychainPendingRouteStore.current('invite'));
      return inviteHandle ? `crewnext://inbound/invite/${inviteHandle}` : null;
    } catch {
      return invalidLink;
    }
  },
  subscribe(listener) {
    const subscription = Linking.addEventListener('url', event => {
      if (event.url === 'crewnext://evidence/release-crypto') {
        void showReleaseCryptoProof();
        return;
      }
      sanitizeInboundUrl(event.url, keychainPendingRouteStore, true).then(
        url => {
          if (url) listener(url);
        },
        () => listener(invalidLink),
      );
    });
    return () => subscription.remove();
  },
};

function GolfScorecardAndroidReleaseEvidenceApp() {
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
    Linking.getInitialURL().then(
      url => {
        if (url === 'crewnext://evidence/release-crypto') {
          void showReleaseCryptoProof();
        }
      },
      () => undefined,
    );
    return () => appStateSubscription.remove();
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
          <GatewayProvider client={gatewayClient}>
            <PrivateBootstrapGate>
              {privateStatus => (
                <>
                  {privateStatus === 'ready' ? <FeedbackDeliveryPump /> : null}
                  <NavigationContainer
                    linking={releaseEvidenceLinking}
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

async function showReleaseCryptoProof() {
  const deviceId = await secureDeviceIdStore.getOrCreate();
  const secureDeviceId =
    /^dvc_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      deviceId,
    );
  if (!secureDeviceId) {
    throw new Error('Secure device ID generation failed');
  }
  Alert.alert(
    'Sanitized Release crypto proof',
    JSON.stringify({ ...releaseCryptoShape, secureDeviceId }),
  );
}

AppRegistry.registerComponent(
  'CrewNext',
  () => GolfScorecardAndroidReleaseEvidenceApp,
);
