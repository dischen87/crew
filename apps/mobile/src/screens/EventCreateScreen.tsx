import type { GatewayClient, GatewayResponseData } from '@crew/mobile-client';
import {
  ActorEventRootIndexAccountChangedError,
  ActorEventRootIndexStore,
  MobileSyncAccountChangedError,
  MobileSyncEngine,
  type OutboxItem,
  type RootCreateCommand,
  type SyncStatus,
} from '@crew/mobile-data';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isSessionFailure } from '../app/flowErrors';
import { useGatewayClient } from '../app/GatewayProvider';
import {
  usePrivateDatabase,
  usePrivateSessionLifecycle,
} from '../app/PrivateBootstrapGate';
import type { RootStackParamList } from '../navigation/types';
import { secureDeviceIdStore } from '../storage/deviceIdentity';
import { secureUuidV4 } from '../storage/secureRandom';
import {
  EventCreateView,
  type EventCreateOption,
  type EventCreateViewState,
} from './EventCreateView';

type Props = NativeStackScreenProps<RootStackParamList, 'CreateEvent'>;
type EventTemplate =
  GatewayResponseData<'eventTemplatesList'>['templates'][number];

const blankOption: EventCreateOption = {
  id: 'blank',
  kind: 'blank',
  logicalKeys: [],
  rootKind: 'other',
  summary:
    'Ein leerer Entwurf. Struktur, Termine und Inhalte ergänzt du später.',
  title: 'Leeres Event',
};

const templateCopy = {
  travel: {
    summary: 'Anreise, Unterkunft und gemeinsamer Transport.',
    title: 'Reise',
  },
  'golf-tour': {
    summary: 'Reise, Unterkunft, Transfers, Golfplätze und Runden.',
    title: 'Golfreise',
  },
  'team-event': {
    summary: 'Ort, Agenda, Aktivitäten und Teameinteilung.',
    title: 'Team-Event',
  },
} as const;

const unavailableGatewayClient = {
  request: (() =>
    Promise.reject(
      new Error('Gateway unavailable'),
    )) as unknown as GatewayClient['request'],
};

