import { MobileSyncRootAccessDeniedError } from '@crew/mobile-data';
import { usePreventRemove } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import type { ImageSourcePropType } from 'react-native';
import {
  AccessibilityInfo,
  Clipboard,
  Image,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useGatewayClient } from '../app/GatewayProvider';
import {
  usePrivateDatabase,
  usePrivateSessionLifecycle,
} from '../app/PrivateBootstrapGate';
import {
  Button,
  Card,
  StatusChip,
  SyncStatus,
  TextField,
} from '../design/primitives';
import { colors, radii, spacing, typography } from '../design/theme';
import type { RootStackParamList } from '../navigation/types';
import {
  TEAM_FEED_MAX_LENGTH,
  TeamProductionRuntime,
  type TeamFeedEntryViewModel,
  type TeamFeedViewModel,
} from '../team/TeamProductionRuntime';
import { ScreenFrame, ScreenIcon } from './ScreenFrame';
import {
  discardTeamFeedPhoto,
  markTeamFeedPhotoQueued,
  pickTeamFeedPhoto,
  prepareAndUploadTeamFeedPhoto,
  previewTeamFeedPhoto,
  recoveredTeamFeedPhoto,
  type TeamFeedPhotoSelection,
} from './TeamFeedPhotoRuntime';
import { TeamRouteStateView } from './TeamRouteStateView';
import { useOnlineState } from './useOnlineState';

const icons = {
  chat: require('../assets/icons/chat.png'),
  check: require('../assets/icons/check.png'),
  cloudOffline: require('../assets/icons/cloud-offline.png'),
} satisfies Record<string, ImageSourcePropType>;

type Props = NativeStackScreenProps<RootStackParamList, 'TeamFeed'>;

type ReadyState = {
  key: string;
  model: TeamFeedViewModel;
  runtime: TeamProductionRuntime;
  status: 'ready';
};

type LoadState =
  | ReadyState
  | { key: string; status: 'concealed' }
  | { key: string; status: 'loading' };

type TeamFeedPhotoState = {
  feedQueued: boolean;
  message: string | null;
  messageKind: 'error' | 'info' | null;
  phase: 'empty' | 'picking' | 'selected' | 'uploading';
  previewDataUri: string | null;
  replacementFeedEntryId: string | null;
  reselect: boolean;
  selection: TeamFeedPhotoSelection | null;
};

const emptyPhotoState: TeamFeedPhotoState = {
  feedQueued: false,
  message: null,
  messageKind: null,
  phase: 'empty',
  previewDataUri: null,
  replacementFeedEntryId: null,
  reselect: false,
  selection: null,
};
const terminalAttachmentMediaErrors = new Set([
  'attachment_media_missing',
  'attachment_media_unsafe',
]);

