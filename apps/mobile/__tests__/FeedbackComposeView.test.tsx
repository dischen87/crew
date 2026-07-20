import React from 'react';
import { Dimensions, StyleSheet, Text, TextInput } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ReactTestRenderer from 'react-test-renderer';
import { contrastRatio, contrastThresholds } from '../src/design/contrast';
import { colors, componentMetrics } from '../src/design/theme';
import {
  FeedbackComposeView,
  type FeedbackComposeViewProps,
  type FeedbackComposeViewState,
} from '../src/screens/FeedbackComposeView';

const metrics = {
  frame: { height: 844, width: 390, x: 0, y: 0 },
  insets: { bottom: 34, left: 0, right: 0, top: 47 },
};
const originalWindow = Dimensions.get('window');
const originalScreen = Dimensions.get('screen');

function setFontScale(fontScale: number) {
  Dimensions.set({
    screen: { ...originalScreen, fontScale },
    window: { ...originalWindow, fontScale },
  });
}

beforeEach(() => setFontScale(1));
afterAll(() =>
  Dimensions.set({ screen: originalScreen, window: originalWindow }),
);

async function renderCompose(
  state: FeedbackComposeViewState,
  overrides: Partial<FeedbackComposeViewProps> = {},
) {
  const props: FeedbackComposeViewProps = {
    duplicateSuggestions: { kind: 'idle' },
    onBodyChange: jest.fn(),
    onDiagnosticsConsentChange: jest.fn(),
    onOpenDuplicateSuggestion: jest.fn(),
    onReturn: jest.fn(),
    onRetry: jest.fn(),
    onRetryDuplicateSuggestions: jest.fn(),
    onScreenshotConsentChange: jest.fn(),
    onScreenshotRemove: jest.fn(),
    onSendWithoutScreenshot: jest.fn(),
    onSubmit: jest.fn(),
    onTitleChange: jest.fn(),
    onVisibilityChange: jest.fn(),
    state,
    ...overrides,
  };
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <FeedbackComposeView {...props} />
      </SafeAreaProvider>,
    );
  });
  return { props, renderer: renderer! };
}

const editing = (
  overrides: Partial<
    Extract<FeedbackComposeViewState, { kind: 'editing' }>
  > = {},
): Extract<FeedbackComposeViewState, { kind: 'editing' }> => ({
  body: 'Ändert bitte die Übersicht 👩🏽‍💻',
  canShareWithEvent: true,
  diagnosticsConsented: false,
  diagnosticsPreview: {
    appVersion: '2.3.0',
    buildNumber: '81',
    contextCategory: 'Event-Kontext',
    platform: 'iOS',
  },
  error: null,
  kind: 'editing',
  online: false,
  screenshot: { kind: 'none' },
  sourceLabel: 'Event · Plan · Zürich',
  submitting: false,
  title: 'Unicode bleibt erhalten',
  visibility: 'event',
  ...overrides,
});

