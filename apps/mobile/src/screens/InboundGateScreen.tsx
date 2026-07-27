import { GatewayClientError } from '@crew/mobile-client';
import {
  LocalAttachmentStore,
  MobileDataStore,
  MobileSyncAccountChangedError,
  MobileSyncEngine,
  MobileSyncRootAccessDeniedError,
} from '@crew/mobile-data';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { isSessionFailure } from '../app/flowErrors';
import { useGatewayClient } from '../app/GatewayProvider';
import {
  usePrivateDatabase,
  usePrivateSessionLifecycle,
} from '../app/PrivateBootstrapGate';
import { Button } from '../design/primitives';
import { colors, spacing, typography } from '../design/theme';
import { reconcileRetainedAttachmentFiles } from '../media/attachmentMedia';
import type { RootStackParamList } from '../navigation/types';
import { deniedRootRegistry } from '../storage/deniedRoots';
import { secureUuidV4 } from '../storage/secureRandom';
import { ScreenFrame, ScreenIcon } from './ScreenFrame';

const arrowRight = require('../assets/icons/arrow-right.png');
const check = require('../assets/icons/check.png');
const cloudOffline = require('../assets/icons/cloud-offline.png');
const EVENT_ID = /^evt_[A-Za-z0-9._:-]{1,96}$/;
const FEED_ID = /^fed_[A-Za-z0-9._:-]{1,96}$/;
const ITEM_ID = /^iti_[A-Za-z0-9._:-]{1,96}$/;

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
  const privateDatabase = usePrivateDatabase();
  const { accountId, reloadSession } = usePrivateSessionLifecycle();
  const activeAccountRef = useRef(accountId);
  activeAccountRef.current = accountId;
  const target = eventTarget(route);
  const syncEngine = useMemo(
    () =>
      client && (route.name === 'ItemInbound' || route.name === 'FeedInbound')
        ? new MobileSyncEngine(privateDatabase.database, client, {
            activeAccountUserId: () => activeAccountRef.current,
            randomUUID: secureUuidV4,
            onRootReadStarted: (activeAccountId, rootEventId) =>
              deniedRootRegistry.arm(activeAccountId, rootEventId),
            onRootReadFinished: (
              activeAccountId,
              rootEventId,
              verificationId,
            ) =>
              deniedRootRegistry.finish(
                activeAccountId,
                rootEventId,
                verificationId,
              ),
            onRootPurged: activeAccountId =>
              reconcileRetainedAttachmentFiles(
                new LocalAttachmentStore(privateDatabase.database),
                activeAccountId,
              ),
          })
        : null,
    [client, privateDatabase.database, route.name],
  );
  const event = useQuery({
    enabled: Boolean(
      client && accountId && accountId === privateDatabase.accountId && target,
    ),
    queryKey: [
      'private',
      accountId,
      'inbound',
      route.name,
      target?.rootEventId,
      route.name === 'ItemInbound'
        ? route.params.itemId
        : route.name === 'FeedInbound'
        ? route.params.entryId
        : target?.eventId,
    ],
    queryFn: async () => {
      if (!client || !target || !accountId) {
        throw new Error('Event unavailable');
      }
      const authorizedEvent = (
        await client.request('eventsGet', {
          path: target,
        })
      ).data.event;
      if (route.name !== 'ItemInbound' && route.name !== 'FeedInbound') {
        return {
          eventId: authorizedEvent.id,
          id: authorizedEvent.id,
          title: authorizedEvent.title,
        };
      }
      if (!syncEngine) throw new Error('Event unavailable');
      await syncEngine.syncRoot(accountId, route.params.rootEventId);
      if (activeAccountRef.current !== accountId) {
        throw new MobileSyncAccountChangedError();
      }
      const store = new MobileDataStore(privateDatabase.database);
      if (route.name === 'ItemInbound') {
        const record = (
          await store.listTimeline(accountId, route.params.rootEventId)
        ).find(item => item.id === route.params.itemId);
        if (activeAccountRef.current !== accountId) {
          throw new MobileSyncAccountChangedError();
        }
        return record &&
          record.accountUserId === accountId &&
          record.rootEventId === route.params.rootEventId &&
          record.deletedAt === null
          ? {
              eventId: record.eventId,
              id: record.id,
              title: authorizedEvent.title,
            }
          : {
              eventId: route.params.rootEventId,
              id: route.params.rootEventId,
              title: authorizedEvent.title,
            };
      }
      const record = (
        await store.listFeed(accountId, route.params.rootEventId)
      ).find(entry => entry.id === route.params.entryId);
      if (activeAccountRef.current !== accountId) {
        throw new MobileSyncAccountChangedError();
      }
      return record &&
        record.accountUserId === accountId &&
        record.rootEventId === route.params.rootEventId &&
        record.deletedAt === null &&
        (record.eventId === null || matches(EVENT_ID, record.eventId))
        ? {
            eventId: record.eventId,
            id: record.id,
            title: authorizedEvent.title,
          }
        : null;
    },
  });

  useEffect(() => {
    if (!event.data) return;
    if (route.name === 'ItemInbound') {
      if (event.data.id === route.params.itemId) {
        navigation.replace('LiveItem', {
          itemId: event.data.id,
          rootEventId: route.params.rootEventId,
        });
      } else {
        navigation.replace('Plan', {
          rootEventId: route.params.rootEventId,
        });
      }
    } else if (route.name === 'FeedInbound') {
      navigation.replace('TeamFeed', {
        eventId: event.data.eventId,
        focusEntryId: event.data.id,
        rootEventId: route.params.rootEventId,
      });
    }
  }, [event.data, navigation, route]);

  useEffect(() => {
    if (isSessionFailure(event.error)) {
      reloadSession().catch(() => undefined);
    }
  }, [event.error, reloadSession]);

  let state: InboundGateViewState;
  if (
    !target ||
    !client ||
    !accountId ||
    accountId !== privateDatabase.accountId
  ) {
    state = { kind: 'unavailable' };
  } else if (event.isPending) {
    state = { kind: 'loading' };
  } else if (event.isError) {
    state = isRetryable(event.error)
      ? { kind: 'retryable', retrying: event.isFetching }
      : { kind: 'unavailable' };
  } else if (!event.data) {
    state = { kind: 'unavailable' };
  } else if (route.name === 'ItemInbound' || route.name === 'FeedInbound') {
    state = { kind: 'loading' };
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
  if (
    error instanceof MobileSyncAccountChangedError ||
    error instanceof MobileSyncRootAccessDeniedError
  ) {
    return false;
  }
  return !(error instanceof GatewayClientError) || error.retryable;
}

function eventTarget(route: PrivateInboundRouteProp) {
  switch (route.name) {
    case 'EventInbound':
    case 'RecapInbound':
      return matches(EVENT_ID, route.params.rootEventId)
        ? {
            rootEventId: route.params.rootEventId,
            eventId: route.params.rootEventId,
          }
        : null;
    case 'ItemInbound':
      return matches(EVENT_ID, route.params.rootEventId) &&
        matches(ITEM_ID, route.params.itemId)
        ? {
            rootEventId: route.params.rootEventId,
            eventId: route.params.rootEventId,
          }
        : null;
    case 'FeedInbound':
      return matches(EVENT_ID, route.params.rootEventId) &&
        matches(FEED_ID, route.params.entryId)
        ? {
            rootEventId: route.params.rootEventId,
            eventId: route.params.rootEventId,
          }
        : null;
    case 'FeedbackInbound':
      return null;
  }
}

function matches(pattern: RegExp, value: unknown): value is string {
  return typeof value === 'string' && pattern.test(value);
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
