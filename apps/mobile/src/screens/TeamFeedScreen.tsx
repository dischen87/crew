import { MobileSyncRootAccessDeniedError } from '@crew/mobile-data';
import { usePreventRemove } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import type { ImageSourcePropType } from 'react-native';
import {
  AccessibilityInfo,
  Clipboard,
  findNodeHandle,
  Image,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  type MobileGatewayClient,
  useGatewayClient,
} from '../app/GatewayProvider';
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
import { borders, colors, radii, spacing, typography } from '../design/theme';
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
  loadTeamFeedPhotoSource,
  markTeamFeedPhotoQueued,
  pickTeamFeedPhoto,
  prepareAndUploadTeamFeedPhoto,
  previewTeamFeedPhoto,
  recoverTeamFeedPhotoDescription,
  recoveredTeamFeedPhoto,
  saveTeamFeedPhotoDescription,
  TEAM_FEED_PHOTO_CAPTION_MAX_LENGTH,
  type TeamFeedPhotoDescription,
  type TeamFeedPhotoSelection,
  type TeamFeedPhotoSource,
} from './TeamFeedPhotoRuntime';
import { TeamRouteStateView } from './TeamRouteStateView';
import { useOnlineState } from './useOnlineState';

const icons = {
  chat: require('../assets/icons/chat.png'),
  check: require('../assets/icons/check.png'),
  cloudOffline: require('../assets/icons/cloud-offline.png'),
} satisfies Record<string, ImageSourcePropType>;
const feedEntryIdPattern = /^fed_[A-Za-z0-9._:-]{1,96}$/;

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

type TeamFeedEditState = {
  baseVersion: number;
  entryId: string;
  eventId: string | null;
  originalBody: string;
  resolvingConflict: boolean;
};

