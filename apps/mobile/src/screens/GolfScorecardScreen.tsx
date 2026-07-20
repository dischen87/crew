import { MobileSyncRootAccessDeniedError } from '@crew/mobile-data';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import { useGatewayClient } from '../app/GatewayProvider';
import {
  usePrivateDatabase,
  usePrivateSessionLifecycle,
} from '../app/PrivateBootstrapGate';
import {
  previewGolfDraft,
  type GolfScorecardViewModel,
} from '../golf/GolfScorecardController';
import { GolfScorecardRuntime } from '../golf/GolfScorecardRuntime';
import { secureUuidV4 } from '../storage/secureRandom';
import type { RootStackParamList } from '../navigation/types';
import {
  GolfScorecardView,
  type GolfScorecardDraftViewModel,
  type GolfScorecardSurfaceModel,
} from './GolfScorecardView';

export type GolfScorecardScreenProps = {
  eventId: string;
  onBack(): void;
  rootEventId: string;
};

type RouteProps = NativeStackScreenProps<RootStackParamList, 'GolfScorecard'>;

export function GolfScorecardRouteScreen({ navigation, route }: RouteProps) {
  if (!route.params?.eventId || !route.params.rootEventId) return null;
  return (
    <GolfScorecardScreen
      eventId={route.params.eventId}
      onBack={() => navigation.goBack()}
      rootEventId={route.params.rootEventId}
    />
  );
}

type ReadyState = {
  key: string;
  message?: string;
  model: GolfScorecardViewModel;
  runtime: GolfScorecardRuntime;
  status: 'ready';
};

type LoadState =
  | ReadyState
  | { key: string; message?: string; status: 'concealed' }
  | { key: string; status: 'loading' };

type DraftState = {
  putts: string;
  saving: boolean;
  strokes: string;
};