export function EventCreateScreen({ navigation }: Props) {
  const client = useGatewayClient();
  const privateDatabase = usePrivateDatabase();
  const { accountId, reloadSession, status } = usePrivateSessionLifecycle();
  const activeAccountRef = useRef(accountId);
  activeAccountRef.current = accountId;
  const scopeKey =
    status === 'ready' && accountId === privateDatabase.accountId
      ? privateDatabase.accountId
      : null;
  const [state, setState] = useState<EventCreateViewState>({ kind: 'loading' });
  const stateRef = useRef<EventCreateViewState>(state);
  const shapeRef = useRef<Extract<
    EventCreateViewState,
    { kind: 'shape' }
  > | null>(null);
  const draftRef = useRef<{
    description: string;
    option: EventCreateOption;
    timeZone: string;
    title: string;
  } | null>(null);
  const failedCreationRef = useRef<OutboxItem | null>(null);
  const reviewingFailedRef = useRef(false);
  const mountedRef = useRef(true);
  const submissionFlightRef = useRef<Promise<void> | null>(null);
  const syncFlightRef = useRef<Promise<void> | null>(null);
  const templateFlightRef = useRef<Promise<void> | null>(null);
  const templateControllerRef = useRef<AbortController | null>(null);
  const syncEngine = useMemo(
    () =>
      scopeKey
        ? new MobileSyncEngine(
            privateDatabase.database,
            client ?? unavailableGatewayClient,
            {
              activeAccountUserId: () => activeAccountRef.current,
              randomUUID: secureUuidV4,
            },
          )
        : null,
    [client, privateDatabase.database, scopeKey],
  );

  const publish = useCallback(
    (next: EventCreateViewState) => {
      if (!mountedRef.current) return;
      if (scopeKey && activeAccountRef.current !== scopeKey) return;
      stateRef.current = next;
      if (next.kind === 'shape') shapeRef.current = next;
      setState(next);
    },
    [scopeKey],
  );

  const loadTemplates = useCallback(
    (retrying: boolean) => {
      if (templateFlightRef.current) return templateFlightRef.current;
      const previous = shapeRef.current;
      const selectedId = previous?.selectedId ?? null;
      if (!client) {
        publish({
          kind: 'shape',
          options: [blankOption],
          retryingTemplates: false,
          selectedId: selectedId === 'blank' ? 'blank' : null,
          templatesUnavailable: true,
        });
        return Promise.resolve();
      }
      const controller = new AbortController();
      templateControllerRef.current?.abort();
      templateControllerRef.current = controller;
      if (retrying) {
        publish({
          kind: 'shape',
          options: previous?.options ?? [blankOption],
          retryingTemplates: true,
          selectedId,
          templatesUnavailable: previous?.templatesUnavailable ?? false,
        });
      }
      const flight = (async () => {
        try {
          const response = await client.request('eventTemplatesList', {
            signal: controller.signal,
          });
          if (controller.signal.aborted) return;
          const options = eventCreateOptions(response.data.templates);
          publish({
            kind: 'shape',
            options,
            retryingTemplates: false,
            selectedId: options.some(option => option.id === selectedId)
              ? selectedId
              : null,
            templatesUnavailable: options.length === 1,
          });
        } catch (error) {
          if (controller.signal.aborted) return;
          if (isSessionFailure(error)) {
            reloadSession().catch(() => undefined);
          }
          publish({
            kind: 'shape',
            options: [blankOption],
            retryingTemplates: false,
            selectedId: selectedId === 'blank' ? 'blank' : null,
            templatesUnavailable: true,
          });
        }
      })().finally(() => {
        if (templateFlightRef.current === flight) {
          templateFlightRef.current = null;
        }
        if (templateControllerRef.current === controller) {
          templateControllerRef.current = null;
        }
      });
      templateFlightRef.current = flight;
      return flight;
    },
    [client, publish, reloadSession],
  );

  const syncAndOpen = useCallback(
    (rootEventId: string, title: string, force: boolean) => {
      if (syncFlightRef.current) return syncFlightRef.current;
      if (!scopeKey || !syncEngine || !client) {
        publish({
          kind: 'queued',
          mode: 'offline',
          recovery: 'retry',
          retrying: false,
          rootEventId,
          title,
        });
        return Promise.resolve();
      }
      publish({
        kind: 'queued',
        mode: 'syncing',
        recovery: 'none',
        retrying: force,
        rootEventId,
        title,
      });
      const accountUserId = scopeKey;
      const flight = (async () => {
        try {
          if (force) {
            await syncEngine.retryExhausted(accountUserId, rootEventId);
          }
          const syncStatus = await syncEngine.syncRoot(
            accountUserId,
            rootEventId,
            { force },
          );
          if (activeAccountRef.current !== accountUserId) return;
          if (syncStatus.state !== 'synced') {
            const pending = (
              await syncEngine.listRootCreations(accountUserId)
            )[0];
            if (activeAccountRef.current !== accountUserId) return;
            if (pending) {
              failedCreationRef.current =
                pending.state === 'dead_letter' ? pending : null;
              publish(queuedState(pending));
            } else {
              publish({
                kind: 'queued',
                mode: retryMode(syncStatus),
                recovery:
                  syncStatus.state === 'needs_attention' ? 'none' : 'retry',
                retrying: false,
                rootEventId,
                title,
              });
            }
            return;
          }

          const index = new ActorEventRootIndexStore(
            privateDatabase.database,
            client,
            { activeAccountUserId: () => activeAccountRef.current },
          );
          try {
            await index.refresh(accountUserId);
            if (await index.get(accountUserId, rootEventId)) {
              await index.select(accountUserId, rootEventId);
            }
          } catch (error) {
            if (error instanceof ActorEventRootIndexAccountChangedError) return;
            if (isSessionFailure(error)) {
              reloadSession().catch(() => undefined);
            }
          }
          if (activeAccountRef.current === accountUserId) {
            navigation.replace('EventInbound', { rootEventId });
          }
        } catch (error) {
          if (error instanceof MobileSyncAccountChangedError) return;
          if (isSessionFailure(error)) {
            reloadSession().catch(() => undefined);
          }
          const pending = (
            await syncEngine.listRootCreations(accountUserId).catch(() => [])
          )[0];
          if (activeAccountRef.current !== accountUserId) return;
          if (pending) {
            failedCreationRef.current =
              pending.state === 'dead_letter' ? pending : null;
            publish(queuedState(pending));
          } else {
            publish({
              kind: 'queued',
              mode: 'attention',
              recovery: 'none',
              retrying: false,
              rootEventId,
              title,
            });
          }
        }
      })().finally(() => {
        if (syncFlightRef.current === flight) syncFlightRef.current = null;
      });
      syncFlightRef.current = flight;
      return flight;
    },
    [
      client,
      navigation,
      privateDatabase.database,
      publish,
      reloadSession,
      scopeKey,
      syncEngine,
    ],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      templateControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!scopeKey || !syncEngine) {
      publish({ kind: 'unavailable' });
      return;
    }
    let cancelled = false;
    const accountUserId = scopeKey;
    publish({ kind: 'loading' });
    (async () => {
      const pending = (await syncEngine.listRootCreations(accountUserId))[0];
      if (cancelled || activeAccountRef.current !== accountUserId) return;
      if (pending) {
        const queued = queuedState(pending);
        failedCreationRef.current =
          pending.state === 'dead_letter' ? pending : null;
        publish(queued);
        if (
          client &&
          pending.state !== 'dead_letter' &&
          pending.state !== 'blocked'
        ) {
          await syncAndOpen(pending.rootEventId, queued.title, false);
        }
        return;
      }
      await loadTemplates(false);
    })().catch(error => {
      if (cancelled || activeAccountRef.current !== accountUserId) return;
      if (isSessionFailure(error)) reloadSession().catch(() => undefined);
      publish({ kind: 'unavailable' });
    });
    return () => {
      cancelled = true;
    };
  }, [
    client,
    loadTemplates,
    publish,
    reloadSession,
    scopeKey,
    syncAndOpen,
    syncEngine,
  ]);

  const selectOption = (id: EventCreateOption['id']) => {
    const current = stateRef.current;
    if (current.kind !== 'shape') return;
    if (!current.options.some(option => option.id === id)) return;
    publish({ ...current, selectedId: id });
  };

  const useOption = () => {
    const current = stateRef.current;
    if (current.kind !== 'shape' || current.selectedId === null) return;
    const option = current.options.find(item => item.id === current.selectedId);
    if (!option) return;
    const draft =
      reviewingFailedRef.current || draftRef.current?.option.id === option.id
        ? draftRef.current
        : null;
    const next: Extract<EventCreateViewState, { kind: 'details' }> = {
      description: draft?.description ?? '',
      kind: 'details',
      option,
      submissionError: null,
      submitting: false,
      timeZone: draft?.timeZone ?? deviceTimeZone(),
      title: draft?.title ?? '',
      titleError: null,
    };
    draftRef.current = {
      description: next.description,
      option,
      timeZone: next.timeZone,
      title: next.title,
    };
    publish(next);
  };

  const updateDetails = (
    changes: Partial<Extract<EventCreateViewState, { kind: 'details' }>>,
  ) => {
    const current = stateRef.current;
    if (current.kind !== 'details' || current.submitting) return;
    const next = { ...current, ...changes, submissionError: null };
    draftRef.current = {
      description: next.description,
      option: next.option,
      timeZone: next.timeZone,
      title: next.title,
    };
    publish(next);
  };

  const reviewFailedCreation = () => {
    const failed = failedCreationRef.current;
    if (!failed || pendingRecovery(failed) !== 'review') return;
    const command = failed.command as RootCreateCommand;
    reviewingFailedRef.current = true;
    draftRef.current = {
      description: command.description ?? '',
      option: blankOption,
      timeZone: command.timeZone,
      title: command.title,
    };
    shapeRef.current = null;
    publish({ kind: 'loading' });
    loadTemplates(false)
      .then(() => {
        if (activeAccountRef.current !== failed.accountUserId) return;
        const shape = shapeRef.current;
        if (!shape) return;
        const preferredId = command.template
          ? templateOptionId(command.template.id)
          : 'blank';
        publish({
          ...shape,
          selectedId:
            preferredId &&
            shape.options.some(option => option.id === preferredId)
              ? preferredId
              : null,
        });
      })
      .catch(() => undefined);
  };

  const submit = () => {
    if (submissionFlightRef.current) return submissionFlightRef.current;
    const current = stateRef.current;
    if (current.kind !== 'details' || !scopeKey || !syncEngine) {
      return Promise.resolve();
    }
    const normalizedTitle = current.title.trim();
    if (normalizedTitle.length < 1 || normalizedTitle.length > 160) {
      publish({
        ...current,
        submissionError:
          'Noch nicht gespeichert. Prüfe das markierte Feld; deine übrigen Angaben sind erhalten.',
        titleError: 'Gib einen Titel mit höchstens 160 Zeichen ein.',
      });
      return Promise.resolve();
    }
    publish({
      ...current,
      submissionError: null,
      submitting: true,
      titleError: null,
    });
    const accountUserId = scopeKey;
    const flight = (async () => {
      try {
        const command = buildRootCreateCommand(
          current.option,
          normalizedTitle,
          current.description,
          current.timeZone,
          secureUuidV4,
          reviewingFailedRef.current
            ? failedCreationRef.current?.rootEventId
            : undefined,
        );
        const overlay = {
          kind: command.kind,
          timeZone: command.timeZone,
          title: command.title,
        };
        const failed = failedCreationRef.current;
        if (reviewingFailedRef.current && failed) {
          await syncEngine.reviseFailedRootCreate(
            accountUserId,
            failed.clientMutationId,
            command,
            overlay,
          );
        } else {
          const deviceId = await secureDeviceIdStore.getOrCreate();
          await syncEngine.enqueueRootCreate(
            accountUserId,
            deviceId,
            command,
            overlay,
          );
        }
        if (activeAccountRef.current !== accountUserId) return;
        failedCreationRef.current = null;
        reviewingFailedRef.current = false;
        publish({
          kind: 'queued',
          mode: client ? 'syncing' : 'offline',
          recovery: client ? 'none' : 'retry',
          retrying: false,
          rootEventId: command.id,
          title: command.title,
        });
        await syncAndOpen(command.id, command.title, false);
      } catch (error) {
        if (
          error instanceof MobileSyncAccountChangedError ||
          activeAccountRef.current !== accountUserId
        ) {
          return;
        }
        if (isSessionFailure(error)) reloadSession().catch(() => undefined);
        publish({
          ...current,
          submissionError: reviewingFailedRef.current
            ? 'Änderungen noch nicht gespeichert. Der bisherige Entwurf bleibt lokal erhalten.'
            : 'Noch nicht gespeichert. Deine Angaben sind erhalten. Versuche es erneut.',
          submitting: false,
        });
      }
    })().finally(() => {
      if (submissionFlightRef.current === flight) {
        submissionFlightRef.current = null;
      }
    });
    submissionFlightRef.current = flight;
    return flight;
  };

  return (
    <EventCreateView
      onBack={() => {
        if (stateRef.current.kind === 'details' && shapeRef.current) {
          publish(shapeRef.current);
        } else {
          navigation.goBack();
        }
      }}
      onDescriptionChange={description => updateDetails({ description })}
      onExit={() => navigation.navigate('Events')}
      onReviewCreation={reviewFailedCreation}
      onRetryCreation={() => {
        const current = stateRef.current;
        if (current.kind === 'queued' && current.recovery === 'retry') {
          syncAndOpen(current.rootEventId, current.title, true).catch(
            () => undefined,
          );
        }
      }}
      onRetryTemplates={() => {
        loadTemplates(true).catch(() => undefined);
      }}
      onSelectOption={selectOption}
      onSubmit={() => {
        submit().catch(() => undefined);
      }}
      onTitleChange={title =>
        updateDetails({ title, titleError: title.trim() ? null : undefined })
      }
      onUseOption={useOption}
      state={state}
    />
  );
}