type TeamFeedPhotoState = {
  description: TeamFeedPhotoDescription | null;
  descriptionPersisted: boolean;
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
  description: null,
  descriptionPersisted: false,
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
  const focusEntryId =
    typeof route.params.focusEntryId === 'string' &&
    feedEntryIdPattern.test(route.params.focusEntryId)
      ? route.params.focusEntryId
      : null;
  const scopeKey =
    lifecycle.status === 'ready' &&
    lifecycle.accountId === privateDatabase.accountId
      ? `${privateDatabase.accountId}:${rootEventId}:${eventId ?? 'root'}:${
          focusEntryId ?? 'latest'
        }`
      : null;
  const activeScopeRef = useRef(scopeKey);
  activeScopeRef.current = scopeKey;
  const [draft, setDraft] = useState('');
  const [edit, setEdit] = useState<TeamFeedEditState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<TeamFeedPhotoState>(emptyPhotoState);
  const [photoSources, setPhotoSources] = useState<{
    key: string;
    values: Readonly<Record<string, TeamFeedPhotoSource>>;
  }>({ key: '', values: {} });
  const [refreshRequest, setRefreshRequest] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(submitting);
  submittingRef.current = submitting;
  usePreventRemove(submitting || Boolean(edit), () => undefined);
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
    if (!client || !online) {
      setPhotoSources({ key: scopeKey ?? '', values: {} });
    }
  }, [client, online, scopeKey]);

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
    setEdit(null);
    setError(null);
    setPhoto(emptyPhotoState);
    setPhotoSources({ key: scopeKey ?? '', values: {} });
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
          const description = await recoverTeamFeedPhotoDescription(
            privateDatabase.database,
            selection,
          ).catch(() => null);
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
                  description,
                  descriptionPersisted: description !== null,
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
                description,
                descriptionPersisted: description !== null,
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
              description,
              descriptionPersisted: description !== null,
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
      let model = await runtime.loadFeed(eventId, focusEntryId);
      if (model) {
        publish({ key: scopeKey, model, runtime, status: 'ready' });
      } else {
        publish({ key: scopeKey, status: 'loading' });
      }
      let refreshSucceeded = false;
      if (online) {
        try {
          await runtime.refresh();
          refreshSucceeded = true;
        } catch (caught) {
          if (caught instanceof MobileSyncRootAccessDeniedError) {
            publish({ key: scopeKey, status: 'concealed' });
            return;
          }
        }
      }
      const refreshedModel = await runtime.loadFeed(eventId, focusEntryId);
      if (refreshSucceeded && !refreshedModel) {
        publish({ key: scopeKey, status: 'concealed' });
        return;
      }
      model = refreshedModel ?? model;
      if (!model) {
        publish({ key: scopeKey, status: 'concealed' });
        return;
      }
      publish({ key: scopeKey, model, runtime, status: 'ready' });
      const sources = await resolveTeamFeedPhotoSources({
        accountUserId,
        activeAccountUserId: () => activeAccountRef.current,
        client,
        model,
        online,
        rootEventId,
      });
      if (
        !cancelled &&
        activeAccountRef.current === accountUserId &&
        activeDatabaseRef.current === privateDatabase.database &&
        activeScopeRef.current === scopeKey
      ) {
        setPhotoSources({ key: scopeKey, values: sources });
      }
    })().catch(() => publish({ key: scopeKey, status: 'concealed' }));

    return () => {
      cancelled = true;
    };
  }, [
    client,
    eventId,
    focusEntryId,
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
    const replacementDescription = replacementFeedEntryId
      ? photo.description
      : null;
    setPhoto({
      ...emptyPhotoState,
      description: replacementDescription,
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
          description: replacementDescription,
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
            description: replacementDescription,
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
        description: replacementDescription,
        descriptionPersisted: false,
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
        description: replacementDescription,
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

  const startEdit = (entry: TeamFeedEntryViewModel) => {
    if (submittingRef.current || !entry.canEdit || entry.version === null) {
      return;
    }
    if (photo.selection || photo.feedQueued) {
      setError(
        'Entferne oder sende zuerst das ausgewählte Foto, bevor du ein Update bearbeitest.',
      );
      return;
    }
    if (draft.length > 0 && edit?.entryId !== entry.id) {
      setError(
        'Dein neuer Text bleibt im Feld. Leere ihn zuerst, bevor du ein bestehendes Update bearbeitest.',
      );
      return;
    }
    const resolvingConflict = entry.revisionConflict !== null;
    const currentBody = entry.revisionConflict?.currentBody ?? entry.body;
    setEdit({
      baseVersion: entry.version,
      entryId: entry.id,
      eventId: entry.eventId,
      originalBody: currentBody,
      resolvingConflict,
    });
    setDraft(entry.revisionConflict?.attemptedBody ?? entry.body);
    setError(null);
    AccessibilityInfo.announceForAccessibility(
      resolvingConflict
        ? 'Konfliktbearbeitung geöffnet. Prüfe deine Änderung gegen den aktuellen Server-Stand.'
        : 'Update zur Bearbeitung geöffnet.',
    );
  };

  const keepServerVersion = async (entry: TeamFeedEntryViewModel) => {
    if (
      submittingRef.current ||
      !entry.canEdit ||
      entry.version === null ||
      !entry.revisionConflict
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
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    let accepted = false;
    try {
      await state.runtime.keepFeedEntryServerVersion(
        entry.eventId,
        entry.id,
        entry.version,
      );
      accepted = true;
      if (!current()) return;
      if (edit?.entryId === entry.id) {
        setEdit(null);
        setDraft('');
      }
      const latest = await state.runtime.loadFeed(eventId);
      if (!latest) throw new Error('Team feed is unavailable');
      if (!current()) return;
      setState({
        key: scopeKey,
        model: latest,
        runtime: state.runtime,
        status: 'ready',
      });
      AccessibilityInfo.announceForAccessibility(
        'Aktueller Server-Stand wurde beibehalten.',
      );
    } catch {
      if (current()) {
        setError(
          accepted
            ? 'Der Server-Stand wurde beibehalten. Aktualisiere den Feed, um den neuen Status zu sehen.'
            : 'Der Konflikt konnte nicht aufgelöst werden. Aktualisiere den Feed und prüfe beide Stände erneut.',
        );
      }
    } finally {
      if (current()) {
        submittingRef.current = false;
        setSubmitting(false);
      }
    }
  };

  const submit = async () => {
    if (submittingRef.current) return;
    const currentEdit = edit;
    if (currentEdit && (photo.selection || photo.feedQueued)) {
      setError(
        'Entferne oder sende zuerst das ausgewählte Foto, bevor du ein Update bearbeitest.',
      );
      return;
    }
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
      if (selectedPhoto?.selection) {
        const selection = selectedPhoto.selection;
        if (!selectedPhoto.description) {
          throw new Error('team_feed_photo_description_required');
        }
        const description = await saveTeamFeedPhotoDescription(
          database,
          selection,
          selectedPhoto.description,
        );
        if (!current()) return;
        selectedPhoto = {
          ...selectedPhoto,
          description,
          descriptionPersisted: true,
        };
        retainedPhotoRef.current = {
          database,
          selection,
        };
        setPhoto(selectedPhoto);
      }
      if (currentEdit) {
        await runtime.reviseFeedEntry(
          currentEdit.eventId,
          currentEdit.entryId,
          draft,
          currentEdit.baseVersion,
        );
        locallySaved = true;
        if (!current()) return;
        setDraft('');
        setEdit(null);
      } else if (!photoFeedQueued) {
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
        const description = selectedPhoto.description;
        if (!description) {
          throw new Error('team_feed_photo_description_required');
        }
        await prepareAndUploadTeamFeedPhoto({
          activeAccountUserId: () => activeAccountRef.current,
          client,
          database,
          description,
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
          const sources = await resolveTeamFeedPhotoSources({
            accountUserId,
            activeAccountUserId: () => activeAccountRef.current,
            client,
            model: latest,
            online: onlineRef.current,
            rootEventId,
          });
          if (!current()) return;
          setPhotoSources({ key: scopeKey, values: sources });
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
            description: selectedPhoto?.description ?? null,
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
            ? currentEdit
              ? 'Die Änderung wurde lokal gespeichert, aber der Feed konnte nicht aktualisiert werden. Tippe auf «Feed aktualisieren».'
              : 'Das Update wurde lokal gespeichert, aber der Feed konnte nicht aktualisiert werden. Tippe auf «Feed aktualisieren».'
            : currentEdit
            ? 'Die Änderung konnte nicht lokal gespeichert werden. Dein Text bleibt in diesem Feld.'
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
      edit={edit}
      error={error}
      focusedEntryId={focusEntryId}
      model={state.model}
      onBack={() => {
        if (submittingRef.current) return;
        if (edit) {
          setDraft('');
          setEdit(null);
          setError(null);
          AccessibilityInfo.announceForAccessibility(
            'Bearbeitung abgebrochen.',
          );
          return;
        }
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
      onCancelEdit={() => {
        if (submittingRef.current) return;
        setDraft('');
        setEdit(null);
        setError(null);
        AccessibilityInfo.announceForAccessibility('Bearbeitung abgebrochen.');
      }}
      onCaptionChange={value => {
        if (
          submittingRef.current ||
          photo.phase === 'uploading' ||
          photo.descriptionPersisted
        ) {
          return;
        }
        setPhoto(currentPhoto => ({
          ...currentPhoto,
          description: { caption: value, kind: 'informative' },
          descriptionPersisted: false,
        }));
        if (error) setError(null);
      }}
      onPhotoDescriptionKindChange={kind => {
        if (
          submittingRef.current ||
          photo.phase === 'uploading' ||
          photo.descriptionPersisted
        ) {
          return;
        }
        setPhoto(currentPhoto => ({
          ...currentPhoto,
          description:
            kind === 'decorative'
              ? { kind: 'decorative' }
              : {
                  caption:
                    currentPhoto.description?.kind === 'informative'
                      ? currentPhoto.description.caption
                      : '',
                  kind: 'informative',
                },
          descriptionPersisted: false,
        }));
        if (error) setError(null);
      }}
      onPhotoLoadError={attachmentId => {
        setPhotoSources(currentSources =>
          currentSources.key !== scopeKey
            ? currentSources
            : {
                key: currentSources.key,
                values: Object.fromEntries(
                  Object.entries(currentSources.values).filter(
                    ([id]) => id !== attachmentId,
                  ),
                ),
              },
        );
      }}
      onEditEntry={startEdit}
      onKeepServerEntry={entry => {
        keepServerVersion(entry).catch(() => undefined);
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
      photo={
        edit
          ? undefined
          : {
              available: true,
              description: photo.description,
              descriptionPersisted: photo.descriptionPersisted,
              feedQueued: photo.feedQueued,
              message: photo.message,
              messageKind: photo.messageKind,
              phase: photo.phase,
              previewDataUri: photo.previewDataUri,
              reselect: photo.reselect,
            }
      }
      photoSources={photoSources.key === scopeKey ? photoSources.values : {}}
      submitting={submitting}
    />
  );
}

export type TeamFeedViewProps = {
  draft: string;
  edit?: TeamFeedEditState | null;
  error: string | null;
  focusedEntryId?: string | null;
  model: TeamFeedViewModel;
  onBack(): void;
  onCancelEdit?(): void;
  onCaptionChange?(value: string): void;
  onChange(value: string): void;
  onEditEntry?(entry: TeamFeedEntryViewModel): void;
  onKeepServerEntry?(entry: TeamFeedEntryViewModel): void;
  onPhotoDescriptionKindChange?(kind: 'decorative' | 'informative'): void;
  onPhotoLoadError?(attachmentId: string): void;
  onPickPhoto?(): void;
  onRemovePhoto?(): void;
  onRefresh(): void;
  onSubmit(): void;
  online: boolean;
  photo?: {
    available: boolean;
    description?: TeamFeedPhotoDescription | null;
    descriptionPersisted?: boolean;
    feedQueued: boolean;
    message: string | null;
    messageKind: 'error' | 'info' | null;
    phase: TeamFeedPhotoState['phase'];
    previewDataUri: string | null;
    reselect: boolean;
  };
  photoSources?: Readonly<Record<string, TeamFeedPhotoSource>>;
  submitting: boolean;
};

export function TeamFeedView({
  draft,
  edit = null,
  error,
  focusedEntryId = null,
  model,
  onBack,
  onCancelEdit,
  onCaptionChange,
  onChange,
  onEditEntry,
  onKeepServerEntry,
  onPhotoDescriptionKindChange,
  onPhotoLoadError,
  onPickPhoto,
  onRemovePhoto,
  onRefresh,
  onSubmit,
  online,
  photo,
  photoSources = {},
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
  const hasChangedDraft = !edit || draft.trim() !== edit.originalBody;
  const hasValidPhotoDescription =
    photo?.description?.kind === 'decorative' ||
    (photo?.description?.kind === 'informative' &&
      photo.description.caption.trim().length > 0 &&
      photo.description.caption.trim().length <=
        TEAM_FEED_PHOTO_CAPTION_MAX_LENGTH);
  const canSubmit =
    model.canPost &&
    !submitting &&
    hasChangedDraft &&
    (hasUsableDraft || Boolean(photo?.feedQueued)) &&
    (!photo ||
      (photo.phase !== 'selected' && photo.phase !== 'uploading') ||
      hasValidPhotoDescription);
  const delivery = feedDeliverySummary(model.entries, online);
  const focusedEntry = focusedEntryId
    ? model.entries.find(entry => entry.id === focusedEntryId) ?? null
    : null;
  const latestEntries = focusedEntry
    ? model.entries.filter(entry => entry.id !== focusedEntry.id)
    : model.entries;
  const submitHint = submitting
    ? 'Das Update wird verarbeitet. Eine zweite Übermittlung ist gesperrt.'
    : edit
    ? edit.resolvingConflict
      ? 'Speichert deine bewusst geprüfte Änderung mit dem aktuellen Server-Stand als Versionsbasis zuerst auf diesem Gerät.'
      : 'Speichert die Änderung zuerst auf diesem Gerät und synchronisiert sie bei verfügbarer Verbindung.'
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

      {focusedEntry ? (
        <View style={styles.feed} testID="team-feed-linked-entry">
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            VERLINKTES UPDATE
          </Text>
          <TeamFeedEntry
            entry={focusedEntry}
            focused
            onEdit={edit ? undefined : onEditEntry}
            onKeepServer={edit ? undefined : onKeepServerEntry}
            onPhotoLoadError={onPhotoLoadError}
            online={online}
            photoSources={photoSources}
          />
        </View>
      ) : null}

      {model.canPost ? (
        <View style={styles.composer}>
          {edit ? (
            <Card tone={edit.resolvingConflict ? 'brand' : 'surface'}>
              <StatusChip
                label={
                  edit.resolvingConflict
                    ? 'KONFLIKT BEWUSST BEARBEITEN'
                    : 'UPDATE BEARBEITEN'
                }
                tone={edit.resolvingConflict ? 'brand' : 'lavender'}
              />
              <Text style={styles.supportCopy}>
                {edit.resolvingConflict
                  ? 'Deine Änderung wird nur mit dem aktuell angezeigten Server-Stand als neuer Versionsbasis gespeichert.'
                  : 'Das Original bleibt erhalten, bis deine Änderung lokal gespeichert wurde.'}
              </Text>
              {onCancelEdit ? (
                <Button
                  accessibilityHint="Verwirft nur die Änderungen in diesem Bearbeitungsfeld. Das gespeicherte Update bleibt unverändert."
                  disabled={submitting}
                  label="Bearbeitung abbrechen"
                  onPress={onCancelEdit}
                  testID="team-feed-edit-cancel"
                  variant="surface"
                />
              ) : null}
            </Card>
          ) : null}
          <View style={styles.field}>
            <TextField
              accessibilityHint={
                edit
                  ? 'Bearbeite den Text dieses gespeicherten Updates.'
                  : 'Schreibe ein Update für die Mitglieder dieses Events.'
              }
              autoCapitalize="sentences"
              autoComplete="off"
              disabled={submitting || Boolean(photo?.feedQueued)}
              error={fieldError}
              inputStyle={styles.input}
              label={edit ? 'Update bearbeiten' : 'Update'}
              maxLength={TEAM_FEED_MAX_LENGTH}
              multiline
              onChangeText={onChange}
              placeholder={
                edit
                  ? 'Was soll im bestehenden Update stehen?'
                  : 'Was soll dein Team wissen?'
              }
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
          {!edit && photo && onPickPhoto ? (
            <View style={styles.photoComposer}>
              {photo.phase === 'selected' || photo.phase === 'uploading' ? (
                <Card tone="surface">
                  {photo.previewDataUri ? (
                    <Image
                      accessibilityLabel={
                        photo.description?.kind === 'informative' &&
                        photo.description.caption.trim()
                          ? photo.description.caption.trim()
                          : photo.description?.kind === 'decorative'
                          ? undefined
                          : 'Vorschau des ausgewählten Team-Fotos. Wähle aus, ob das Bild inhaltlich oder dekorativ ist.'
                      }
                      accessible={photo.description?.kind !== 'decorative'}
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
                  {onPhotoDescriptionKindChange ? (
                    <View style={styles.photoDescriptionChoices}>
                      <Button
                        accessibilityHint="Wähle diese Option, wenn das Foto Inhalt vermittelt. Eine Bildbeschreibung ist dann erforderlich."
                        accessibilityState={{
                          selected: photo.description?.kind === 'informative',
                        }}
                        disabled={
                          submitting ||
                          photo.phase === 'uploading' ||
                          photo.descriptionPersisted
                        }
                        label="Inhaltliches Foto"
                        onPress={() =>
                          onPhotoDescriptionKindChange('informative')
                        }
                        testID="team-feed-photo-informative"
                        variant={
                          photo.description?.kind === 'informative'
                            ? 'action'
                            : 'surface'
                        }
                      />
                      <Button
                        accessibilityHint="Wähle diese Option nur für ein rein dekoratives Foto. Das Bild wird von Hilfstechnologien übersprungen."
                        accessibilityState={{
                          selected: photo.description?.kind === 'decorative',
                        }}
                        disabled={
                          submitting ||
                          photo.phase === 'uploading' ||
                          photo.descriptionPersisted
                        }
                        label="Dekoratives Foto"
                        onPress={() =>
                          onPhotoDescriptionKindChange('decorative')
                        }
                        testID="team-feed-photo-decorative"
                        variant={
                          photo.description?.kind === 'decorative'
                            ? 'action'
                            : 'surface'
                        }
                      />
                    </View>
                  ) : null}
                  {photo.description?.kind === 'informative' &&
                  onCaptionChange ? (
                    <TextField
                      accessibilityHint="Beschreibe knapp den relevanten Bildinhalt für Personen, die das Foto nicht sehen."
                      disabled={
                        submitting ||
                        photo.phase === 'uploading' ||
                        photo.descriptionPersisted
                      }
                      error={
                        photo.description.caption.trim().length === 0
                          ? 'Für ein inhaltliches Foto ist eine Bildbeschreibung erforderlich.'
                          : undefined
                      }
                      helpText={`${photo.description.caption.length} / ${TEAM_FEED_PHOTO_CAPTION_MAX_LENGTH} Zeichen`}
                      label="Bildbeschreibung"
                      maxLength={TEAM_FEED_PHOTO_CAPTION_MAX_LENGTH}
                      multiline
                      onChangeText={onCaptionChange}
                      testID="team-feed-photo-caption"
                      value={photo.description.caption}
                    />
                  ) : photo.description?.kind === 'decorative' ? (
                    <Text
                      accessibilityLiveRegion="polite"
                      style={styles.photoCopy}
                      testID="team-feed-photo-description-status"
                    >
                      Als dekorativ markiert. Hilfstechnologien überspringen das
                      Bild.
                    </Text>
                  ) : (
                    <Text
                      accessibilityLiveRegion="polite"
                      style={styles.photoCopy}
                      testID="team-feed-photo-description-status"
                    >
                      Wähle verbindlich: Inhaltliche Fotos brauchen eine
                      Bildbeschreibung; dekorative Fotos werden nicht
                      angekündigt.
                    </Text>
                  )}
                  {photo.descriptionPersisted ? (
                    <Text style={styles.photoCopy}>
                      Die Foto-Einstufung ist für diesen sicheren Sendeversuch
                      gespeichert und gesperrt.
                    </Text>
                  ) : null}
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
          {edit || hasUsableDraft || submitting || photo?.feedQueued ? (
            <Button
              accessibilityHint={submitHint}
              disabled={!canSubmit}
              icon={<ScreenIcon source={icons.chat} />}
              label={
                submitting
                  ? 'Wird verarbeitet …'
                  : edit
                  ? 'Änderung speichern'
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

      {latestEntries.length > 0 || !focusedEntry ? (
        <View style={styles.feed}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            LETZTE UPDATES
          </Text>
          {latestEntries.length > 0 ? (
            <View accessibilityRole="list" style={styles.entryList}>
              {latestEntries.map(entry => (
                <TeamFeedEntry
                  entry={entry}
                  key={entry.id}
                  onEdit={edit ? undefined : onEditEntry}
                  onKeepServer={edit ? undefined : onKeepServerEntry}
                  onPhotoLoadError={onPhotoLoadError}
                  online={online}
                  photoSources={photoSources}
                />
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
      ) : null}

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
              : edit
              ? 'Beendet zuerst die Bearbeitung. Das gespeicherte Update bleibt unverändert.'
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

function TeamFeedEntry({
  entry,
  focused = false,
  onEdit,
  onKeepServer,
  onPhotoLoadError,
  online,
  photoSources,
}: {
  entry: TeamFeedEntryViewModel;
  focused?: boolean;
  onEdit?(entry: TeamFeedEntryViewModel): void;
  onKeepServer?(entry: TeamFeedEntryViewModel): void;
  onPhotoLoadError?(attachmentId: string): void;
  online: boolean;
  photoSources: Readonly<Record<string, TeamFeedPhotoSource>>;
}) {
  const bodyRef = useRef<Text>(null);
  useEffect(() => {
    if (!focused || !bodyRef.current) return;
    const node = findNodeHandle(bodyRef.current);
    if (node !== null) AccessibilityInfo.setAccessibilityFocus(node);
  }, [focused]);
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
      style={[styles.entry, focused && styles.focusedEntry]}
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
        {focused ? <StatusChip label="VERLINKTES UPDATE" tone="brand" /> : null}
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
        accessibilityLabel={`${focused ? 'Verlinktes Update. ' : ''}${
          entry.author
        }. ${entry.body} ${timestamp}.`}
        accessibilityRole="text"
        accessibilityState={focused ? { selected: true } : undefined}
        onAccessibilityAction={event => {
          if (event.nativeEvent.actionName === 'copy') copyEntry();
        }}
        ref={bodyRef}
        style={styles.body}
        testID={focused ? 'team-feed-linked-entry-body' : undefined}
      >
        {entry.body}
      </Text>
      {entry.revisionConflict ? (
        <View
          accessibilityLiveRegion="polite"
          style={styles.conflict}
          testID={`team-feed-entry-conflict-${entry.id}`}
        >
          <Text accessibilityRole="header" style={styles.conflictTitle}>
            KONFLIKT PRÜFEN
          </Text>
          <Text style={styles.conflictLabel}>
            DEINE NICHT ÜBERNOMMENE ÄNDERUNG
          </Text>
          <Text
            style={styles.body}
            testID={`team-feed-entry-conflict-attempted-${entry.id}`}
          >
            {entry.revisionConflict.attemptedBody}
          </Text>
          <Text style={styles.conflictLabel}>AKTUELLER SERVER-STAND</Text>
          <Text
            style={styles.body}
            testID={`team-feed-entry-conflict-current-${entry.id}`}
          >
            {entry.revisionConflict.currentBody}
          </Text>
          {entry.canEdit && onEdit && onKeepServer ? (
            <View style={styles.conflictActions}>
              <Button
                accessibilityHint="Öffnet deine nicht übernommene Änderung zur bewussten Bearbeitung auf Basis des aktuellen Server-Stands."
                label="Änderung überarbeiten"
                onPress={() => onEdit(entry)}
                testID={`team-feed-entry-conflict-edit-${entry.id}`}
                variant="action"
              />
              <Button
                accessibilityHint="Verwirft deine nicht übernommene Änderung und behält ausdrücklich den aktuellen Server-Stand."
                label="Server-Stand behalten"
                onPress={() => onKeepServer(entry)}
                testID={`team-feed-entry-conflict-keep-${entry.id}`}
                variant="surface"
              />
            </View>
          ) : null}
        </View>
      ) : null}
      {entry.photos.map(photo => {
        const caption = photo.caption?.trim() || null;
        const candidateSource = photoSources[photo.id];
        const source =
          candidateSource && Date.parse(candidateSource.expiresAt) > Date.now()
            ? candidateSource
            : undefined;
        return (
          <View key={photo.id} style={styles.feedPhoto}>
            {source ? (
              <Image
                accessibilityLabel={caption ?? undefined}
                accessible={caption !== null}
                onError={() => onPhotoLoadError?.(photo.id)}
                resizeMode="cover"
                source={{
                  cache: 'reload',
                  headers: { ...source.headers },
                  uri: source.uri,
                }}
                style={styles.photoPreview}
                testID={`team-feed-entry-photo-${photo.id}`}
              />
            ) : (
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={[styles.photoPreview, styles.photoUnavailable]}
                testID={`team-feed-entry-photo-unavailable-${photo.id}`}
              >
                <ScreenIcon size={28} source={icons.cloudOffline} />
              </View>
            )}
            {caption ? (
              <Text
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={styles.photoCaption}
                testID={`team-feed-entry-caption-${photo.id}`}
              >
                {caption}
              </Text>
            ) : null}
            {!source ? (
              <Text
                accessibilityElementsHidden={caption === null}
                accessibilityLabel={
                  caption
                    ? `${accessibilitySentence(caption)} ${
                        online
                          ? 'Foto derzeit nicht verfügbar.'
                          : 'Foto offline nicht verfügbar.'
                      }`
                    : undefined
                }
                accessible={caption !== null}
                importantForAccessibility={
                  caption === null ? 'no-hide-descendants' : 'auto'
                }
                style={styles.photoCopy}
                testID={`team-feed-entry-photo-status-${photo.id}`}
              >
                {online
                  ? 'Foto derzeit nicht verfügbar · Feed aktualisieren'
                  : 'Foto offline nicht verfügbar'}
              </Text>
            ) : null}
          </View>
        );
      })}
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.timestamp}
      >
        {timestamp}
      </Text>
      {entry.canEdit && !entry.revisionConflict && onEdit ? (
        <Button
          accessibilityHint="Öffnet dieses eigene synchronisierte Update zur Bearbeitung. Die Änderung wird zuerst lokal gespeichert."
          label="Update bearbeiten"
          onPress={() => onEdit(entry)}
          testID={`team-feed-entry-edit-${entry.id}`}
          variant="surface"
        />
      ) : null}
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

async function resolveTeamFeedPhotoSources(input: {
  accountUserId: string;
  activeAccountUserId(): string | null;
  client: MobileGatewayClient | null;
  model: TeamFeedViewModel;
  online: boolean;
  rootEventId: string;
}): Promise<Readonly<Record<string, TeamFeedPhotoSource>>> {
  if (!input.client || !input.online) return {};
  const sources: Record<string, TeamFeedPhotoSource> = {};
  const seen = new Set<string>();
  for (const entry of input.model.entries) {
    for (const photo of entry.photos) {
      if (
        seen.has(photo.id) ||
        input.activeAccountUserId() !== input.accountUserId
      ) {
        if (seen.has(photo.id)) continue;
        return sources;
      }
      seen.add(photo.id);
      try {
        sources[photo.id] = await loadTeamFeedPhotoSource({
          accountUserId: input.accountUserId,
          activeAccountUserId: input.activeAccountUserId,
          client: input.client,
          photo,
          rootEventId: input.rootEventId,
        });
      } catch {
        // Metadata and caption remain visible without retaining a stale grant.
      }
    }
  }
  return sources;
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

function accessibilitySentence(value: string): string {
  const text = value.trim();
  return /[.!?…]$/.test(text) ? text : `${text}.`;
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
  conflict: {
    backgroundColor: colors.surfaceBrand,
    borderRadius: radii.card,
    gap: spacing.sm,
    padding: spacing.md,
  },
  conflictActions: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  conflictLabel: {
    ...typography.overline,
    color: colors.text,
    marginTop: spacing.xs,
  },
  conflictTitle: {
    ...typography.subheading,
    color: colors.text,
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
  feedPhoto: {
    gap: spacing.xs,
  },
  focusedEntry: {
    backgroundColor: colors.surfaceBrand,
    borderColor: colors.focus,
    borderWidth: borders.chip,
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
  photoCaption: {
    ...typography.body,
    color: colors.text,
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
  photoDescriptionChoices: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  photoUnavailable: {
    alignItems: 'center',
    backgroundColor: colors.surfaceAccent,
    justifyContent: 'center',
    minHeight: 160,
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
