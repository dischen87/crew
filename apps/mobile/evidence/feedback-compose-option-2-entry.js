import React, { useState } from 'react';
import { Alert, AppRegistry, Image, Platform, Settings } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { FeedbackComposeView } from '../src/screens/FeedbackComposeView';

const sourcePreviewUri = Image.resolveAssetSource(
  require('./event-hub-option-2/01-final-unscrolled-390x844.png'),
).uri;

const suggestion = {
  id: 'fbk_check_in',
  status: 'in_progress',
  title: 'Check-in klarer machen',
  voteCount: 4,
};

export const feedbackComposeEvidenceStates = Object.freeze([
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
const evidenceStateSet = new Set(feedbackComposeEvidenceStates);

export function resolveFeedbackComposeEvidenceState(rawState) {
  if (rawState === null || rawState === undefined) return 'text-only';
  if (!evidenceStateSet.has(rawState)) {
    throw new Error(`Unsupported CrewEvidenceState: ${String(rawState)}`);
  }
  return rawState;
}

function editing(overrides = {}) {
  return {
    body: 'QA QUELLE · ZÜRICH · 19 JULI. Ändert bitte die Übersicht 👩🏽‍💻',
    canShareWithEvent: true,
    diagnosticsConsented: false,
    diagnosticsPreview: {
      appVersion: '2.3.0',
      buildNumber: '81',
      contextCategory: 'Community Feedback',
      platform: Platform.OS === 'ios' ? 'iOS' : 'Android',
    },
    error: null,
    kind: 'editing',
    online: true,
    screenshot: { kind: 'none' },
    sourceLabel: 'Community Feedback · QA Quelle Zürich',
    submitting: false,
    title: 'ÖV-Plan für Zürich verbessern 🎉',
    visibility: 'event',
    ...overrides,
  };
}

function receipt(deliveryState, overrides = {}) {
  return {
    canRetry: deliveryState === 'attention',
    canSendWithoutScreenshot: false,
    deliveryState,
    failure:
      deliveryState === 'attention'
        ? 'Der Screenshot konnte nicht zugestellt werden.'
        : null,
    hasScreenshot: deliveryState === 'attention',
    kind: 'receipt',
    online: deliveryState !== 'pending',
    retrying: false,
    title: 'ÖV-Plan für Zürich verbessern 🎉',
    ...overrides,
  };
}

export function feedbackComposeInitialFor(rawState) {
  const state = resolveFeedbackComposeEvidenceState(rawState);
  if (state === 'unavailable') {
    return {
      duplicateSuggestions: { kind: 'idle' },
      view: { kind: 'unavailable' },
    };
  }
  if (state === 'receipt-pending') {
    return { duplicateSuggestions: { kind: 'idle' }, view: receipt('pending') };
  }
  if (state === 'receipt-attention') {
    return {
      duplicateSuggestions: { kind: 'idle' },
      view: receipt('attention', { canSendWithoutScreenshot: true }),
    };
  }
  if (state === 'receipt-delivered') {
    return {
      duplicateSuggestions: { kind: 'idle' },
      view: receipt('delivered', { hasScreenshot: true }),
    };
  }

  let duplicateSuggestions = { kind: 'idle' };
  if (state === 'duplicates-searching')
    duplicateSuggestions = { kind: 'searching' };
  if (state === 'duplicates-error') duplicateSuggestions = { kind: 'error' };
  if (state === 'duplicates-skipped')
    duplicateSuggestions = { kind: 'skipped' };
  if (state === 'duplicates-network' || state === 'duplicates-cache') {
    duplicateSuggestions = {
      items: [suggestion],
      kind: 'ready',
      source: state === 'duplicates-cache' ? 'cache' : 'network',
    };
  }

  let screenshot = { kind: 'none' };
  if (state === 'screenshot-loading') screenshot = { kind: 'loading' };
  if (state === 'screenshot-unavailable') screenshot = { kind: 'unavailable' };
  if (
    state === 'screenshot-preview-unchecked' ||
    state === 'screenshot-preview-checked'
  ) {
    screenshot = {
      busy: false,
      consented: state === 'screenshot-preview-checked',
      kind: 'preview',
      previewDataUri: sourcePreviewUri,
    };
  }

  return {
    duplicateSuggestions,
    view: editing({
      online: state !== 'duplicates-cache' && state !== 'duplicates-skipped',
      screenshot,
    }),
  };
}

export function FeedbackComposeEvidenceApp({
  evidenceState,
  initialMetrics,
} = {}) {
  const initial = feedbackComposeInitialFor(
    evidenceState === undefined
      ? Settings.get('CrewEvidenceState')
      : evidenceState,
  );
  const [duplicateSuggestions, setDuplicateSuggestions] = useState(
    initial.duplicateSuggestions,
  );
  const [view, setView] = useState(initial.view);

  const updateEditing = change =>
    setView(current =>
      current.kind === 'editing' ? { ...current, ...change } : current,
    );

  return (
    <SafeAreaProvider initialMetrics={initialMetrics}>
      <FeedbackComposeView
        duplicateSuggestions={duplicateSuggestions}
        onBodyChange={body => updateEditing({ body })}
        onDiagnosticsConsentChange={diagnosticsConsented =>
          updateEditing({ diagnosticsConsented })
        }
        onOpenDuplicateSuggestion={() => Alert.alert(suggestion.title)}
        onReturn={() => Alert.alert('Zurück zur App')}
        onRetry={() =>
          setView(current =>
            current.kind === 'receipt'
              ? {
                  ...current,
                  deliveryState: 'sending',
                  failure: null,
                  retrying: true,
                }
              : current,
          )
        }
        onRetryDuplicateSuggestions={() =>
          setDuplicateSuggestions({
            items: [suggestion],
            kind: 'ready',
            source: 'network',
          })
        }
        onScreenshotConsentChange={consented =>
          setView(current =>
            current.kind === 'editing' && current.screenshot.kind === 'preview'
              ? {
                  ...current,
                  screenshot: { ...current.screenshot, consented },
                }
              : current,
          )
        }
        onScreenshotRemove={() =>
          updateEditing({ screenshot: { kind: 'none' } })
        }
        onSendWithoutScreenshot={() =>
          setView(current =>
            current.kind === 'receipt'
              ? {
                  ...current,
                  canRetry: false,
                  canSendWithoutScreenshot: false,
                  deliveryState: 'pending',
                  failure: null,
                  hasScreenshot: false,
                  online: false,
                }
              : current,
          )
        }
        onSubmit={() =>
          setView(current =>
            current.kind === 'editing'
              ? receipt(current.online ? 'sending' : 'pending', {
                  hasScreenshot:
                    current.screenshot.kind === 'preview' &&
                    current.screenshot.consented,
                  title: current.title,
                })
              : current,
          )
        }
        onTitleChange={title => updateEditing({ title })}
        onVisibilityChange={visibility => updateEditing({ visibility })}
        state={view}
      />
    </SafeAreaProvider>
  );
}

AppRegistry.registerComponent('CrewNext', () => FeedbackComposeEvidenceApp);
