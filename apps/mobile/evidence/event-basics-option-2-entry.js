import React, { useState } from 'react';
import { Alert, AppRegistry, Settings } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { EventBasicsView } from '../src/screens/EventBasicsView';

const baseForm = {
  description: 'Zwei Tage gemeinsam am See.',
  endsAt: '2026-09-21 18:00',
  startsAt: '2026-09-20 09:00',
  timeZone: 'Europe/Zurich',
  title: 'Crew Retreat Zürich',
};

export const eventBasicsEvidenceStates = Object.freeze([
  'clean',
  'concealed',
  'conflict',
  'offline-dirty',
  'queued-offline',
  'validation',
]);
const evidenceStateSet = new Set(eventBasicsEvidenceStates);

export function resolveEventBasicsEvidenceState(rawState) {
  if (rawState === null || rawState === undefined) return 'clean';
  if (!evidenceStateSet.has(rawState)) {
    throw new Error(`Unsupported CrewEvidenceState: ${String(rawState)}`);
  }
  return rawState;
}

export function eventBasicsModelFor(rawState) {
  const state = resolveEventBasicsEvidenceState(rawState);
  const base = {
    busyAction: null,
    conflictCurrent: null,
    delivery: 'clean',
    dirty: true,
    editable: true,
    errors: {},
    focusField: null,
    form: baseForm,
    message: null,
    online: true,
    phase: 'ready',
    role: 'owner',
    saved: false,
  };
  if (state === 'queued-offline') {
    return {
      ...base,
      delivery: 'queued',
      dirty: false,
      editable: false,
      online: false,
      saved: true,
    };
  }
  if (state === 'offline-dirty') {
    return { ...base, online: false };
  }
  if (state === 'conflict') {
    return {
      ...base,
      conflictCurrent: {
        ...baseForm,
        description: 'Aktueller, serverbestätigter Stand.',
        title: 'Server Retreat Zürich',
      },
      delivery: 'conflict',
    };
  }
  if (state === 'validation') {
    return {
      ...base,
      errors: { endsAt: 'Das Ende muss nach dem Beginn liegen.' },
      focusField: 'endsAt',
    };
  }
  if (state === 'concealed') {
    return {
      ...base,
      dirty: false,
      editable: false,
      form: {
        description: '',
        endsAt: '',
        startsAt: '',
        timeZone: '',
        title: '',
      },
      phase: 'concealed',
      role: null,
    };
  }
  return base;
}

export function EventBasicsEvidenceApp({ evidenceState, initialMetrics } = {}) {
  const [model, setModel] = useState(() =>
    eventBasicsModelFor(
      evidenceState === undefined
        ? Settings.get('CrewEvidenceState')
        : evidenceState,
    ),
  );

  return (
    <SafeAreaProvider initialMetrics={initialMetrics}>
      <EventBasicsView
        model={model}
        onBack={() => Alert.alert('Zurück zur Prüfung')}
        onChange={(field, value) =>
          setModel(current => ({
            ...current,
            dirty: true,
            form: { ...current.form, [field]: value },
          }))
        }
        onPrimaryAction={action => {
          if (action === 'save') {
            setModel(current => ({
              ...current,
              delivery: 'queued',
              dirty: false,
              editable: false,
              online: false,
              saved: true,
            }));
            return;
          }
          Alert.alert(
            action === 'refresh' ? 'Online prüfen' : 'Zurück zur Prüfung',
          );
        }}
      />
    </SafeAreaProvider>
  );
}

AppRegistry.registerComponent('CrewNext', () => EventBasicsEvidenceApp);
