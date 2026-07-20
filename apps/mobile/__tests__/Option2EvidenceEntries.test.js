import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import {
  EventBasicsEvidenceApp,
  eventBasicsEvidenceStates,
  eventBasicsModelFor,
} from '../evidence/event-basics-option-2-entry';
import {
  EventSetupRecoveryEvidenceApp,
  eventSetupRecoveryEvidenceStates,
  eventSetupRecoveryModelFor,
} from '../evidence/event-setup-recovery-option-2-entry';
import {
  CommunityFeedbackEvidenceApp,
  communityFeedbackEvidenceStates,
  communityFeedbackInitialFor,
} from '../evidence/community-feedback-option-2-entry';
import {
  FeedbackComposeEvidenceApp,
  feedbackComposeEvidenceStates,
  feedbackComposeInitialFor,
} from '../evidence/feedback-compose-option-2-entry';
import {
  AndroidEvidenceRunner,
  androidEvidenceStatusBarProps,
} from '../evidence/option-2-native-visual/android-runner-entry';

const metrics = {
  frame: { height: 844, width: 390, x: 0, y: 0 },
  insets: { bottom: 34, left: 0, right: 0, top: 47 },
};

test('pins every supported state name and rejects Settings typos', () => {
  expect(eventBasicsEvidenceStates).toEqual([
    'clean',
    'concealed',
    'conflict',
    'offline-dirty',
    'queued-offline',
    'validation',
  ]);
  expect(eventSetupRecoveryEvidenceStates).toEqual([
    'cached-offline',
    'cached-online',
    'capability',
    'concealed',
    'place-no-results',
    'place-results',
    'place-selected',
    'resolved',
    'template-selected',
    'template-unselected',
  ]);
  expect(communityFeedbackEvidenceStates).toEqual([
    'capture-busy',
    'capture-failure',
    'offline',
    'ready',
    'unavailable',
    'updates',
  ]);
  expect(feedbackComposeEvidenceStates).toEqual([
    'duplicates-cache',
    'duplicates-error',
    'duplicates-network',
    'duplicates-searching',
    'duplicates-skipped',
    'receipt-attention',
    'receipt-delivered',
    'receipt-pending',
    'screenshot-loading',
    'screenshot-preview-checked',
    'screenshot-preview-unchecked',
    'screenshot-unavailable',
    'text-only',
    'unavailable',
  ]);

  for (const state of eventBasicsEvidenceStates) {
    expect(eventBasicsModelFor(state)).toBeTruthy();
  }
  for (const state of eventSetupRecoveryEvidenceStates) {
    expect(eventSetupRecoveryModelFor(state)).toBeTruthy();
  }
  for (const state of communityFeedbackEvidenceStates) {
    expect(communityFeedbackInitialFor(state)).toBeTruthy();
  }
  for (const state of feedbackComposeEvidenceStates) {
    expect(feedbackComposeInitialFor(state)).toBeTruthy();
  }

  expect(() => eventBasicsModelFor('offline-dritty')).toThrow(
    'Unsupported CrewEvidenceState',
  );
  expect(() => eventSetupRecoveryModelFor('place-result')).toThrow(
    'Unsupported CrewEvidenceState',
  );
  expect(() => communityFeedbackInitialFor('capture-error')).toThrow(
    'Unsupported CrewEvidenceState',
  );
  expect(() => feedbackComposeInitialFor('preview')).toThrow(
    'Unsupported CrewEvidenceState',
  );
});