export function TeamFeedScreen({ navigation, route }: Props) {
  const client = useGatewayClient();
  const privateDatabase = usePrivateDatabase();
  const lifecycle = usePrivateSessionLifecycle();
  const online = useOnlineState();
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const activeAccountRef = useRef(lifecycle.accountId);
  activeAccountRef.current = lifecycle.accountId;
  const activeDatabaseRef = useRef(privateDatabase.database);
  activeDatabaseRef.current = privateDatabase.database;
  const rootEventId = route.params.rootEventId;
  const eventId = route.params.eventId ?? null;
  const scopeKey =
    lifecycle.status === 'ready' &&
    lifecycle.accountId === privateDatabase.accountId
      ? `${privateDatabase.accountId}:${rootEventId}:${eventId ?? 'root'}`
      : null;
  const activeScopeRef = useRef(scopeKey);
  activeScopeRef.current = scopeKey;
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<TeamFeedPhotoState>(emptyPhotoState);
  const [refreshRequest, setRefreshRequest] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(submitting);
  submittingRef.current = submitting;
  usePreventRemove(submitting, () => undefined);
  const [state, setState] = useState<LoadState>({
    key: scopeKey ?? '',
    status: 'loading',
  });
  const retainedPhotoRef = useRef<{
    database: typeof privateDatabase.database;
    selection: TeamFeedPhotoSelection;
  } | null>(null);

  useEffect(
    () => () => {
      activeScopeRef.current = null;
    },
    [],
  );

  useEffect(() => {
    const retained = retainedPhotoRef.current;
    retainedPhotoRef.current = null;
    if (
      !submittingRef.current &&
      retained?.selection.lifecycleState === 'selected'
    ) {
      discardTeamFeedPhoto(retained.database, retained.selection).catch(
        () => undefined,
      );
    }
    setDraft('');
    setError(null);
    setPhoto(emptyPhotoState);
    submittingRef.current = false;
    setSubmitting(false);
    return () => {
      const pending = retainedPhotoRef.current;
      retainedPhotoRef.current = null;
      if (
        !submittingRef.current &&
        pending?.selection.lifecycleState === 'selected'
      ) {
        discardTeamFeedPhoto(pending.database, pending.selection).catch(
          () => undefined,
        );
      }
    };
  }, [privateDatabase.database, scopeKey]);

  useEffect(() => {
    if (!scopeKey) {
      setState({ key: '', status: 'concealed' });
      return;
    }
    let cancelled = false;
    const accountUserId = privateDatabase.accountId;
    const publish = (next: LoadState) => {
      if (
        !cancelled &&
        activeAccountRef.current === accountUserId &&
        next.key === scopeKey
      ) {
        setState(next);
      }
    };

    (async () => {
      const runtime = await TeamProductionRuntime.create({
        accountUserId,
        activeAccountUserId: () => activeAccountRef.current,
        client,
        database: privateDatabase.database,
        rootEventId,
      });
      if (!runtime) {
        publish({ key: scopeKey, status: 'concealed' });
        return;
      }
      try {
        const recovered = await runtime.recoverFeedPhoto(eventId);
        if (recovered && !retainedPhotoRef.current) {
          const selection = recoveredTeamFeedPhoto(recovered);
          let previewDataUri: string | null = null;
          try {
            previewDataUri = await previewTeamFeedPhoto(selection);
          } catch (caught) {
            const current = () =>
              !cancelled &&
              activeAccountRef.current === accountUserId &&
              activeDatabaseRef.current === privateDatabase.database &&
              activeScopeRef.current === scopeKey;
            if (isTerminalAttachmentMediaError(caught)) {
              await discardTeamFeedPhoto(
                privateDatabase.database,
                selection,
              ).catch(() => undefined);
              if (current()) {
                setPhoto({
                  ...emptyPhotoState,
                  message:
                    recovered.state === 'feed_queued'
                      ? 'Das gespeicherte Foto ist nicht mehr verfügbar. Dein Update bleibt lokal gespeichert.'
                      : 'Das gespeicherte Foto ist nicht mehr verfügbar.',
                  messageKind: 'error',
                  replacementFeedEntryId:
                    recovered.state === 'feed_queued'
                      ? selection.feedEntryId
                      : null,
                  reselect: true,
                });
              }
            } else if (current()) {
              retainedPhotoRef.current = {
                database: privateDatabase.database,
                selection,
              };
              setPhoto({
                feedQueued: recovered.state === 'feed_queued',
                message:
                  'Die Foto-Vorschau ist vorübergehend nicht verfügbar. Das Foto bleibt sicher gespeichert.',
                messageKind: 'error',
                phase: 'selected',
                previewDataUri: null,
                replacementFeedEntryId: null,
                reselect: false,
                selection,
              });
            }
          }
          const scopeChanged =
            activeAccountRef.current !== accountUserId ||
            activeDatabaseRef.current !== privateDatabase.database ||
            activeScopeRef.current !== scopeKey;
          if (previewDataUri !== null && (cancelled || scopeChanged)) {
            if (scopeChanged && recovered.state === 'selected') {
              await discardTeamFeedPhoto(
                privateDatabase.database,
                selection,
              ).catch(() => undefined);
            }
            return;
          }
          if (previewDataUri !== null) {
            retainedPhotoRef.current = {
              database: privateDatabase.database,
              selection,
            };
            setPhoto({
              feedQueued: recovered.state === 'feed_queued',
              message:
                recovered.state === 'feed_queued'
                  ? 'Dein Update ist lokal gespeichert. Das Foto wartet auf die sichere Serverprüfung.'
                  : 'Dein ausgewähltes Foto wurde nach dem Neustart wiederhergestellt.',
              messageKind: 'info',
              phase: 'selected',
              previewDataUri,
              replacementFeedEntryId: null,
              reselect: false,
              selection,
            });
          }
        }
      } catch {
        // Cleanup remains durable and is retried on the next scoped load.
      }
      let model = await runtime.loadFeed(eventId);
      if (model) {
        publish({ key: scopeKey, model, runtime, status: 'ready' });
      } else {
        publish({ key: scopeKey, status: 'loading' });
      }
      if (online) {
        try {
          await runtime.refresh();
        } catch (caught) {
          if (caught instanceof MobileSyncRootAccessDeniedError) {
            publish({ key: scopeKey, status: 'concealed' });
            return;
          }
        }
      }
      model = (await runtime.loadFeed(eventId)) ?? model;
      publish(
        model
          ? { key: scopeKey, model, runtime, status: 'ready' }
          : { key: scopeKey, status: 'concealed' },
      );
    })().catch(() => publish({ key: scopeKey, status: 'concealed' }));

    return () => {
      cancelled = true;
    };
  }, [
    client,
    eventId,
    online,
    privateDatabase.accountId,
    privateDatabase.database,
    refreshRequest,
    rootEventId,
    scopeKey,
  ]);

  if (!scopeKey || state.key !== scopeKey || state.status === 'loading') {
    return (
      <TeamRouteStateView
        description="Crew lädt den sicher gespeicherten Feed."
        kind="loading"
        onBack={() => navigation.goBack()}
        onRetry={() => setRefreshRequest(value => value + 1)}
        testID="team-feed-loading"
        title="Feed wird geladen"
      />
    );
  }
  if (state.status === 'concealed') {
    return (
      <TeamRouteStateView
        description="Dieser Feed ist für das aktive Konto nicht verfügbar."
        kind="concealed"
        onBack={() => navigation.goBack()}
        onRetry={() => setRefreshRequest(value => value + 1)}
        testID="team-feed-unavailable"
        title="Inhalt nicht verfügbar"
      />
    );
  }

  const pickPhoto = async () => {
    if (
      submittingRef.current ||
      photo.phase === 'picking' ||
      photo.phase === 'uploading'
    ) {
      return;
    }
    const accountUserId = privateDatabase.accountId;
    const database = privateDatabase.database;
    const currentScope = scopeKey;
    const current = () =>
      activeAccountRef.current === accountUserId &&
      activeDatabaseRef.current === database &&
      activeScopeRef.current === currentScope;
    const replacementFeedEntryId = photo.replacementFeedEntryId;
    setPhoto({
      ...emptyPhotoState,
      phase: 'picking',
      replacementFeedEntryId,
      reselect: photo.reselect,
    });
    let selection: TeamFeedPhotoSelection | null = null;
    try {
      selection = await pickTeamFeedPhoto(
        database,
        accountUserId,
        rootEventId,
        eventId,
        replacementFeedEntryId ?? undefined,
      );
      if (!selection) {
        if (!current()) return;
        setPhoto({
          ...emptyPhotoState,
          message: replacementFeedEntryId
            ? 'Kein neues Foto ausgewählt. Dein Update bleibt lokal gespeichert.'
            : 'Keine Fotoauswahl. Dein Text bleibt unverändert und kann weiter gepostet werden.',
          messageKind: 'info',
          replacementFeedEntryId,
          reselect: Boolean(replacementFeedEntryId),
        });
        return;
      }
      retainedPhotoRef.current = { database, selection };
      let previewDataUri: string;
      try {
        previewDataUri = await previewTeamFeedPhoto(selection);
      } catch {
        await discardTeamFeedPhoto(database, selection).catch(() => undefined);
        if (retainedPhotoRef.current?.selection === selection) {
          retainedPhotoRef.current = null;
        }
        if (current()) {
          setPhoto({
            ...emptyPhotoState,
            message: replacementFeedEntryId
              ? 'Das neue Foto ist nicht sicher verfügbar. Dein Update bleibt lokal gespeichert.'
              : 'Das Foto ist nicht sicher verfügbar. Dein Text bleibt unverändert.',
            messageKind: 'error',
            replacementFeedEntryId,
            reselect: true,
          });
        }
        return;
      }
      if (!current()) {
        await discardTeamFeedPhoto(database, selection).catch(() => undefined);
        if (retainedPhotoRef.current?.selection === selection) {
          retainedPhotoRef.current = null;
        }
        return;
      }
      if (replacementFeedEntryId) {
        selection = await markTeamFeedPhotoQueued(database, {
          ...selection,
          lifecycleState: 'feed_queued',
        });
        if (!current()) return;
      }
      retainedPhotoRef.current = { database, selection };
      setPhoto({
        feedQueued: Boolean(replacementFeedEntryId),
        message: replacementFeedEntryId
          ? 'Das neue Foto ist lokal gespeichert und bereit für die sichere Serverprüfung.'
          : 'Ein Foto ist ausgewählt. Es wird erst nach deinem lokal gespeicherten Update sicher übertragen.',
        messageKind: 'info',
        phase: 'selected',
        previewDataUri,
        replacementFeedEntryId: null,
        reselect: false,
        selection,
      });
    } catch {
      if (!current()) return;
      if (selection) {
        await discardTeamFeedPhoto(database, selection).catch(() => undefined);
        retainedPhotoRef.current = null;
      }
      setPhoto({
        ...emptyPhotoState,
        message: replacementFeedEntryId
          ? 'Das Foto konnte nicht ersetzt werden. Dein Update bleibt lokal gespeichert.'
          : 'Das Foto konnte nicht ausgewählt werden. Dein Text bleibt unverändert und kann weiter gepostet werden.',
        messageKind: 'error',
        replacementFeedEntryId,
        reselect: Boolean(replacementFeedEntryId),
      });
    }
  };

  const removePhoto = async (): Promise<boolean> => {
    const selection = photo.selection;
    if (!selection || submittingRef.current || photo.phase === 'uploading') {
      return false;
    }
    const accountUserId = privateDatabase.accountId;
    const database = privateDatabase.database;
    const currentScope = scopeKey;
    const current = () =>
      activeAccountRef.current === accountUserId &&
      activeDatabaseRef.current === database &&
      activeScopeRef.current === currentScope;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await discardTeamFeedPhoto(database, selection);
      if (!current()) return false;
      retainedPhotoRef.current = null;
      setPhoto({
        ...emptyPhotoState,
        message: photo.feedQueued
          ? 'Das Foto wurde entfernt. Dein Update bleibt lokal gespeichert.'
          : 'Das ausgewählte Foto wurde entfernt. Dein Text bleibt unverändert.',
        messageKind: 'info',
      });
      setError(null);
      return true;
    } catch {
      if (current()) {
        setPhoto({
          ...photo,
          message:
            'Das Foto konnte nicht sicher entfernt werden. Bitte versuche es erneut.',
          messageKind: 'error',
        });
      }
      return false;
    } finally {
      if (current()) {
        submittingRef.current = false;
        setSubmitting(false);
      }
    }
  };

  const submit = async () => {
    if (submittingRef.current) return;
    let selectedPhoto = photo.selection ? photo : null;
    let photoFeedQueued = selectedPhoto?.feedQueued ?? false;
    let photoConfirmed = false;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    const { runtime } = state;
    let locallySaved = photoFeedQueued;
    const accountUserId = privateDatabase.accountId;
    const database = privateDatabase.database;
    const currentScope = scopeKey;
    const current = () =>
      activeAccountRef.current === accountUserId &&
      activeDatabaseRef.current === database &&
      activeScopeRef.current === currentScope;
    try {
      if (!photoFeedQueued) {
        await (selectedPhoto?.selection
          ? runtime.createFeedEntry(
              eventId,
              draft,
              selectedPhoto.selection.feedEntryId,
            )
          : runtime.createFeedEntry(eventId, draft));
        locallySaved = true;
        photoFeedQueued = Boolean(selectedPhoto);
        if (!current()) return;
        setDraft('');
        if (selectedPhoto?.selection) {
          const provisionalSelection = {
            ...selectedPhoto.selection,
            lifecycleState: 'feed_queued' as const,
          };
          selectedPhoto = {
            ...selectedPhoto,
            feedQueued: true,
            selection: provisionalSelection,
          };
          retainedPhotoRef.current = {
            database,
            selection: provisionalSelection,
          };
          const queuedSelection = await markTeamFeedPhotoQueued(
            database,
            provisionalSelection,
          );
          selectedPhoto = {
            ...selectedPhoto,
            feedQueued: true,
            selection: queuedSelection,
          };
          retainedPhotoRef.current = { database, selection: queuedSelection };
          setPhoto({
            ...selectedPhoto,
            feedQueued: true,
            message:
              'Dein Update ist lokal gespeichert. Das Foto wird jetzt sicher übertragen.',
            messageKind: 'info',
            phase: 'uploading',
            selection: queuedSelection,
          });
        }
      } else if (selectedPhoto?.selection) {
        const queuedSelection = await markTeamFeedPhotoQueued(
          database,
          selectedPhoto.selection,
        );
        selectedPhoto = {
          ...selectedPhoto,
          selection: queuedSelection,
        };
        retainedPhotoRef.current = { database, selection: queuedSelection };
        setPhoto({
          ...selectedPhoto,
          message: 'Das Foto wird erneut sicher übertragen.',
          messageKind: 'info',
          phase: 'uploading',
        });
      }
      const queued = await runtime.loadFeed(eventId);
      if (!queued) throw new Error('Queued team feed entry is unavailable');
      if (current()) {
        setState({ key: scopeKey, model: queued, runtime, status: 'ready' });
      }
      if (selectedPhoto?.selection) {
        if (!onlineRef.current || !client) {
          throw new Error('team_feed_photo_offline');
        }
        try {
          await runtime.refresh();
        } catch (caught) {
          if (caught instanceof MobileSyncRootAccessDeniedError) {
            if (current()) {
              setState({ key: scopeKey, status: 'concealed' });
            }
            return;
          }
          throw caught;
        }
        if (!current()) return;
        await prepareAndUploadTeamFeedPhoto({
          activeAccountUserId: () => activeAccountRef.current,
          client,
          database,
          selection: selectedPhoto.selection,
        });
        photoConfirmed = true;
        if (!current()) return;
        retainedPhotoRef.current = null;
        setPhoto({
          ...emptyPhotoState,
          message:
            'Das Foto wurde sicher geprüft und mit dem Feed gespeichert.',
          messageKind: 'info',
        });
        try {
          await runtime.refresh();
        } catch (caught) {
          if (caught instanceof MobileSyncRootAccessDeniedError) {
            if (current()) {
              setState({ key: scopeKey, status: 'concealed' });
            }
            return;
          }
        }
        const latest = await runtime.loadFeed(eventId);
        if (latest && current()) {
          setState({ key: scopeKey, model: latest, runtime, status: 'ready' });
        }
      } else if (onlineRef.current) {
        try {
          await runtime.refresh();
        } catch (caught) {
          if (caught instanceof MobileSyncRootAccessDeniedError) {
            if (current()) {
              setState({ key: scopeKey, status: 'concealed' });
            }
            return;
          }
        }
        const latest = await runtime.loadFeed(eventId);
        if (latest && current()) {
          setState({ key: scopeKey, model: latest, runtime, status: 'ready' });
        }
      }
    } catch (caught) {
      const terminalSelection =
        selectedPhoto?.selection &&
        photoFeedQueued &&
        isTerminalAttachmentMediaError(caught)
          ? selectedPhoto.selection
          : null;
      if (terminalSelection) {
        await discardTeamFeedPhoto(database, terminalSelection).catch(
          () => undefined,
        );
        if (retainedPhotoRef.current?.selection === terminalSelection) {
          retainedPhotoRef.current = null;
        }
        if (current()) {
          setPhoto({
            ...emptyPhotoState,
            message:
              'Das Foto ist nicht mehr sicher verfügbar. Dein Update bleibt lokal gespeichert.',
            messageKind: 'error',
            replacementFeedEntryId: terminalSelection.feedEntryId,
            reselect: true,
          });
          setError(
            'Das Update bleibt lokal gespeichert. Wähle ein neues Foto aus.',
          );
        }
      } else if (current()) {
        if (selectedPhoto?.selection && photoFeedQueued && !photoConfirmed) {
          setPhoto({
            ...selectedPhoto,
            feedQueued: true,
            message:
              'Dein Update ist lokal gespeichert. Das Foto wartet auf einen erneuten sicheren Sendeversuch.',
            messageKind: 'error',
            phase: 'selected',
            selection: selectedPhoto.selection,
          });
        }
        setError(
          selectedPhoto?.selection && photoFeedQueued
            ? 'Das Update wurde lokal gespeichert. Das Foto konnte noch nicht übertragen werden. Versuche es mit «Foto erneut senden» online erneut.'
            : locallySaved
            ? 'Das Update wurde lokal gespeichert, aber der Feed konnte nicht aktualisiert werden. Tippe auf «Feed aktualisieren».'
            : 'Das Update konnte nicht lokal gespeichert werden. Dein Text bleibt in diesem Feld.',
        );
      }
    } finally {
      if (current()) {
        submittingRef.current = false;
        setSubmitting(false);
      }
    }
  };

  return (
    <TeamFeedView
      draft={draft}
      error={error}
      model={state.model}
      onBack={() => {
        if (submittingRef.current) return;
        if (photo.selection?.lifecycleState !== 'selected') {
          navigation.goBack();
          return;
        }
        removePhoto()
          .then(removed => {
            if (removed) navigation.goBack();
          })
          .catch(() => undefined);
      }}
      onChange={value => {
        setDraft(value);
        if (error) setError(null);
      }}
      onRefresh={() => setRefreshRequest(value => value + 1)}
      onPickPhoto={() => {
        pickPhoto().catch(() => undefined);
      }}
      onRemovePhoto={() => {
        removePhoto().catch(() => undefined);
      }}
      onSubmit={() => {
        submit().catch(() => undefined);
      }}
      online={online}
      photo={{
        available: true,
        feedQueued: photo.feedQueued,
        message: photo.message,
        messageKind: photo.messageKind,
        phase: photo.phase,
        previewDataUri: photo.previewDataUri,
        reselect: photo.reselect,
      }}
      submitting={submitting}
    />
  );
}