test('keeps text-only feedback independent and returns to the exact source callback', async () => {
  const onReturn = jest.fn();
  const onSubmit = jest.fn();
  const onVisibilityChange = jest.fn();
  const { renderer } = await renderCompose(editing(), {
    onReturn,
    onSubmit,
    onVisibilityChange,
  });

  expect(textInside(renderer)).toContain('Event · Plan · Zürich');
  expect(textInside(renderer).toLocaleLowerCase()).not.toContain('screenshot');
  expect(textInside(renderer).toLocaleLowerCase()).not.toContain('anhang');
  expect(
    renderer.root.findByProps({ testID: 'feedback-compose-title' }).props
      .maxLength,
  ).toBe(160);
  expect(
    renderer.root.findByProps({ testID: 'feedback-compose-body' }).props
      .maxLength,
  ).toBe(10_000);
  const visibilityChoice = renderer.root
    .findAll(
      node =>
        node.props.testID === 'feedback-visibility-event' &&
        node.props.style !== undefined,
    )
    .at(-1);
  const visibilityChoiceStyle =
    typeof visibilityChoice?.props.style === 'function'
      ? visibilityChoice.props.style({ pressed: false })
      : visibilityChoice?.props.style;
  expect(StyleSheet.flatten(visibilityChoiceStyle)).toEqual(
    expect.objectContaining({
      alignItems: 'stretch',
      flexDirection: 'column',
    }),
  );

  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'feedback-visibility-private' })
      .props.onPress(),
  );
  expect(onVisibilityChange).toHaveBeenCalledWith('private');
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'feedback-compose-submit' })
      .props.onPress(),
  );
  expect(onSubmit).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'feedback-compose-return' })
      .props.onPress(),
  );
  expect(onReturn).toHaveBeenCalledTimes(1);

  expect(componentMetrics.control.minimumTouchSize).toBeGreaterThanOrEqual(48);
  const heading = renderer.root.findByProps({ accessibilityRole: 'header' });
  expect(heading.props.allowFontScaling).not.toBe(false);
  expect(heading.props.maxFontSizeMultiplier).toBeUndefined();
  expect(heading.props.numberOfLines).toBeUndefined();
  expect(
    renderer.root
      .findAllByType(Text)
      .every(node => node.props.maxFontSizeMultiplier === undefined),
  ).toBe(true);
  expect(
    renderer.root
      .findAllByType(TextInput)
      .some(node =>
        Object.prototype.hasOwnProperty.call(
          node.props,
          'maxFontSizeMultiplier',
        ),
      ),
  ).toBe(false);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('shows sanitized cached duplicates as secondary 48-point actions without blocking submit', async () => {
  const onOpenDuplicateSuggestion = jest.fn();
  const { renderer } = await renderCompose(editing(), {
    duplicateSuggestions: {
      items: [
        {
          id: 'fbk_check_in',
          status: 'in_progress',
          title: 'Check-in klarer machen',
          voteCount: 4,
        },
      ],
      kind: 'ready',
      source: 'cache',
    },
    onOpenDuplicateSuggestion,
  });

  expect(textInside(renderer)).toContain('LETZTER ONLINE-STAND');
  expect(textInside(renderer)).toContain('In Umsetzung');
  expect(textInside(renderer)).toContain('4 Stimmen');
  expect(
    renderer.root.findByProps({ testID: 'feedback-compose-submit' }).props
      .disabled,
  ).toBe(false);
  const suggestion = renderer.root.findByProps({
    testID: 'feedback-duplicate-fbk_check_in',
  });
  expect(
    StyleSheet.flatten(suggestion.props.style({ pressed: false })).minHeight,
  ).toBeGreaterThanOrEqual(48);
  await ReactTestRenderer.act(() => suggestion.props.onPress());
  expect(onOpenDuplicateSuggestion).toHaveBeenCalledWith('fbk_check_in');
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('keeps search failure retry secondary and preserves the editable draft', async () => {
  const onRetryDuplicateSuggestions = jest.fn();
  const { renderer } = await renderCompose(editing(), {
    duplicateSuggestions: { kind: 'error' },
    onRetryDuplicateSuggestions,
  });

  expect(
    renderer.root.findByProps({ testID: 'feedback-compose-title' }).props.value,
  ).toBe('Unicode bleibt erhalten');
  expect(
    renderer.root.findByProps({ testID: 'feedback-compose-submit' }).props
      .disabled,
  ).toBe(false);
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'feedback-duplicates-retry' })
      .props.onPress(),
  );
  expect(onRetryDuplicateSuggestions).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('defaults diagnostics off, previews only bounded fields and requires an explicit choice', async () => {
  const onDiagnosticsConsentChange = jest.fn();
  const { renderer } = await renderCompose(editing(), {
    onDiagnosticsConsentChange,
  });
  const consent = renderer.root.findByProps({
    testID: 'feedback-diagnostics-consent',
  });
  const preview = renderer.root.findByProps({
    testID: 'feedback-diagnostics-preview',
  });

  expect(consent.props.accessibilityState).toMatchObject({ checked: false });
  expect(textInside(renderer)).toContain('Ohne deine Auswahl');
  expect(textInside(renderer)).toContain('2.3.0');
  expect(textInside(renderer)).toContain('81');
  expect(textInside(renderer)).toContain('iOS');
  expect(textInside(renderer)).toContain('Event-Kontext');
  expect(preview.props.accessibilityLabel).not.toContain('evt_');
  expect(preview.props.accessibilityLabel).not.toContain('event-hub/plan');
  expect(preview.props.accessible).toBe(true);
  for (const [copy, background] of [
    ['AUS DIESER ANSICHT', colors.surfaceAccent],
    ['WER SOLL ES SEHEN?', colors.surfaceBrand],
    ['OPTIONALE DIAGNOSEDATEN', colors.surfaceAccent],
    [
      'In diesen Diagnosedaten: keine Gerätekennung, Einladungs-Codes, Nachrichten, Logs oder Event-IDs.',
      colors.surfaceAccent,
    ],
  ] as const) {
    const node = renderer.root
      .findAllByType(Text)
      .find(candidate =>
        textInsideNode(candidate).replace(/\s+/g, ' ').trim().startsWith(copy),
      );
    const foreground = StyleSheet.flatten(node?.props.style).color as string;
    expect(foreground).toBe(colors.text);
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(
      contrastThresholds.normalText,
    );
  }
  expect(
    StyleSheet.flatten(consent.props.style({ pressed: false })).minHeight,
  ).toBeGreaterThanOrEqual(48);

  await ReactTestRenderer.act(() => consent.props.onPress());
  expect(onDiagnosticsConsentChange).toHaveBeenCalledWith(true);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('stacks complete diagnostics fields at 200 percent text without line caps', async () => {
  setFontScale(2);
  const { renderer } = await renderCompose(editing());
  const label = renderer.root
    .findAllByType(Text)
    .find(node => textInsideNode(node) === 'Kontext-Kategorie');
  const value = renderer.root
    .findAllByType(Text)
    .find(node => textInsideNode(node) === 'Event-Kontext');

  expect(StyleSheet.flatten(label?.parent?.props.style)).toMatchObject({
    flexDirection: 'column',
  });
  expect(StyleSheet.flatten(label?.props.style)).toMatchObject({
    flexShrink: 0,
  });
  expect(StyleSheet.flatten(value?.props.style)).toMatchObject({
    textAlign: 'left',
    width: '100%',
  });
  expect(label?.props.numberOfLines).toBeUndefined();
  expect(value?.props.numberOfLines).toBeUndefined();
  expect(label?.props.maxFontSizeMultiplier).toBeUndefined();
  expect(value?.props.maxFontSizeMultiplier).toBeUndefined();
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('keeps text submission available when runtime metadata is unavailable', async () => {
  const { renderer } = await renderCompose(
    editing({ diagnosticsPreview: null }),
  );

  expect(
    renderer.root.findAllByProps({
      testID: 'feedback-diagnostics-consent',
    }),
  ).toHaveLength(0);
  expect(textInside(renderer)).toContain(
    'Diagnosedaten sind nicht verfügbar. Text-Feedback bleibt möglich.',
  );
  expect(
    renderer.root.findByProps({ testID: 'feedback-compose-submit' }).props
      .disabled,
  ).toBe(false);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('shows only the bounded local screenshot preview and requires separate consent', async () => {
  const onScreenshotConsentChange = jest.fn();
  const onScreenshotRemove = jest.fn();
  const previewDataUri = 'data:image/png;base64,QUJDRA==';
  const { renderer } = await renderCompose(
    editing({
      screenshot: {
        busy: false,
        consented: false,
        kind: 'preview',
        previewDataUri,
      },
    }),
    { onScreenshotConsentChange, onScreenshotRemove },
  );

  expect(
    renderer.root.findByProps({ testID: 'feedback-screenshot-preview' }).props
      .source,
  ).toEqual({ uri: previewDataUri });
  const consent = renderer.root.findByProps({
    testID: 'feedback-screenshot-consent',
  });
  expect(consent.props.accessibilityState).toMatchObject({ checked: false });
  expect(
    renderer.root.findByProps({ testID: 'feedback-compose-submit' }).props
      .label,
  ).toBe('Text ohne Screenshot senden');
  expect(textInside(renderer)).not.toContain('sha256');
  expect(textInside(renderer)).not.toContain('retainedFileKey');

  await ReactTestRenderer.act(() => consent.props.onPress());
  expect(onScreenshotConsentChange).toHaveBeenCalledWith(true);
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'feedback-screenshot-remove' })
      .props.onPress(),
  );
  expect(onScreenshotRemove).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('renders long German and Unicode without fixed text-line caps', async () => {
  const longTitle = `Überraschung 🎉 ${'sehr lange Rückmeldung '.repeat(6)}`;
  const longBody = `ÖV, Côte d’Azur und Zürich 👨‍👩‍👧‍👦 — ${'vollständiger Text '.repeat(
    120,
  )}`;
  const { renderer } = await renderCompose(
    editing({ body: longBody, title: longTitle }),
  );

  expect(
    renderer.root.findByProps({ testID: 'feedback-compose-title' }).props.value,
  ).toBe(longTitle);
  expect(
    renderer.root.findByProps({ testID: 'feedback-compose-body' }).props.value,
  ).toBe(longBody);
  expect(
    renderer.root.findAll(
      node =>
        node.type === Text &&
        Object.prototype.hasOwnProperty.call(node.props, 'numberOfLines'),
    ),
  ).toHaveLength(0);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test.each([
  ['pending', 'WARTET AUF VERBINDUNG', 'Lokal gespeichert'],
  ['sending', 'WIRD GESENDET', 'Hintergrundversand läuft weiter'],
  ['attention', 'AKTION ERFORDERLICH', 'lokal erhalten'],
  ['delivered', 'ZUGESTELLT', 'vom Server bestätigt'],
] as const)('states %s honestly', async (deliveryState, chip, truth) => {
  const { renderer } = await renderCompose({
    canRetry: deliveryState === 'attention',
    canSendWithoutScreenshot: false,
    deliveryState,
    failure:
      deliveryState === 'attention'
        ? 'Deine Anmeldung muss erneut geprüft werden.'
        : null,
    hasScreenshot: false,
    kind: 'receipt',
    online: deliveryState !== 'pending',
    retrying: false,
    title: 'Mein gespeichertes Feedback',
  });

  expect(textInside(renderer)).toContain(chip);
  expect(textInside(renderer)).toContain(truth);
  if (deliveryState === 'attention') {
    expect(
      renderer.root.findByProps({ testID: 'feedback-compose-retry' }),
    ).toBeTruthy();
  }
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('does not offer a fake retry for terminal attention states', async () => {
  const { renderer } = await renderCompose({
    canRetry: false,
    canSendWithoutScreenshot: false,
    deliveryState: 'attention',
    failure: 'Der Server konnte dieses Feedback nicht annehmen.',
    hasScreenshot: false,
    kind: 'receipt',
    online: true,
    retrying: false,
    title: 'Nicht verloren',
  });

  expect(
    renderer.root.findAllByProps({ testID: 'feedback-compose-retry' }),
  ).toHaveLength(0);
  expect(
    renderer.root.findByProps({ testID: 'feedback-compose-return' }).props
      .label,
  ).toBe('Zur App zurück');
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('prioritizes the explicit text-only recovery as the sole attention action', async () => {
  const onSendWithoutScreenshot = jest.fn();
  const { renderer } = await renderCompose(
    {
      canRetry: true,
      canSendWithoutScreenshot: true,
      deliveryState: 'attention',
      failure: 'Der Screenshot konnte nicht zugestellt werden.',
      hasScreenshot: true,
      kind: 'receipt',
      online: true,
      retrying: false,
      title: 'Nicht verloren',
    },
    { onSendWithoutScreenshot },
  );

  expect(
    renderer.root.findAllByProps({ testID: 'feedback-compose-retry' }),
  ).toHaveLength(0);
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'feedback-compose-send-without-screenshot' })
      .props.onPress(),
  );
  expect(onSendWithoutScreenshot).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('keeps validation visible and prevents blank submission', async () => {
  const { renderer } = await renderCompose(
    editing({ body: ' ', error: 'Titel und Beschreibung sind erforderlich.' }),
  );

  expect(
    renderer.root.findByProps({ testID: 'feedback-compose-submit' }).props
      .disabled,
  ).toBe(true);
  expect(textInside(renderer)).toContain(
    'Titel und Beschreibung sind erforderlich.',
  );
  await ReactTestRenderer.act(() => renderer.unmount());
});

function textInside(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root
    .findAllByType(Text)
    .flatMap(node => node.props.children)
    .flat(Infinity)
    .join(' ');
}

function textInsideNode(node: ReactTestRenderer.ReactTestInstance) {
  return [node.props.children].flat(Infinity).join('');
}