export function eventCreateOptions(
  templates: readonly EventTemplate[],
): readonly EventCreateOption[] {
  const options = templates.flatMap<EventCreateOption>(template => {
    const copy = templateCopy[template.id];
    const root = template.events.find(
      event => event.logicalKey === 'root' && event.parentLogicalKey === null,
    );
    const logicalKeys = template.events.map(event => event.logicalKey);
    if (
      !copy ||
      !root ||
      template.version < 1 ||
      logicalKeys.length < 1 ||
      logicalKeys.length > 16 ||
      new Set(logicalKeys).size !== logicalKeys.length
    ) {
      return [];
    }
    return [
      {
        id: template.id,
        kind: 'template',
        logicalKeys,
        rootKind: root.kind,
        summary: copy.summary,
        title: copy.title,
        version: template.version,
      },
    ];
  });
  return [...options, blankOption];
}

export function buildRootCreateCommand(
  option: EventCreateOption,
  title: string,
  description: string,
  timeZone: string,
  newUuid: () => string = secureUuidV4,
  existingRootEventId?: string,
): RootCreateCommand {
  const rootEventId = existingRootEventId ?? `evt_${newUuid()}`;
  const command: RootCreateCommand = {
    description: description.trim() || null,
    endsAt: null,
    id: rootEventId,
    kind: option.rootKind,
    startsAt: null,
    status: 'draft',
    timeZone,
    title: title.trim(),
  };
  if (option.kind === 'template') {
    if (!option.version) throw new Error('Template version is unavailable');
    command.template = {
      eventIds: Object.fromEntries(
        option.logicalKeys.map(logicalKey => [
          logicalKey,
          logicalKey === 'root' ? rootEventId : `evt_${newUuid()}`,
        ]),
      ),
      id: option.id,
      version: option.version,
    };
  }
  return command;
}

