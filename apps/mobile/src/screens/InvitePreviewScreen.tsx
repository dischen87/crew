import type { GatewayResponseData } from '@crew/mobile-client';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import {
  isInvitationEmailMismatch,
  isSessionFailure,
  isTerminalPendingError,
} from '../app/flowErrors';
import { useGatewayClient } from '../app/GatewayProvider';
import {
  type PrivateNavigationStatus,
  usePrivateSessionLifecycle,
} from '../app/PrivateBootstrapGate';
import { queryClient } from '../app/queryClient';
import { Button, StatusChip } from '../design/primitives';
import { colors, spacing, typography } from '../design/theme';
import type { RootStackParamList } from '../navigation/types';
import { keychainPendingAuthReturnStore } from '../storage/pendingAuthReturn';
import { keychainPendingRouteStore } from '../storage/pendingRoute';
import { ScreenFrame, ScreenIcon } from './ScreenFrame';

const arrowRight = require('../assets/icons/arrow-right.png');
const check = require('../assets/icons/check.png');
const cloudOffline = require('../assets/icons/cloud-offline.png');
const crew = require('../assets/icons/crew.png');

type Props = NativeStackScreenProps<RootStackParamList, 'InvitePreview'>;
export type InvitePreview = GatewayResponseData<'eventInvitationsPreview'>;
export type InvitePreviewPhase =
  | 'accountMismatch'
  | 'loading'
  | 'ready'
  | 'terminal'
  | 'unavailable';

