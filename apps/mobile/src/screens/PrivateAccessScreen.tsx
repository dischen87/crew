import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text } from 'react-native';
import {
  type PrivateUnavailableReason,
  usePrivateSessionLifecycle,
} from '../app/PrivateBootstrapGate';
import { Button } from '../design/primitives';
import { colors, spacing, typography } from '../design/theme';
import type { RootStackParamList } from '../navigation/types';
import { ScreenFrame, ScreenIcon } from './ScreenFrame';

const arrowRight = require('../assets/icons/arrow-right.png');
const cloudOffline = require('../assets/icons/cloud-offline.png');
const crew = require('../assets/icons/crew.png');

export type PrivateAccessViewState =
  | 'loading'
  | 'sessionRequired'
  | 'unavailable';

export function PrivateLoadingScreen() {
  return <PrivateAccessView state="loading" />;
}

type AccessProps = {
  navigation: NativeStackNavigationProp<RootStackParamList>;
};

export function SessionRequiredScreen({ navigation }: AccessProps) {
  return (
    <PrivateAccessView
      onAction={() => navigation.navigate('SignIn')}
      state="sessionRequired"
    />
  );
}

export function PrivateUnavailableScreen() {
  const lifecycle = usePrivateSessionLifecycle();
  const lifecycleRef = useRef(lifecycle);
  lifecycleRef.current = lifecycle;
  const attemptRef = useRef<'confirming' | 'idle' | 'pending'>('idle');
  const mountedRef = useRef(true);
  const [safeExitState, setSafeExitState] = useState<
    'failed' | 'idle' | 'pending'
  >('idle');

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const resetConfirmation = () => {
    if (attemptRef.current === 'confirming') attemptRef.current = 'idle';
  };

  const confirmSafeExit = async () => {
    if (
      attemptRef.current !== 'confirming' ||
      lifecycleRef.current.status !== 'unavailable'
    ) {
      resetConfirmation();
      return;
    }
    attemptRef.current = 'pending';
    setSafeExitState('pending');
    try {
      await lifecycleRef.current.continueSignedOut();
    } catch {
      attemptRef.current = 'idle';
      if (mountedRef.current) setSafeExitState('failed');
    }
  };

  const requestSafeExit = () => {
    if (
      attemptRef.current !== 'idle' ||
      lifecycleRef.current.status !== 'unavailable'
    ) {
      return;
    }
    attemptRef.current = 'confirming';
    Alert.alert(
      'Zur Anmeldung wechseln?',
      'Deine geschützten Offline-Daten bleiben auf diesem Gerät unverändert. Crew zeigt stattdessen die Anmeldung.',
      [
        {
          onPress: resetConfirmation,
          style: 'cancel',
          text: 'Abbrechen',
        },
        {
          onPress: () => {
            confirmSafeExit().catch(() => undefined);
          },
          text: 'Zur Anmeldung',
        },
      ],
      { cancelable: true, onDismiss: resetConfirmation },
    );
  };

  return (
    <PrivateAccessView
      onAction={lifecycle.reloadSession}
      onSafeExit={requestSafeExit}
      safeExitState={safeExitState}
      state="unavailable"
      unavailableReason={lifecycle.unavailableReason ?? 'privateData'}
    />
  );
}

export function PrivateAccessView({
  onAction,
  onSafeExit,
  safeExitState = 'idle',
  state,
  unavailableReason = 'privateData',
}: {
  onAction?(): void;
  onSafeExit?(): void;
  safeExitState?: 'failed' | 'idle' | 'pending';
  state: PrivateAccessViewState;
  unavailableReason?: PrivateUnavailableReason;
}) {
  if (state === 'loading') {
    return (
      <ScreenFrame
        description="Der private Bereich wird auf diesem Gerät sicher bereitgestellt."
        eyebrow="PRIVATER BEREICH"
        icon={crew}
        liveRegion="polite"
        statusLabel="CREW WIRD VORBEREITET"
        testID="private-access-loading"
        title="Crew wird vorbereitet"
        tone="lavender"
      >
        <ActivityIndicator
          accessibilityLabel="Privater Bereich wird vorbereitet"
          color={colors.textSecondary}
          size="large"
        />
        <Text style={styles.message}>Private Inhalte bleiben verborgen.</Text>
      </ScreenFrame>
    );
  }

  if (state === 'sessionRequired') {
    return (
      <ScreenFrame
        description="Melde dich an, um deine privaten Events auf diesem Gerät zu öffnen."
        eyebrow="PRIVATER BEREICH"
        icon={crew}
        statusLabel="ANMELDUNG ERFORDERLICH"
        testID="private-access-signed-out"
        title="Bitte anmelden"
        tone="surface"
      >
        <Text style={styles.message}>
          Ohne Anmeldung werden keine Event- oder Kontodetails angezeigt.
        </Text>
        <Button
          icon={<ScreenIcon source={arrowRight} />}
          label="Mit E-Mail anmelden"
          onPress={onAction}
          style={styles.action}
          testID="private-access-sign-in"
          variant="action"
        />
      </ScreenFrame>
    );
  }

  const secureStorageUnavailable = unavailableReason === 'secureStorage';
  return (
    <ScreenFrame
      description={
        secureStorageUnavailable
          ? 'Crew kann den geschützten Gerätespeicher gerade nicht sicher lesen.'
          : 'Crew konnte deine geschützten Offline-Daten nicht sicher öffnen.'
      }
      eyebrow="PRIVATER BEREICH"
      icon={cloudOffline}
      liveRegion="assertive"
      statusLabel={
        secureStorageUnavailable
          ? 'GERÄTESCHUTZ NICHT ERREICHBAR'
          : 'PRIVATE DATEN GESPERRT'
      }
      testID="private-access-unavailable"
      title="Private Daten nicht verfügbar"
      tone="brand"
    >
      <Text accessibilityRole="alert" style={styles.message}>
        Deine privaten Daten bleiben unverändert und werden nicht angezeigt.
      </Text>
      <Button
        disabled={safeExitState === 'pending'}
        icon={<ScreenIcon source={arrowRight} />}
        label="Erneut versuchen"
        onPress={onAction}
        style={styles.action}
        testID="private-access-retry"
        variant="action"
      />
      {onSafeExit ? (
        <Button
          accessibilityHint="Öffnet eine Bestätigung. Private Offline-Daten werden nicht gelöscht."
          label="Sicher zur Anmeldung"
          loading={safeExitState === 'pending'}
          onPress={onSafeExit}
          style={styles.secondaryAction}
          testID="private-access-safe-exit"
          variant="surface"
        />
      ) : null}
      {safeExitState === 'failed' ? (
        <Text
          accessibilityLiveRegion="assertive"
          accessibilityRole="alert"
          style={styles.error}
          testID="private-access-safe-exit-error"
        >
          Der sichere Wechsel konnte nicht abgeschlossen werden. Bitte versuche
          es erneut.
        </Text>
      ) : null}
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
  error: {
    ...typography.body,
    color: colors.text,
  },
  secondaryAction: {
    alignSelf: 'stretch',
  },
});
