import {
  ActorEventRootIndexAccessDeniedError,
  ActorEventRootIndexAccountChangedError,
  type ActorEventRootIndexEntry,
  type ActorEventRootIndexState,
  ActorEventRootIndexStore,
  LocalAttachmentStore,
} from '@crew/mobile-data';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { isSessionFailure } from '../app/flowErrors';
import { useGatewayClient } from '../app/GatewayProvider';
import {
  usePrivateDatabase,
  usePrivateSessionLifecycle,
} from '../app/PrivateBootstrapGate';
import { reconcileRetainedAttachmentFiles } from '../media/attachmentMedia';
import type { RootStackParamList } from '../navigation/types';
import {
  EventsView,
  type EventsViewEvent,
  type EventsViewState,
} from './EventsView';

type Props = NativeStackScreenProps<RootStackParamList, 'Events'>;

type ScreenState =
  | { key: string; status: 'loading' }
  | {
      index: ActorEventRootIndexStore;
      key: string;
      status: 'ready';
      view: EventsViewState;
    };

export function EventsScreen({ navigation }: Props) {
  const client = useGatewayClient();
  const privateDatabase = usePrivateDatabase();
  const lifecycle = usePrivateSessionLifecycle();
  const { accountId, reloadSession, status } = lifecycle;
  const activeAccountRef = useRef(accountId);
  activeAccountRef.current = accountId;
  const privateDatabaseAccountRef = useRef(privateDatabase.accountId);
  privateDatabaseAccountRef.current = privateDatabase.accountId;
  const lifecycleRef = useRef(lifecycle);
  lifecycleRef.current = lifecycle;
  const logoutAttemptRef = useRef<'confirming' | 'idle' | 'pending'>('idle');
  const logoutAccountRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const [logoutState, setLogoutState] = useState<'failed' | 'idle' | 'pending'>(
    'idle',
  );
  const scopeKey =
    status === 'ready' && accountId === privateDatabase.accountId
      ? privateDatabase.accountId
      : null;
  const [refreshRequest, setRefreshRequest] = useState(0);
  const [state, setState] = useState<ScreenState>({
    key: scopeKey ?? '',
    status: 'loading',
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const resetLogoutConfirmation = () => {
    if (logoutAttemptRef.current !== 'confirming') return;
    logoutAttemptRef.current = 'idle';
    logoutAccountRef.current = null;
  };

  const confirmLogout = async () => {
    if (logoutAttemptRef.current !== 'confirming') return;
    const expectedAccountId = logoutAccountRef.current;
    const current = lifecycleRef.current;
    if (
      !expectedAccountId ||
      current.status !== 'ready' ||
      current.accountId !== expectedAccountId ||
      privateDatabaseAccountRef.current !== expectedAccountId
    ) {
      resetLogoutConfirmation();
      return;
    }

    logoutAttemptRef.current = 'pending';
    setLogoutState('pending');
    try {
      await current.replaceSession(null, expectedAccountId);
    } catch {
      logoutAttemptRef.current = 'idle';
      logoutAccountRef.current = null;
      const latest = lifecycleRef.current;
      if (
        mountedRef.current &&
        latest.status === 'ready' &&
        latest.accountId === expectedAccountId &&
        privateDatabaseAccountRef.current === expectedAccountId
      ) {
        setLogoutState('failed');
        Alert.alert(
          'Abmelden nicht abgeschlossen',
          'Deine Sitzung konnte nicht sicher beendet werden. Bitte versuche es erneut.',
        );
      }
    }
  };

  const requestLogout = () => {
    const current = lifecycleRef.current;
    if (
      logoutAttemptRef.current !== 'idle' ||
      current.status !== 'ready' ||
      current.accountId !== privateDatabaseAccountRef.current
    ) {
      return;
    }
    logoutAttemptRef.current = 'confirming';
    logoutAccountRef.current = current.accountId;
    Alert.alert(
      'Abmelden?',
      'Deine Sitzung wird beendet. Zurückgehaltene Feedback-Daten werden vorher von diesem Gerät entfernt.',
      [
        {
          onPress: resetLogoutConfirmation,
          style: 'cancel',
          text: 'Abbrechen',
        },
        {
          onPress: () => {
            confirmLogout().catch(() => undefined);
          },
          style: 'destructive',
          text: 'Abmelden',
        },
      ],
      { cancelable: true, onDismiss: resetLogoutConfirmation },
    );
  };

  useEffect(() => {
    if (!scopeKey) {
      setState({ key: '', status: 'loading' });
      return;
    }
    let cancelled = false;
    const accountUserId = privateDatabase.accountId;
    const index = new ActorEventRootIndexStore(
      privateDatabase.database,
      client ?? undefined,
      { activeAccountUserId: () => activeAccountRef.current },
    );
    const publish = (view: EventsViewState) => {
      if (!cancelled && activeAccountRef.current === accountUserId) {
        setState({ index, key: scopeKey, status: 'ready', view });
      }
    };

    (async () => {
      const [cachedEntries, cachedState] = await Promise.all([
        index.list(accountUserId),
        index.getState(accountUserId),
      ]);
      if (cachedState) {
        publish(
          cachedView(
            cachedEntries,
            cachedState,
            client ? 'refreshing' : 'offline',
          ),
        );
      } else if (!client) {
        publish({ kind: 'error', retryable: false });
        return;
      } else if (refreshRequest > 0) {
        publish({ kind: 'error', retryable: true, retrying: true });
      } else {
        setState({ key: scopeKey, status: 'loading' });
      }
      if (!client) return;

      try {
        const refreshedState = await index.refresh(accountUserId);
        await reconcileRetainedAttachmentFiles(
          new LocalAttachmentStore(privateDatabase.database),
          accountUserId,
        );
        publish(
          cachedView(await index.list(accountUserId), refreshedState, 'fresh'),
        );
      } catch (error) {
        if (error instanceof ActorEventRootIndexAccountChangedError) return;
        if (error instanceof ActorEventRootIndexAccessDeniedError) {
          await reconcileRetainedAttachmentFiles(
            new LocalAttachmentStore(privateDatabase.database),
            accountUserId,
          );
          publish({ kind: 'error', retryable: false });
          return;
        }
        if (isSessionFailure(error)) {
          reloadSession().catch(() => undefined);
        }
        publish(
          cachedState
            ? cachedView(cachedEntries, cachedState, 'offline')
            : { kind: 'error', retryable: true },
        );
      }
    })().catch(() => publish({ kind: 'error', retryable: false }));

    return () => {
      cancelled = true;
    };
  }, [
    client,
    privateDatabase.accountId,
    privateDatabase.database,
    reloadSession,
    refreshRequest,
    scopeKey,
  ]);

  const view =
    state.status === 'ready' && state.key === scopeKey
      ? state.view
      : ({ kind: 'loading' } satisfies EventsViewState);

  return (
    <EventsView
      logoutError={logoutState === 'failed'}
      logoutLoading={logoutState === 'pending'}
      onCreate={
        scopeKey
          ? () => {
              navigation.navigate('CreateEvent');
            }
          : undefined
      }
      onLogout={scopeKey ? requestLogout : undefined}
      onRetry={
        client &&
        (view.kind === 'error' ||
          (view.kind === 'ready' && view.phase === 'offline') ||
          (view.kind === 'empty' && view.phase === 'offline'))
          ? () => setRefreshRequest(value => value + 1)
          : undefined
      }
      onSelect={rootEventId => {
        if (state.status !== 'ready' || state.key !== scopeKey || !scopeKey) {
          return;
        }
        state.index
          .select(scopeKey, rootEventId)
          .then(() => {
            if (activeAccountRef.current === scopeKey) {
              navigation.navigate('EventInbound', { rootEventId });
            }
          })
          .catch(() => undefined);
      }}
      state={view}
    />
  );
}

function cachedView(
  entries: readonly ActorEventRootIndexEntry[],
  state: ActorEventRootIndexState,
  phase: 'fresh' | 'offline' | 'refreshing',
): EventsViewState {
  return entries.length === 0
    ? { kind: 'empty', phase, refreshedAt: state.refreshedAt }
    : {
        events: entries.map(toViewEvent),
        kind: 'ready',
        phase,
        refreshedAt: state.refreshedAt,
      };
}

function toViewEvent(event: ActorEventRootIndexEntry): EventsViewEvent {
  return {
    endsAt: event.endsAt,
    kind: event.kind,
    membershipStatus: event.membershipStatus,
    role: event.role,
    rootEventId: event.rootEventId,
    startsAt: event.startsAt,
    status: event.status,
    timeZone: event.timeZone,
    title: event.title,
  };
}
