import { GatewayClientError } from '@crew/mobile-client';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { isSessionFailure } from '../app/flowErrors';
import { useGatewayClient } from '../app/GatewayProvider';
import { usePrivateSessionLifecycle } from '../app/PrivateBootstrapGate';
import { Button } from '../design/primitives';
import { colors, spacing, typography } from '../design/theme';
import type { RootStackParamList } from '../navigation/types';
import { ScreenFrame, ScreenIcon } from './ScreenFrame';

const arrowRight = require('../assets/icons/arrow-right.png');
const check = require('../assets/icons/check.png');
const cloudOffline = require('../assets/icons/cloud-offline.png');

type PrivateInboundRoute =
  | 'EventInbound'
  | 'ItemInbound'
  | 'FeedInbound'
  | 'FeedbackInbound'
  | 'RecapInbound';

type PrivateInboundRouteProp = {
  [Name in PrivateInboundRoute]: RouteProp<RootStackParamList, Name>;
}[PrivateInboundRoute];

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList>;
  route: PrivateInboundRouteProp;
};

export type InboundGateViewState =
  | { kind: 'loading' }
  | { kind: 'ready'; title: string }
  | { kind: 'retryable'; retrying?: boolean }
  | { kind: 'unavailable' };

export function InboundGateScreen({ navigation, route }: Props) {
  const client = useGatewayClient();
  const { accountId, reloadSession } = usePrivateSessionLifecycle();
  const target = eventTarget(route);
  const event = useQuery({
    enabled: Boolean(client && accountId && target),
    queryKey: [
      'private',
      accountId,
      'event',
      target?.rootEventId,
      target?.eventId,
    ],
    queryFn: async () => {
      if (!client || !target) throw new Error('Event unavailable');
      return (
        await client.request('eventsGet', {
          path: target,
        })
      ).data.event;
    },
  });

  useEffect(() => {
    if (isSessionFailure(event.error)) {
      reloadSession().catch(() => undefined);
    }
  }, [event.error, reloadSession]);

  let state: InboundGateViewState;
  if (!target || !client) {
    state = { kind: 'unavailable' };
  } else if (event.isPending) {
    state = { kind: 'loading' };
  } else if (event.isError) {
    state = isRetryable(event.error)
      ? { kind: 'retryable', retrying: event.isFetching }
      : { kind: 'unavailable' };
  } else {
    state = { kind: 'ready', title: event.data.title };
  }

  return (
    <InboundGateView
      onEvents={() => navigation.navigate('Events')}
      onRetry={() => {
        event.refetch().catch(() => undefined);
      }}
      state={state}
    />
  );
}

export function InboundGateView({
  onEvents,
  onRetry,
  state,
}: {
  onEvents(): void;
  onRetry(): void;
  state: InboundGateViewState;
}) {
  if (state.kind === 'loading') {
    return (
      <ScreenFrame
        description="Zugriff wird geprüft. Private Inhalte bleiben verborgen."
        eyebrow="GESCHÜTZTER INHALT"
        icon={cloudOffline}
        liveRegion="polite"
        statusLabel="MITGLIEDSCHAFT WIRD GEPRÜFT"
        testID="inbound-gate-loading"
        title="Event wird geprüft"
        tone="lavender"
      >
        <ActivityIndicator
          accessibilityLabel="Zugriff wird geprüft"
          color={colors.textSecondary}
          size="large"
        />
        <Text style={styles.message}>
          Bis zur Bestätigung werden keine Eventdetails angezeigt.
        </Text>
      </ScreenFrame>
    );
  }

  if (state.kind === 'retryable') {
    return (
      <ScreenFrame
        description="Zugriff konnte nicht geprüft werden. Private Inhalte bleiben verborgen."
        eyebrow="GESCHÜTZTER INHALT"
        icon={cloudOffline}
        liveRegion="assertive"
        statusLabel="PRÜFUNG UNTERBROCHEN"
        testID="inbound-gate-retryable"
        title="Zugriff nicht bestätigt"
        tone="brand"
      >
        <Text accessibilityRole="alert" style={styles.message}>
          Es wurde kein geschütztes Ziel geöffnet.
        </Text>
        <Button
          icon={<ScreenIcon source={arrowRight} />}
          label="Erneut versuchen"
          loading={state.retrying}
          onPress={onRetry}
          style={styles.action}
          testID="inbound-gate-retry"
          variant="action"
        />
      </ScreenFrame>
    );
  }

  if (state.kind === 'unavailable') {
    return (
      <ScreenFrame
        description="Dieser Inhalt ist nicht verfügbar."
        eyebrow="GESCHÜTZTER INHALT"
        icon={cloudOffline}
        liveRegion="assertive"
        statusLabel="ZUGRIFF NICHT VERFÜGBAR"
        testID="inbound-gate-unavailable"
        title="Inhalt nicht verfügbar"
        tone="brand"
      >
        <Text accessibilityRole="alert" style={styles.message}>
          Es werden keine Angaben zum geschützten Ziel bestätigt.
        </Text>
        <Button
          icon={<ScreenIcon source={arrowRight} />}
          label="Zu Events"
          onPress={onEvents}
          style={styles.action}
          testID="inbound-gate-events"
          variant="action"
        />
      </ScreenFrame>
    );
  }

  return (
    <ScreenFrame
      description="Dieses Event ist für dein aktuelles Konto verfügbar."
      eyebrow="ZUGRIFF BESTÄTIGT"
      icon={check}
      liveRegion="polite"
      statusLabel="SICHER GEÖFFNET"
      testID="inbound-gate-ready"
      title={state.title}
      tone="action"
    >
      <Text style={styles.message}>
        Du siehst nur Inhalte, die für deine Mitgliedschaft freigegeben sind.
      </Text>
    </ScreenFrame>
  );
}

function isRetryable(error: unknown) {
  return !(error instanceof GatewayClientError) || error.retryable;
}

function eventTarget(route: PrivateInboundRouteProp) {
  switch (route.name) {
    case 'EventInbound':
    case 'FeedInbound':
    case 'RecapInbound':
      return {
        rootEventId: route.params.rootEventId,
        eventId: route.params.rootEventId,
      };
    case 'ItemInbound':
      return {
        rootEventId: route.params.rootEventId,
        eventId: route.params.itemId,
      };
    case 'FeedbackInbound':
      return null;
  }
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