export function GolfScorecardScreen({
  eventId,
  onBack,
  rootEventId,
}: GolfScorecardScreenProps) {
  const client = useGatewayClient();
  const privateDatabase = usePrivateDatabase();
  const lifecycle = usePrivateSessionLifecycle();
  const activeAccountRef = useRef(lifecycle.accountId);
  activeAccountRef.current = lifecycle.accountId;
  const scopeKey =
    lifecycle.status === 'ready' &&
    lifecycle.accountId === privateDatabase.accountId
      ? `${privateDatabase.accountId}:${rootEventId}:${eventId}`
      : null;
  const [refreshRequest, setRefreshRequest] = useState(0);
  const [selectedHole, setSelectedHole] = useState(1);
  const [state, setState] = useState<LoadState>({
    key: scopeKey ?? '',
    status: 'loading',
  });
  const [draft, setDraft] = useState<DraftState>({
    putts: '',
    saving: false,
    strokes: '',
  });
  const saveIdentityRef = useRef<{
    fingerprint: string;
    id: string;
  } | null>(null);
  const conflictIdentityRef = useRef<{
    clientMutationId: string;
    id: string;
  } | null>(null);
  const operationActiveRef = useRef(false);

  useEffect(() => {
    setSelectedHole(1);
    operationActiveRef.current = false;
    saveIdentityRef.current = null;
    conflictIdentityRef.current = null;
  }, [scopeKey]);

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
      const runtime = await GolfScorecardRuntime.create({
        accountUserId,
        activeAccountUserId: () => activeAccountRef.current,
        client,
        database: privateDatabase.database,
        eventId,
        rootEventId,
      });
      if (!runtime) {
        publish({ key: scopeKey, status: 'concealed' });
        return;
      }
      let cached = await runtime.load();
      if (cached) {
        publish({ key: scopeKey, model: cached, runtime, status: 'ready' });
      } else {
        publish({ key: scopeKey, status: 'loading' });
      }
      try {
        await runtime.refresh();
      } catch (error) {
        if (error instanceof MobileSyncRootAccessDeniedError) {
          publish({ key: scopeKey, status: 'concealed' });
          return;
        }
      }
      cached = (await runtime.load()) ?? cached;
      publish(
        cached
          ? { key: scopeKey, model: cached, runtime, status: 'ready' }
          : { key: scopeKey, status: 'concealed' },
      );
    })().catch(() =>
      publish({
        key: scopeKey,
        message: 'Diese Scorekarte konnte nicht sicher geladen werden.',
        status: 'concealed',
      }),
    );

    return () => {
      cancelled = true;
    };
  }, [
    client,
    eventId,
    privateDatabase.accountId,
    privateDatabase.database,
    refreshRequest,
    rootEventId,
    scopeKey,
  ]);

  const ready =
    scopeKey && state.key === scopeKey && state.status === 'ready'
      ? state
      : null;
  const selected =
    ready?.model.access === 'edit'
      ? ready.model.holes.find(hole => hole.hole === selectedHole) ??
        ready.model.holes[0]
      : null;
  const selectedSnapshot = selected
    ? `${scopeKey}:${selected.hole}:${selected.strokes ?? ''}:${
        selected.putts ?? ''
      }:${selected.version}:${selected.deliveryState}`
    : scopeKey;
  const selectedPutts = selected?.putts;
  const selectedStrokes = selected?.strokes;

  useEffect(() => {
    setDraft({
      putts:
        selectedPutts === null || selectedPutts === undefined
          ? ''
          : String(selectedPutts),
      saving: false,
      strokes:
        selectedStrokes === null || selectedStrokes === undefined
          ? ''
          : String(selectedStrokes),
    });
    saveIdentityRef.current = null;
    conflictIdentityRef.current = null;
  }, [selectedPutts, selectedSnapshot, selectedStrokes]);

  const parsed = {
    putts: parseScoreValue(draft.putts),
    strokes: parseScoreValue(draft.strokes),
  };
  const preview = selected
    ? previewGolfDraft(parsed, selected.par, selected.handicapStrokes)
    : emptyPreview;
  const storedPutts = selected?.putts ?? null;
  const storedStrokes = selected?.strokes ?? null;
  const dirty =
    selected !== null &&
    (parsed.putts !== storedPutts || parsed.strokes !== storedStrokes);
  const draftModel: GolfScorecardDraftViewModel = {
    dirty,
    preview,
    putts: draft.putts,
    saving: draft.saving,
    strokes: draft.strokes,
  };
  const surface: GolfScorecardSurfaceModel = ready
    ? {
        ...ready.model,
        message: ready.message,
        phase: 'ready',
      }
    : state.status === 'concealed'
    ? {
        eventTitle: 'Golfrunde',
        message: state.message,
        phase: 'concealed',
      }
    : { eventTitle: 'Golfrunde', phase: 'loading' };

  const reloadReady = async (
    runtime: GolfScorecardRuntime,
    message?: string,
  ) => {
    const model = await runtime.load();
    if (
      !scopeKey ||
      !model ||
      activeAccountRef.current !== privateDatabase.accountId
    ) {
      setState({ key: scopeKey ?? '', status: 'concealed' });
      return;
    }
    setState({ key: scopeKey, message, model, runtime, status: 'ready' });
  };

  const save = async () => {
    if (
      !ready ||
      !selected ||
      !preview.valid ||
      !dirty ||
      draft.saving ||
      operationActiveRef.current
    ) {
      return;
    }
    operationActiveRef.current = true;
    const fingerprint = [
      scopeKey,
      selected.hole,
      parsed.strokes,
      parsed.putts,
      selected.version,
    ].join(':');
    const identity =
      saveIdentityRef.current?.fingerprint === fingerprint
        ? saveIdentityRef.current
        : { fingerprint, id: `gsi_${secureUuidV4()}` };
    saveIdentityRef.current = identity;
    setDraft(current => ({ ...current, saving: true }));
    try {
      await ready.runtime.saveScore({
        baseVersion: selected.version,
        clientIntentId: identity.id,
        hole: selected.hole,
        putts: parsed.putts,
        strokes: parsed.strokes,
      });
      saveIdentityRef.current = null;
      await reloadReady(
        ready.runtime,
        'Loch lokal gespeichert. Crew synchronisiert es, sobald eine Verbindung möglich ist.',
      );
    } catch {
      setState(current =>
        current.status === 'ready'
          ? {
              ...current,
              message:
                'Lokal speichern war nicht möglich. Deine Eingabe bleibt auf dem Bildschirm.',
            }
          : current,
      );
    } finally {
      operationActiveRef.current = false;
      setDraft(current => ({ ...current, saving: false }));
    }
  };

  const resolveConflict = async () => {
    if (
      !ready ||
      !selected?.conflict ||
      draft.saving ||
      operationActiveRef.current
    ) {
      return;
    }
    operationActiveRef.current = true;
    const current = conflictIdentityRef.current;
    const identity =
      current?.clientMutationId === selected.conflict.clientMutationId
        ? current
        : {
            clientMutationId: selected.conflict.clientMutationId,
            id: `gsi_${secureUuidV4()}`,
          };
    conflictIdentityRef.current = identity;
    setDraft(value => ({ ...value, saving: true }));
    try {
      await ready.runtime.requeueConflict({
        clientIntentId: identity.id,
        clientMutationId: selected.conflict.clientMutationId,
        hole: selected.hole,
      });
      conflictIdentityRef.current = null;
      await reloadReady(
        ready.runtime,
        'Dein Offline-Stand bleibt erhalten und wurde erneut vorgemerkt.',
      );
    } catch {
      setState(currentState =>
        currentState.status === 'ready'
          ? {
              ...currentState,
              message:
                'Der Konflikt bleibt erhalten. Dein Offline-Stand wurde nicht verworfen.',
            }
          : currentState,
      );
    } finally {
      operationActiveRef.current = false;
      setDraft(value => ({ ...value, saving: false }));
    }
  };

  const sync = async () => {
    if (!ready || draft.saving || operationActiveRef.current) return;
    operationActiveRef.current = true;
    setDraft(value => ({ ...value, saving: true }));
    try {
      await ready.runtime.refresh();
      await reloadReady(ready.runtime);
    } catch (error) {
      if (error instanceof MobileSyncRootAccessDeniedError) {
        setState({ key: scopeKey ?? '', status: 'concealed' });
        return;
      }
      await reloadReady(
        ready.runtime,
        'Offline-Kopie aktiv. Crew versucht die Synchronisierung später erneut.',
      );
    } finally {
      operationActiveRef.current = false;
      setDraft(value => ({ ...value, saving: false }));
    }
  };

  return (
    <GolfScorecardView
      draft={draftModel}
      model={surface}
      onBack={onBack}
      onChangePutts={value =>
        setDraft(current => ({ ...current, putts: scoreInput(value) }))
      }
      onChangeStrokes={value =>
        setDraft(current => ({ ...current, strokes: scoreInput(value) }))
      }
      onClear={() =>
        setDraft(current => ({ ...current, putts: '', strokes: '' }))
      }
      onResolveConflict={resolveConflict}
      onRetry={() => setRefreshRequest(value => value + 1)}
      onSave={save}
      onSelectHole={setSelectedHole}
      onSync={sync}
      selectedHole={selectedHole}
    />
  );
}

function parseScoreValue(value: string): number | null {
  if (value === '') return null;
  return /^\d{1,3}$/.test(value) ? Number(value) : Number.NaN;
}

function scoreInput(value: string) {
  return value.replace(/\D/g, '').slice(0, 3);
}

const emptyPreview = {
  error: null,
  netStrokes: null,
  stablefordPoints: 0,
  valid: true,
} as const;