test('Android runner keeps dark system icons on its light Option 2 canvas', async () => {
  let renderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<AndroidEvidenceRunner />);
  });
  expect(androidEvidenceStatusBarProps).toEqual({ barStyle: 'dark-content' });
  expect(renderer.root.findByType(AndroidEvidenceRunner)).toBeTruthy();
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('EventBasics evidence edits and moves the clean form to an honest queued state', async () => {
  const renderer = await renderEvidence(EventBasicsEvidenceApp, 'clean');
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'event-basics-title' })
      .props.onChangeText('Crew Retreat Genf'),
  );
  expect(
    renderer.root.findByProps({ testID: 'event-basics-title' }).props.value,
  ).toBe('Crew Retreat Genf');
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'event-basics-primary-action' })
      .props.onPress(),
  );
  expect(textInside(renderer)).toContain('Lokal dauerhaft gespeichert');
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('Setup evidence distinguishes no results, results and a working selection', async () => {
  expect(
    eventSetupRecoveryModelFor('place-no-results').placeResults,
  ).toHaveLength(0);
  expect(
    eventSetupRecoveryModelFor('place-results').selectedPlaceId,
  ).toBeNull();
  expect(eventSetupRecoveryModelFor('place-selected').selectedPlaceId).toBe(
    'candidate_carya',
  );

  const renderer = await renderEvidence(
    EventSetupRecoveryEvidenceApp,
    'template-unselected',
  );
  expect(
    renderer.root.findAllByProps({ testID: 'event-setup-primary-action' }),
  ).toHaveLength(0);
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'event-setup-template-golf-tour' })
      .props.onPress(),
  );
  expect(
    renderer.root.findByProps({ testID: 'event-setup-primary-action' }).props
      .label,
  ).toBe('Setup übernehmen');
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'event-setup-primary-action' })
      .props.onPress(),
  );
  expect(textInside(renderer)).toContain('Aktueller Stand passt');
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('Community evidence keeps the exact source marker and exposes capture progress', async () => {
  jest.useFakeTimers();
  const renderer = await renderEvidence(CommunityFeedbackEvidenceApp, 'ready');
  expect(textInside(renderer)).toContain('QA QUELLE · ZÜRICH · 19 JULI');
  expect(textInside(renderer)).toContain('ÖV-Plan für Zürich verbessern 🎉');
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'community-feedback-compose-screenshot' })
      .props.onPress(),
  );
  const busyControl = renderer.root
    .findAllByProps({ testID: 'community-feedback-compose-screenshot' })
    .find(node => node.props.accessibilityState?.busy);
  expect(busyControl?.props.accessibilityState).toMatchObject({
    busy: true,
    disabled: true,
  });
  await ReactTestRenderer.act(() => renderer.unmount());
  await ReactTestRenderer.act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
});

test('Compose evidence makes preview consent and screenshot recovery interactive', async () => {
  const preview = await renderEvidence(
    FeedbackComposeEvidenceApp,
    'screenshot-preview-unchecked',
  );
  expect(
    preview.root.findByProps({ testID: 'feedback-compose-submit' }).props.label,
  ).toBe('Text ohne Screenshot senden');
  await ReactTestRenderer.act(() =>
    preview.root
      .findByProps({ testID: 'feedback-screenshot-consent' })
      .props.onPress(),
  );
  expect(
    preview.root.findByProps({ testID: 'feedback-compose-submit' }).props.label,
  ).toBe('Feedback mit Screenshot senden');
  await ReactTestRenderer.act(() => preview.unmount());

  const attention = await renderEvidence(
    FeedbackComposeEvidenceApp,
    'receipt-attention',
  );
  await ReactTestRenderer.act(() =>
    attention.root
      .findByProps({ testID: 'feedback-compose-send-without-screenshot' })
      .props.onPress(),
  );
  expect(textInside(attention)).toContain('WARTET AUF VERBINDUNG');
  expect(
    attention.root.findAllByProps({
      testID: 'feedback-compose-send-without-screenshot',
    }),
  ).toHaveLength(0);
  await ReactTestRenderer.act(() => attention.unmount());
});

async function renderEvidence(Component, state) {
  let renderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(
      <Component evidenceState={state} initialMetrics={metrics} />,
    );
  });
  return renderer;
}

function textInside(renderer) {
  return renderer.root
    .findAllByType(Text)
    .flatMap(node => node.props.children)
    .flat(Infinity)
    .join(' ');
}
