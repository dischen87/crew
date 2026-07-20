import React, { useEffect, useMemo, useState } from 'react';
import { Alert, AppRegistry, Settings } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { previewGolfDraft } from '../src/golf/GolfScorecardController';
import { GolfScorecardView } from '../src/screens/GolfScorecardView';

const holes = Array.from({ length: 18 }, (_, index) => ({
  authoritativePutts: null,
  authoritativeStablefordPoints: null,
  authoritativeStrokes: null,
  conflict: null,
  deliveryState: 'untouched',
  handicapStrokes: index === 17 ? 1 : index < 9 ? 1 : 0,
  hole: index + 1,
  isPending: false,
  netStrokes: null,
  par: [4, 5, 3][index % 3],
  putts: null,
  stablefordPoints: 0,
  strokeIndex: index + 1,
  strokes: null,
  version: 0,
}));

const leaderboard = [
  {
    holesCompleted: 18,
    isSelf: true,
    name: 'Du',
    rank: 1,
    stablefordPoints: 38,
    teamName: 'Mint Flight',
  },
  {
    holesCompleted: 18,
    isSelf: false,
    name: 'Marco',
    rank: 2,
    stablefordPoints: 36,
    teamName: 'Lavendel Flight',
  },
  {
    holesCompleted: 17,
    isSelf: false,
    name: 'Lena',
    rank: 3,
    stablefordPoints: 34,
    teamName: 'Mint Flight',
  },
];

const syncedStatus = {
  attentionCount: 0,
  nextAttemptAt: null,
  pendingCount: 0,
  state: 'synced',
  summary: 'All changes saved',
};

const participantQueued = {
  access: 'edit',
  eventTitle: '1. Runde · Carya Golf Club',
  holes: holes.map(hole =>
    hole.hole === 1
      ? {
          ...hole,
          deliveryState: 'queued',
          isPending: true,
          netStrokes: 3,
          putts: 1,
          stablefordPoints: 3,
          strokes: 4,
        }
      : hole,
  ),
  leaderboard,
  message:
    'Loch 1 lokal gespeichert. Crew synchronisiert es, sobald eine Verbindung möglich ist.',
  phase: 'ready',
  role: 'participant',
  roundVersion: 2,
  syncStatus: {
    ...syncedStatus,
    pendingCount: 1,
    state: 'pending',
    summary: 'Changes ready to save',
  },
};

const participantConflict = {
  ...participantQueued,
  holes: participantQueued.holes.map(hole =>
    hole.hole === 1
      ? {
          ...hole,
          authoritativePutts: 1,
          authoritativeStablefordPoints: 3,
          authoritativeStrokes: 4,
          conflict: {
            clientMutationId: 'evidence-conflict',
            currentVersion: 3,
            local: { putts: 2, stablefordPoints: 2, strokes: 5 },
            server: { putts: 1, stablefordPoints: 3, strokes: 4 },
          },
          deliveryState: 'conflict',
          netStrokes: 4,
          putts: 2,
          stablefordPoints: 2,
          strokes: 5,
          version: 3,
        }
      : hole,
  ),
  message: undefined,
  syncStatus: {
    ...syncedStatus,
    attentionCount: 1,
    state: 'needs_attention',
    summary: 'Some changes need attention',
  },
};

const readOnlyLeaderboard = {
  access: 'read',
  eventTitle: '1. Runde · Carya Golf Club',
  holes: [],
  leaderboard,
  phase: 'ready',
  role: 'organizer',
  roundVersion: 3,
  syncStatus: syncedStatus,
};

function GolfScorecardEvidenceApp() {
  const evidenceState = Settings.get('CrewEvidenceState') ?? 'participant-queued';
  const model =
    evidenceState === 'conflict'
      ? participantConflict
      : evidenceState === 'read-only'
        ? readOnlyLeaderboard
        : participantQueued;
  const [selectedHole, setSelectedHole] = useState(1);
  const selected =
    model.access === 'edit'
      ? model.holes.find(hole => hole.hole === selectedHole) ?? model.holes[0]
      : null;
  const [strokes, setStrokes] = useState('');
  const [putts, setPutts] = useState('');

  useEffect(() => {
    setStrokes(selected?.strokes == null ? '' : String(selected.strokes));
    setPutts(selected?.putts == null ? '' : String(selected.putts));
  }, [selected?.hole, selected?.putts, selected?.strokes]);

  const parsed = useMemo(
    () => ({
      putts: putts === '' ? null : Number(putts),
      strokes: strokes === '' ? null : Number(strokes),
    }),
    [putts, strokes],
  );
  const preview = selected
    ? previewGolfDraft(parsed, selected.par, selected.handicapStrokes)
    : previewGolfDraft({ putts: null, strokes: null }, 4, 0);
  const dirty = Boolean(
    selected &&
      (parsed.strokes !== selected.strokes || parsed.putts !== selected.putts),
  );

  return (
    <SafeAreaProvider>
      <GolfScorecardView
        draft={{ dirty, preview, putts, saving: false, strokes }}
        model={model}
        onBack={() => Alert.alert('Zurück zum Event')}
        onChangePutts={setPutts}
        onChangeStrokes={setStrokes}
        onClear={() => {
          setPutts('');
          setStrokes('');
        }}
        onResolveConflict={() => Alert.alert('Offline-Stand erneut vorgemerkt')}
        onRetry={() => Alert.alert('Scorekarte erneut laden')}
        onSave={() => Alert.alert('Loch lokal gespeichert')}
        onSelectHole={setSelectedHole}
        onSync={() => Alert.alert('Synchronisierung gestartet')}
        selectedHole={selectedHole}
      />
    </SafeAreaProvider>
  );
}

AppRegistry.registerComponent('CrewNext', () => GolfScorecardEvidenceApp);
