import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { isTerminalPendingError } from '../app/flowErrors';
import { useGatewayClient } from '../app/GatewayProvider';
import { usePrivateSessionLifecycle } from '../app/PrivateBootstrapGate';
import { Button } from '../design/primitives';
import { colors, spacing, typography } from '../design/theme';
import type { RootStackParamList } from '../navigation/types';
import { keychainPendingAuthReturnStore } from '../storage/pendingAuthReturn';
import { keychainPendingRouteStore } from '../storage/pendingRoute';
import { ScreenFrame, ScreenIcon } from './ScreenFrame';

const arrowRight = require('../assets/icons/arrow-right.png');
const cloudOffline = require('../assets/icons/cloud-offline.png');
const crew = require('../assets/icons/crew.png');

type Props = NativeStackScreenProps<RootStackParamList, 'EmailIdentity'>;
export type EmailIdentityViewPhase = 'expired' | 'loading' | 'retryable';

export function EmailIdentityScreen({ navigation, route }: Props) {
  const client = useGatewayClient();
  const { replaceSession } = usePrivateSessionLifecycle();
  const [phase, setPhase] = useState<EmailIdentityViewPhase>('loading');
  const inFlightRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);

  const redeem = useCallback(async () => {
    if (!client || inFlightRef.current) {
      if (!client) setPhase('retryable');
      return;
    }
    inFlightRef.current = true;
    const controller = new AbortController();
    controllerRef.current = controller;
    setPhase('loading');
    try {
      const pending = await keychainPendingRouteStore.peek(
        route.params.handle,
        'auth',
      );
      if (!pending) {
        setPhase('expired');
        return;
      }

      const response = await client.request('identityMagicLinksRedeem', {
        body: { token: pending.token },
        headers: { 'idempotency-key': pending.idempotencyKey },
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      await replaceSession(response.data);
      await keychainPendingRouteStore.complete(route.params.handle);
      if (controller.signal.aborted) return;

      const inviteHandle = await keychainPendingAuthReturnStore.peek();
      if (inviteHandle) {
        navigation.reset({
          index: 0,
          routes: [
            {
              name: 'InvitePreview',
              params: { handle: inviteHandle, autoRedeem: true },
            },
          ],
        });
      } else {
        navigation.reset({ index: 0, routes: [{ name: 'Events' }] });
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (isTerminalPendingError(error)) {
        await keychainPendingRouteStore.complete(route.params.handle);
        setPhase('expired');
      } else {
        setPhase('retryable');
      }
    } finally {
      inFlightRef.current = false;
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, [client, navigation, replaceSession, route.params.handle]);

  useEffect(() => {
    redeem().catch(() => undefined);
    return () => controllerRef.current?.abort();
  }, [redeem]);

  return (
    <EmailIdentityView
      onRequestNewLink={() => navigation.navigate('SignIn')}
      onRetry={redeem}
      phase={phase}
    />
  );
}

export function EmailIdentityView({
  onRequestNewLink,
  onRetry,
  phase,
}: {
  onRequestNewLink(): void;
  onRetry(): void;
  phase: EmailIdentityViewPhase;
}) {
  if (phase === 'loading') {
    return (
      <ScreenFrame
        description="Crew richtet deinen geschützten Zugang auf diesem Gerät ein."
        eyebrow="GESCHÜTZTE ANMELDUNG"
        icon={crew}
        liveRegion="polite"
        statusLabel="ANMELDUNG WIRD GEPRÜFT"
        testID="email-identity-loading"
        title="Anmeldung wird geprüft"
        tone="lavender"
      >
        <ActivityIndicator
          accessibilityLabel="Anmeldung wird geprüft"
          color={colors.textSecondary}
          size="large"
        />
        <Text style={styles.message}>
          Du bist noch nicht angemeldet. Geschützte Ziele bleiben verborgen.
        </Text>
      </ScreenFrame>
    );
  }

  if (phase === 'expired') {
    return (
      <ScreenFrame
        description="Dieser Anmeldelink ist ungültig oder abgelaufen."
        eyebrow="GESCHÜTZTE ANMELDUNG"
        icon={cloudOffline}
        liveRegion="assertive"
        statusLabel="LINK NICHT MEHR VERFÜGBAR"
        testID="email-identity-expired"
        title="Anmeldelink nicht verfügbar"
        tone="brand"
      >
        <Text accessibilityRole="alert" style={styles.message}>
          Es wurden keine privaten Inhalte geöffnet.
        </Text>
        <Button
          icon={<ScreenIcon source={arrowRight} />}
          label="Neuen Link senden"
          onPress={onRequestNewLink}
          style={styles.action}
          testID="identity-new-link"
          variant="action"
        />
      </ScreenFrame>
    );
  }

  return (
    <ScreenFrame
      description="Der geschützte Link kann gerade nicht verwendet werden."
      eyebrow="GESCHÜTZTE ANMELDUNG"
      icon={cloudOffline}
      liveRegion="assertive"
      statusLabel="ERNEUT VERSUCHEN"
      testID="email-identity-retryable"
      title="Anmeldung nicht verfügbar"
      tone="brand"
    >
      <Text accessibilityRole="alert" style={styles.message}>
        Deine geschützte Rückkehr bleibt auf diesem Gerät erhalten.
      </Text>
      <Button
        icon={<ScreenIcon source={arrowRight} />}
        label="Erneut versuchen"
        onPress={onRetry}
        style={styles.action}
        testID="identity-retry"
        variant="action"
      />
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  action: {
    alignSelf: 'stretch',
    marginTop: spacing.xs,
  },
  message: {
    ...typography.body,
    color: colors.text,
  },
});