export type TeamFeedViewProps = {
  draft: string;
  error: string | null;
  model: TeamFeedViewModel;
  onBack(): void;
  onChange(value: string): void;
  onPickPhoto?(): void;
  onRemovePhoto?(): void;
  onRefresh(): void;
  onSubmit(): void;
  online: boolean;
  photo?: {
    available: boolean;
    feedQueued: boolean;
    message: string | null;
    messageKind: 'error' | 'info' | null;
    phase: TeamFeedPhotoState['phase'];
    previewDataUri: string | null;
    reselect: boolean;
  };
  submitting: boolean;
};

export function TeamFeedView({
  draft,
  error,
  model,
  onBack,
  onChange,
  onPickPhoto,
  onRemovePhoto,
  onRefresh,
  onSubmit,
  online,
  photo,
  submitting,
}: TeamFeedViewProps) {
  const fieldError =
    draft.length > TEAM_FEED_MAX_LENGTH
      ? "Höchstens 10'000 Zeichen sind erlaubt."
      : draft.length > 0 && draft.trim().length === 0
      ? 'Gib mindestens ein sichtbares Zeichen ein.'
      : undefined;
  const hasUsableDraft =
    draft.trim().length > 0 && draft.length <= TEAM_FEED_MAX_LENGTH;
  const canSubmit =
    model.canPost &&
    !submitting &&
    (hasUsableDraft || Boolean(photo?.feedQueued));
  const delivery = feedDeliverySummary(model.entries, online);
  const submitHint = submitting
    ? 'Das Update wird verarbeitet. Eine zweite Übermittlung ist gesperrt.'
    : 'Speichert das Update zuerst auf diesem Gerät und synchronisiert es bei verfügbarer Verbindung.';

  return (
    <ScreenFrame
      description="Deine Updates werden zuerst auf diesem Gerät gespeichert und bei verfügbarer Verbindung mit deinem Konto synchronisiert."
      eyebrow="TEAM-FEED"
      icon={delivery.icon}
      statusLabel={delivery.statusLabel}
      testID="team-feed-view"
      title={model.eventTitle}
      tone="lavender"
    >
      <SyncStatus
        icon={<ScreenIcon size={17} source={delivery.icon} />}
        label={delivery.label}
        state={delivery.state}
      />

      {model.canPost ? (
        <View style={styles.composer}>
          <View style={styles.field}>
            <TextField
              accessibilityHint="Schreibe ein Update für die Mitglieder dieses Events."
              autoCapitalize="sentences"
              autoComplete="off"
              disabled={submitting || Boolean(photo?.feedQueued)}
              error={fieldError}
              inputStyle={styles.input}
              label="Update"
              maxLength={TEAM_FEED_MAX_LENGTH}
              multiline
              onChangeText={onChange}
              placeholder="Was soll dein Team wissen?"
              testID="team-feed-input"
              textAlignVertical="top"
              value={draft}
            />
            <Text
              accessibilityLabel={`${draft.length} von 10'000 Zeichen. Beim Posten wird das Update zuerst lokal gespeichert.`}
              style={styles.helper}
              testID="team-feed-character-count"
            >
              {draft.length} / 10'000 Zeichen · Beim Posten zuerst lokal
              gespeichert.
            </Text>
          </View>
          {photo && onPickPhoto ? (
            <View style={styles.photoComposer}>
              {photo.phase === 'selected' || photo.phase === 'uploading' ? (
                <Card tone="surface">
                  {photo.previewDataUri ? (
                    <Image
                      accessibilityLabel="Vorschau des ausgewählten Team-Fotos."
                      accessible
                      resizeMode="cover"
                      source={{ uri: photo.previewDataUri }}
                      style={styles.photoPreview}
                      testID="team-feed-photo-preview"
                    />
                  ) : null}
                  <StatusChip
                    accessibilityLiveRegion="polite"
                    label={
                      photo.phase === 'uploading'
                        ? 'FOTO WIRD ÜBERTRAGEN'
                        : photo.feedQueued
                        ? 'FOTO WARTET AUF SENDEN'
                        : '1 FOTO AUSGEWÄHLT'
                    }
                    tone={photo.messageKind === 'error' ? 'brand' : 'lavender'}
                  />
                  {photo.message ? (
                    <Text
                      accessibilityLiveRegion={
                        photo.messageKind === 'error' ? 'assertive' : 'polite'
                      }
                      accessibilityRole={
                        photo.messageKind === 'error' ? 'alert' : undefined
                      }
                      style={[
                        styles.photoCopy,
                        photo.messageKind === 'error' && styles.error,
                      ]}
                      testID="team-feed-photo-status"
                    >
                      {photo.message}
                    </Text>
                  ) : null}
                  {photo.phase === 'selected' && onRemovePhoto ? (
                    <Button
                      accessibilityHint={
                        photo.feedQueued
                          ? 'Entfernt nur das Foto. Dein bereits lokal gespeichertes Update bleibt bestehen.'
                          : 'Entfernt das ausgewählte Foto. Dein Text bleibt unverändert.'
                      }
                      disabled={submitting}
                      label="Foto entfernen"
                      onPress={onRemovePhoto}
                      testID="team-feed-photo-remove"
                      variant="surface"
                    />
                  ) : null}
                </Card>
              ) : (
                <>
                  <Button
                    accessibilityHint="Öffnet den System-Fotowähler für genau ein Bild. Die Auswahl wird lokal gespeichert; Abbrechen lässt deinen Text unverändert."
                    disabled={
                      !photo.available ||
                      submitting ||
                      photo.phase === 'picking'
                    }
                    label={
                      photo.phase === 'picking'
                        ? 'Fotowähler wird geöffnet …'
                        : photo.reselect
                        ? 'Foto neu auswählen'
                        : 'Foto auswählen'
                    }
                    loading={photo.phase === 'picking'}
                    onPress={onPickPhoto}
                    testID="team-feed-photo-pick"
                    variant="surface"
                  />
                  <Text style={styles.photoCopy}>
                    Optional · genau 1 Bild. Text-Updates funktionieren auch
                    ohne Foto und offline.
                  </Text>
                  {photo.message ? (
                    <Text
                      accessibilityLiveRegion={
                        photo.messageKind === 'error' ? 'assertive' : 'polite'
                      }
                      accessibilityRole={
                        photo.messageKind === 'error' ? 'alert' : undefined
                      }
                      style={[
                        styles.photoCopy,
                        photo.messageKind === 'error' && styles.error,
                      ]}
                      testID="team-feed-photo-status"
                    >
                      {photo.message}
                    </Text>
                  ) : null}
                </>
              )}
            </View>
          ) : null}
          {error ? (
            <Text
              accessibilityLiveRegion="assertive"
              accessibilityRole="alert"
              style={styles.error}
            >
              {error}
            </Text>
          ) : null}
          {hasUsableDraft || submitting || photo?.feedQueued ? (
            <Button
              accessibilityHint={submitHint}
              disabled={!canSubmit}
              icon={<ScreenIcon source={icons.chat} />}
              label={
                submitting
                  ? 'Wird verarbeitet …'
                  : photo?.feedQueued
                  ? 'Foto erneut senden'
                  : 'Update posten'
              }
              loading={submitting}
              onPress={onSubmit}
              testID="team-feed-submit"
              variant="action"
            />
          ) : null}
        </View>
      ) : (
        <Card tone="surface">
          <StatusChip label="NUR ANSEHEN" tone="lavender" />
          <Text style={styles.supportCopy}>
            Du kannst Updates lesen, aber in diesem Event nichts posten.
          </Text>
        </Card>
      )}

      <View style={styles.feed}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          LETZTE UPDATES
        </Text>
        {model.entries.length > 0 ? (
          <View accessibilityRole="list" style={styles.entryList}>
            {model.entries.map(entry => (
              <TeamFeedEntry entry={entry} key={entry.id} />
            ))}
          </View>
        ) : (
          <Card tone="surface">
            <Text accessibilityLiveRegion="polite" style={styles.emptyTitle}>
              Noch keine Updates
            </Text>
            <Text style={styles.supportCopy}>
              Das erste lokal gespeicherte Update erscheint sofort hier.
            </Text>
          </Card>
        )}
      </View>

      <View style={styles.actions}>
        <Button
          accessibilityHint={
            submitting
              ? 'Warte, bis das Update verarbeitet wurde.'
              : 'Lädt ausstehende Updates und den aktuellen Event-Feed erneut.'
          }
          disabled={submitting}
          label="Feed aktualisieren"
          onPress={onRefresh}
          testID="team-feed-refresh"
          variant="surface"
        />
        <Button
          accessibilityHint={
            submitting
              ? 'Warte, bis das Update verarbeitet wurde.'
              : photo?.phase === 'selected'
              ? photo.feedQueued
                ? 'Kehrt zum Event zurück. Das Foto bleibt für einen sicheren späteren Sendeversuch gespeichert.'
                : 'Entfernt das ausgewählte Foto sicher und kehrt danach zum Event zurück.'
              : 'Kehrt zum Event zurück. Ausstehende Updates bleiben gespeichert.'
          }
          disabled={submitting}
          label="Zurück zum Event"
          onPress={onBack}
          testID="team-feed-back"
          variant="surface"
        />
      </View>
    </ScreenFrame>
  );
}