export function deviceTimeZone(): string {
  try {
    const timeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function retryMode(
  status: SyncStatus,
): Extract<EventCreateViewState, { kind: 'queued' }>['mode'] {
  return ['blocked', 'needs_attention'].includes(status.state)
    ? 'attention'
    : 'offline';
}

function pendingMode(
  item: OutboxItem,
): Extract<EventCreateViewState, { kind: 'queued' }>['mode'] {
  return ['blocked', 'dead_letter'].includes(item.state)
    ? 'attention'
    : 'offline';
}

function pendingRecovery(
  item: OutboxItem,
): Extract<EventCreateViewState, { kind: 'queued' }>['recovery'] {
  if (item.state !== 'dead_letter' && item.state !== 'blocked') return 'retry';
  if (item.lastError?.code === 'retry_exhausted') return 'retry';
  if (
    item.state === 'dead_letter' &&
    !item.serverConsumed &&
    item.lastError?.code === 'invalid'
  ) {
    return 'review';
  }
  return 'none';
}

function queuedState(
  item: OutboxItem,
): Extract<EventCreateViewState, { kind: 'queued' }> {
  return {
    kind: 'queued',
    mode: pendingMode(item),
    recovery: pendingRecovery(item),
    retrying: false,
    rootEventId: item.rootEventId,
    title: rootCreateTitle(item),
  };
}

function rootCreateTitle(item: OutboxItem): string {
  const command = item.command as Partial<RootCreateCommand>;
  return typeof command.title === 'string' && command.title.trim()
    ? command.title.trim()
    : 'Gespeicherter Event-Entwurf';
}

function templateOptionId(value: string): EventCreateOption['id'] | null {
  return value === 'travel' || value === 'golf-tour' || value === 'team-event'
    ? value
    : null;
}