export function InvitePreviewScreen({ navigation, route }: Props) {
  const client = useGatewayClient();
  const { accountId, reloadSession, replaceSession, status } =
    usePrivateSessionLifecycle();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [phase, setPhase] = useState<InvitePreviewPhase>('loading');
  const [redeeming, setRedeeming] = useState(false);
  const [resumingAuthReturn, setResumingAuthReturn] = useState(false);
  const loadFlightRef = useRef(false);
  const redeemFlightRef = useRef(false);
  const autoRedeemedRef = useRef(false);
  const loadControllerRef = useRef<AbortController | null>(null);
  const redeemControllerRef = useRef<AbortController | null>(null);
  const handle = route.params.handle;

  const completeReturnIfCurrent = useCallback(async () => {
    await keychainPendingAuthReturnStore.complete(handle);
  }, [handle]);

  const switchAccount = useCallback(async () => {
    setRedeeming(true);
    try {
      await keychainPendingAuthReturnStore.set(handle);
      await replaceSession(null);
      navigation.navigate('SignIn');
    } catch {
      setPhase('unavailable');
    } finally {
      setRedeeming(false);
    }
  }, [handle, navigation, replaceSession]);

  const loadPreview = useCallback(async () => {
    if (!client || loadFlightRef.current) {
      if (!client) setPhase('unavailable');
      return;
    }
    loadFlightRef.current = true;
    const controller = new AbortController();
    loadControllerRef.current = controller;
    setPhase('loading');
    try {
      const pending = await keychainPendingRouteStore.peek(handle, 'invite');
      if (controller.signal.aborted) return;
      if (!pending) {
        await completeReturnIfCurrent();
        setPhase('terminal');
        return;
      }
      const response = await client.request('eventInvitationsPreview', {
        body: { token: pending.token },
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!response.data.usable) {
        await keychainPendingRouteStore.complete(handle);
        await completeReturnIfCurrent();
        setPhase('terminal');
        return;
      }
      setPreview(response.data);
      setResumingAuthReturn(
        (await keychainPendingAuthReturnStore.peek()) === handle,
      );
      setPhase('ready');
    } catch (error) {
      if (controller.signal.aborted) return;
      if (isTerminalPendingError(error)) {
        await keychainPendingRouteStore.complete(handle);
        await completeReturnIfCurrent();
        setPhase('terminal');
      } else {
        setPhase('unavailable');
      }
    } finally {
      loadFlightRef.current = false;
      if (loadControllerRef.current === controller) {
        loadControllerRef.current = null;
      }
    }
  }, [client, completeReturnIfCurrent, handle]);

  const redeem = useCallback(async () => {
    if (redeemFlightRef.current) return;
    if (status === 'signedOut') {
      try {
        await keychainPendingAuthReturnStore.set(handle);
        navigation.navigate('SignIn');
      } catch {
        setPhase('unavailable');
      }
      return;
    }
    if (status === 'loading') return;
    if (status === 'unavailable') {
      setPhase('unavailable');
      return;
    }
    if (!client || !accountId) {
      setPhase('unavailable');
      return;
    }

    redeemFlightRef.current = true;
    const controller = new AbortController();
    redeemControllerRef.current = controller;
    setRedeeming(true);
    try {
      const pending = await keychainPendingRouteStore.peek(handle, 'invite');
      if (controller.signal.aborted) return;
      if (!pending) {
        await completeReturnIfCurrent();
        setPhase('terminal');
        return;
      }
      const response = await client.request('eventInvitationsRedeem', {
        body: { token: pending.token },
        headers: { 'idempotency-key': pending.idempotencyKey },
        signal: controller.signal,
      });
      await keychainPendingRouteStore.complete(handle);
      await completeReturnIfCurrent();
      await queryClient.invalidateQueries({
        queryKey: ['private', accountId, 'eventRoots'],
      });
      if (controller.signal.aborted) return;
      navigation.reset({
        index: 1,
        routes: [
          { name: 'Events' },
          {
            name: 'EventInbound',
            params: { rootEventId: response.data.membership.rootEventId },
          },
        ],
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      if (isInvitationEmailMismatch(error)) {
        await keychainPendingAuthReturnStore.set(handle);
        setPhase('accountMismatch');
      } else if (isSessionFailure(error)) {
        await keychainPendingAuthReturnStore.set(handle);
        await reloadSession();
        navigation.navigate('SignIn');
      } else if (isTerminalPendingError(error)) {
        await keychainPendingRouteStore.complete(handle);
        await completeReturnIfCurrent();
        setPhase('terminal');
      } else {
        setPhase('unavailable');
      }
    } finally {
      redeemFlightRef.current = false;
      if (!controller.signal.aborted) setRedeeming(false);
      if (redeemControllerRef.current === controller) {
        redeemControllerRef.current = null;
      }
    }
  }, [
    accountId,
    client,
    completeReturnIfCurrent,
    handle,
    navigation,
    reloadSession,
    status,
  ]);

  useEffect(() => {
    loadPreview().catch(() => undefined);
  }, [loadPreview]);

  useEffect(
    () => () => {
      loadControllerRef.current?.abort();
      redeemControllerRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (
      (route.params.autoRedeem || resumingAuthReturn) &&
      preview &&
      status === 'ready' &&
      !autoRedeemedRef.current
    ) {
      autoRedeemedRef.current = true;
      redeem().catch(() => undefined);
    }
  }, [preview, redeem, resumingAuthReturn, route.params.autoRedeem, status]);

  return (
    <InvitePreviewView
      onBackToEvents={() => navigation.navigate('Events')}
      onRedeem={redeem}
      onRetry={loadPreview}
      onRetrySession={() => {
        reloadSession().catch(() => undefined);
      }}
      onSwitchAccount={switchAccount}
      phase={phase}
      preview={preview}
      redeeming={redeeming}
      sessionStatus={status}
    />
  );
}

export function InvitePreviewView({
  onBackToEvents,
  onRedeem,
  onRetry,
  onRetrySession,
  onSwitchAccount,
  phase,
  preview,
  redeeming,
  sessionStatus,
}: {
  onBackToEvents(): void;
  onRedeem(): void;
  onRetry(): void;
  onRetrySession(): void;
  onSwitchAccount(): void;
  phase: InvitePreviewPhase;
  preview: InvitePreview | null;
  redeeming: boolean;
  sessionStatus: PrivateNavigationStatus;
}) {
  if (phase === 'loading') {
    return (
      <ScreenFrame
        description="Es werden noch keine privaten Event-Daten angezeigt."
        eyebrow="EINLADUNG"
        icon={crew}
        liveRegion="polite"
        statusLabel="EINLADUNG WIRD GEPRÜFT"
        testID="invite-preview-loading"
        title="Einladung wird geprüft"
        tone="lavender"
      >
        <ActivityIndicator
          accessibilityLabel="Einladung wird geprüft"
          color={colors.textSecondary}
          size="large"
        />
        <Text style={styles.message}>
          Es wurde noch keine Mitgliedschaft erstellt.
        </Text>
      </ScreenFrame>
    );
  }

  if (phase === 'accountMismatch') {
    return (
      <ScreenFrame
        description="Verwende die E-Mail-Adresse, an die diese Einladung gesendet wurde."
        eyebrow="EINLADUNG"
        icon={cloudOffline}
        liveRegion="assertive"
        statusLabel="EINGELADENE E-MAIL VERWENDEN"
        testID="invite-preview-account-mismatch"
        title="Anderes Konto erforderlich"
        tone="brand"
      >
        <Text accessibilityRole="alert" style={styles.message}>
          Diese Einladung kann mit dem aktuellen Zugang nicht angenommen werden.
          Es wurde keine Mitgliedschaft erstellt.
        </Text>
        <Button
          icon={<ScreenIcon source={arrowRight} />}
          label="Konto wechseln"
          loading={redeeming}
          onPress={onSwitchAccount}
          style={styles.action}
          testID="invite-switch-account"
          variant="action"
        />
      </ScreenFrame>
    );
  }

  if (phase === 'terminal') {
    return (
      <ScreenFrame
        description="Diese Einladung ist nicht verfügbar. Es wurde keine Mitgliedschaft erstellt."
        eyebrow="EINLADUNG"
        icon={cloudOffline}
        liveRegion="assertive"
        statusLabel="EINLADUNG NICHT VERFÜGBAR"
        testID="invite-preview-terminal"
        title="Einladung nicht verfügbar"
        tone="brand"
      >
        <Text accessibilityRole="alert" style={styles.message}>
          Es werden keine Angaben zu einem Konto oder geschützten Event
          bestätigt.
        </Text>
        <Button
          icon={<ScreenIcon source={arrowRight} />}
          label="Zu Events"
          onPress={onBackToEvents}
          style={styles.action}
          testID="invite-terminal-events"
          variant="action"
        />
      </ScreenFrame>
    );
  }

  if (!preview || phase === 'unavailable') {
    return (
      <ScreenFrame
        description="Einladung konnte nicht geprüft werden. Es wurde keine Mitgliedschaft erstellt."
        eyebrow="EINLADUNG"
        icon={cloudOffline}
        liveRegion="assertive"
        statusLabel="PRÜFUNG UNTERBROCHEN"
        testID="invite-preview-retryable"
        title="Einladung nicht verfügbar"
        tone="brand"
      >
        <Text accessibilityRole="alert" style={styles.message}>
          Der geschützte Link bleibt auf diesem Gerät erhalten.
        </Text>
        <Button
          icon={<ScreenIcon source={arrowRight} />}
          label="Erneut versuchen"
          onPress={onRetry}
          style={styles.action}
          testID="invite-preview-retry"
          variant="action"
        />
      </ScreenFrame>
    );
  }

  return (
    <ReadyInviteView
      onRedeem={onRedeem}
      onRetrySession={onRetrySession}
      preview={preview}
      redeeming={redeeming}
      sessionStatus={sessionStatus}
    />
  );
}

function ReadyInviteView({
  onRedeem,
  onRetrySession,
  preview,
  redeeming,
  sessionStatus,
}: {
  onRedeem(): void;
  onRetrySession(): void;
  preview: InvitePreview;
  redeeming: boolean;
  sessionStatus: PrivateNavigationStatus;
}) {
  const signedOut = sessionStatus === 'signedOut';
  const ready = sessionStatus === 'ready';
  const loading = sessionStatus === 'loading';
  const statusLabel = redeeming
    ? 'EINLADUNG WIRD ANGENOMMEN'
    : signedOut
    ? 'ANMELDUNG ERFORDERLICH'
    : ready
    ? 'BEREIT ZUM BEITRITT'
    : loading
    ? 'ZUGANG WIRD VORBEREITET'
    : 'ZUGANG NICHT VERFÜGBAR';
  const tone = ready && !redeeming ? 'action' : loading ? 'lavender' : 'brand';

  return (
    <ScreenFrame
      description={preview.title}
      eyebrow="EINLADUNG"
      icon={ready ? check : crew}
      liveRegion="polite"
      statusLabel={statusLabel}
      testID="invite-preview-ready"
      title="Du wurdest eingeladen"
      tone={tone}
    >
      <View style={styles.details}>
        <Text style={styles.detailLabel}>DEINE ROLLE</Text>
        <Text style={styles.detailValue}>{roleLabel(preview.role)}</Text>
        {preview.emailBound ? (
          <StatusChip label="An eingeladene E-Mail gebunden" tone="lavender" />
        ) : null}
      </View>
      {loading ? (
        <>
          <ActivityIndicator
            accessibilityLabel="Zugang wird vorbereitet"
            color={colors.textSecondary}
            size="large"
          />
          <Text style={styles.message}>
            Die Einladung bleibt erhalten. Es wurde noch keine Mitgliedschaft
            bestätigt.
          </Text>
        </>
      ) : null}
      {sessionStatus === 'unavailable' ? (
        <>
          <Text accessibilityRole="alert" style={styles.message}>
            Der sichere Zugang ist gerade nicht verfügbar. Die Einladung wurde
            nicht angenommen.
          </Text>
          <Button
            icon={<ScreenIcon source={arrowRight} />}
            label="Zugang erneut prüfen"
            onPress={onRetrySession}
            style={styles.action}
            testID="invite-session-retry"
            variant="action"
          />
        </>
      ) : null}
      {signedOut || ready ? (
        <Button
          icon={<ScreenIcon source={arrowRight} />}
          label={
            redeeming
              ? 'Einladung wird angenommen'
              : signedOut
              ? 'Mit E-Mail fortfahren'
              : 'Einladung annehmen'
          }
          loading={redeeming}
          onPress={onRedeem}
          style={styles.action}
          testID="invite-redeem"
          variant="action"
        />
      ) : null}
    </ScreenFrame>
  );
}

function roleLabel(role: InvitePreview['role']) {
  switch (role) {
    case 'organizer':
      return 'Organisation';
    case 'participant':
      return 'Teilnahme';
    case 'viewer':
      return 'Ansicht';
  }
}

const styles = StyleSheet.create({
  action: {
    alignSelf: 'stretch',
    marginTop: spacing.xs,
  },
  detailLabel: {
    ...typography.overline,
    color: colors.text,
  },
  detailValue: {
    ...typography.heading,
    color: colors.text,
  },
  details: {
    gap: spacing.sm,
  },
  message: {
    ...typography.body,
    color: colors.text,
  },
});