function TeamFeedEntry({ entry }: { entry: TeamFeedEntryViewModel }) {
  const timestamp = feedTimestamp(entry.createdAt);
  const copyHint =
    entry.deliveryState === 'attention'
      ? 'Aktion verfügbar: Update kopieren. Der Text bleibt lokal.'
      : 'Aktion verfügbar: Update kopieren.';
  const copyEntry = () => {
    Clipboard.setString(entry.body);
    AccessibilityInfo.announceForAccessibility('Update kopiert.');
  };
  return (
    <Card
      style={styles.entry}
      testID={`team-feed-entry-${entry.deliveryState}`}
      tone={entry.deliveryState === 'attention' ? 'brand' : 'surface'}
    >
      <View style={styles.entryMeta}>
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.author}
        >
          {entry.author}
        </Text>
        <StatusChip
          accessibilityLiveRegion="polite"
          label={entry.deliveryLabel}
          testID={`team-feed-entry-status-${entry.id}`}
          tone={entry.deliveryState === 'converged' ? 'action' : 'lavender'}
        />
      </View>
      <Text
        accessible
        accessibilityActions={[{ label: 'Update kopieren', name: 'copy' }]}
        accessibilityHint={copyHint}
        accessibilityLabel={`${entry.author}. ${entry.body} ${timestamp}.`}
        accessibilityRole="text"
        onAccessibilityAction={event => {
          if (event.nativeEvent.actionName === 'copy') copyEntry();
        }}
        style={styles.body}
      >
        {entry.body}
      </Text>
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.timestamp}
      >
        {timestamp}
      </Text>
      {entry.deliveryState === 'attention' ? (
        <Button
          accessibilityHint="Kopiert das lokal erhaltene Update in die Zwischenablage."
          label="Update kopieren"
          onPress={copyEntry}
          testID={`team-feed-entry-copy-${entry.id}`}
          variant="surface"
        />
      ) : null}
    </Card>
  );
}

