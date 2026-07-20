import React, { useState } from 'react';
import { Alert, AppRegistry, Settings } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CommunityFeedbackListView } from '../src/screens/CommunityFeedbackListView';

const feedback = {
  body: 'QA QUELLE · ZÜRICH · 19 JULI. Die Übersicht soll verständlicher werden und der nächste Schritt sofort sichtbar sein.',
  duplicateCount: 2,
  followed: true,
  id: 'fbk_qa_zurich',
  status: 'planned',
  title: 'ÖV-Plan für Zürich verbessern 🎉',
  updatedAt: '2026-07-19T10:00:00.000Z',
  viewerHasVoted: true,
  voteCount: 7,
};

const update = {
  changedAt: '2026-07-19T10:00:00.000Z',
  feedbackId: feedback.id,
  fromStatus: null,
  note: 'Wir prüfen den Wunsch im nächsten Planungsschritt.',
  title: feedback.title,
  toStatus: 'open',
  version: 1,
};

export const communityFeedbackEvidenceStates = Object.freeze([
  'capture-busy',
  'capture-failure',
  'offline',
  'ready',
  'unavailable',
  'updates',
]);
const evidenceStateSet = new Set(communityFeedbackEvidenceStates);

export function resolveCommunityFeedbackEvidenceState(rawState) {
  if (rawState === null || rawState === undefined) return 'ready';
  if (!evidenceStateSet.has(rawState)) {
    throw new Error(`Unsupported CrewEvidenceState: ${String(rawState)}`);
  }
  return rawState;
}

export function communityFeedbackInitialFor(rawState) {
  const state = resolveCommunityFeedbackEvidenceState(rawState);
  return {
    captureBusy: state === 'capture-busy',
    captureMessage:
      state === 'capture-failure'
        ? 'Screenshot konnte nicht hinzugefügt werden. Du kannst weiterhin Text-Feedback geben.'
        : null,
    model: {
      followedOnly: false,
      items: state === 'unavailable' ? [] : [feedback],
      message: null,
      mode: state === 'updates' ? 'updates' : 'feedback',
      online: state !== 'offline',
      phase: state === 'unavailable' ? 'unavailable' : 'ready',
      query: '',
      refreshing: false,
      status: 'all',
      updates: state === 'unavailable' ? [] : [update],
    },
  };
}

export function CommunityFeedbackEvidenceApp({
  evidenceState,
  initialMetrics,
} = {}) {
  const initial = communityFeedbackInitialFor(
    evidenceState === undefined
      ? Settings.get('CrewEvidenceState')
      : evidenceState,
  );
  const [model, setModel] = useState(initial.model);
  const [captureBusy, setCaptureBusy] = useState(initial.captureBusy);
  const [captureMessage, setCaptureMessage] = useState(initial.captureMessage);

  return (
    <SafeAreaProvider initialMetrics={initialMetrics}>
      <CommunityFeedbackListView
        model={model}
        onBack={() => Alert.alert('Zurück')}
        onCompose={() => Alert.alert('Text-Feedback', 'Evidence interaction')}
        onComposeWithScreenshot={() => {
          setCaptureMessage(null);
          setCaptureBusy(true);
        }}
        onFollowedOnlyChange={followedOnly =>
          setModel(current => ({ ...current, followedOnly }))
        }
        onModeChange={mode => setModel(current => ({ ...current, mode }))}
        onOpenFeedback={() => Alert.alert(feedback.title)}
        onQueryChange={query => setModel(current => ({ ...current, query }))}
        onRefresh={() =>
          setModel(current => ({
            ...current,
            message: 'Aktueller Community-Stand geladen.',
            online: true,
            refreshing: false,
          }))
        }
        onStatusChange={status => setModel(current => ({ ...current, status }))}
        screenshotCaptureBusy={captureBusy}
        screenshotCaptureMessage={captureMessage}
      />
    </SafeAreaProvider>
  );
}

AppRegistry.registerComponent('CrewNext', () => CommunityFeedbackEvidenceApp);