function isTerminalAttachmentMediaError(error: unknown): boolean {
  return (
    error instanceof Error && terminalAttachmentMediaErrors.has(error.message)
  );
}

function feedDeliverySummary(
  entries: readonly TeamFeedEntryViewModel[],
  online: boolean,
): {
  icon: ImageSourcePropType;
  label: string;
  state: 'attention' | 'offline' | 'ready' | 'syncing';
  statusLabel: string;
} {
  const deliveryState = (['attention', 'sending', 'queued'] as const).find(
    state => entries.some(entry => entry.deliveryState === state),
  );
  if (deliveryState === 'attention') {
    return {
      icon: icons.cloudOffline,
      label:
        'Mindestens ein Update braucht Aufmerksamkeit. Nutze beim betroffenen Update die Aktion „Update kopieren“; es bleibt lokal.',
      state: 'attention',
      statusLabel: 'AKTION ERFORDERLICH',
    };
  }
  if (deliveryState === 'sending') {
    return {
      icon: icons.cloudOffline,
      label:
        'Mindestens ein Update wird synchronisiert und wartet auf Serverbestätigung.',
      state: 'syncing',
      statusLabel: 'WIRD GESENDET',
    };
  }
  if (deliveryState === 'queued') {
    return {
      icon: icons.cloudOffline,
      label: online
        ? 'Mindestens ein Update ist lokal gespeichert. Crew versucht die Synchronisierung.'
        : 'Mindestens ein Update ist offline gespeichert. Crew sendet bei der nächsten Verbindung.',
      state: 'offline',
      statusLabel: 'LOKAL GESPEICHERT',
    };
  }
  return online
    ? {
        icon: icons.check,
        label: 'Alle sichtbaren Updates sind synchronisiert.',
        state: 'ready',
        statusLabel: 'SYNCHRONISIERT',
      }
    : {
        icon: icons.cloudOffline,
        label: 'Offline. Synchronisierte Updates bleiben verfügbar.',
        state: 'offline',
        statusLabel: 'OFFLINE BEREIT',
      };
}

function feedTimestamp(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Zeitpunkt unbekannt';
  return new Intl.DateTimeFormat('de-CH', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

const styles = StyleSheet.create({
  actions: {
    gap: spacing.md,
  },
  author: {
    ...typography.bodyStrong,
    color: colors.text,
    flexShrink: 1,
  },
  body: {
    ...typography.body,
    color: colors.text,
  },
  composer: {
    gap: spacing.md,
  },
  emptyTitle: {
    ...typography.subheading,
    color: colors.text,
  },
  entry: {
    gap: spacing.sm,
  },
  entryList: {
    gap: spacing.md,
  },
  entryMeta: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  error: {
    ...typography.caption,
    color: colors.error,
  },
  feed: {
    gap: spacing.md,
  },
  field: {
    gap: spacing.xs,
  },
  helper: {
    ...typography.caption,
    color: colors.text,
  },
  input: {
    minHeight: 128,
  },
  photoComposer: {
    gap: spacing.sm,
  },
  photoCopy: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  photoPreview: {
    aspectRatio: 4 / 3,
    borderRadius: radii.card,
    marginBottom: spacing.md,
    width: '100%',
  },
  sectionTitle: {
    ...typography.overline,
    color: colors.text,
  },
  supportCopy: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  timestamp: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
