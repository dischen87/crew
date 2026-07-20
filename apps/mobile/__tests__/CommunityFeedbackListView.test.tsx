import React from 'react';
import { FlatList, StyleSheet, Text, TextInput } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ReactTestRenderer from 'react-test-renderer';
import { Button, FeedUpdateRow } from '../src/design/primitives';
import {
  CommunityFeedbackListView,
  type CommunityFeedbackListItem,
  type CommunityFeedbackListUpdate,
  type CommunityFeedbackListViewModel,
  type CommunityFeedbackListViewProps,
} from '../src/screens/CommunityFeedbackListView';

const metrics = {
  frame: { height: 844, width: 390, x: 0, y: 0 },
  insets: { bottom: 34, left: 0, right: 0, top: 47 },
};

const feedback: CommunityFeedbackListItem = {
  body: `Die Übersicht soll verständlicher werden. ${'Langer Text '.repeat(
    30,
  )}`,
  duplicateCount: 2,
  followed: true,
  id: 'fbk_secret-id',
  status: 'planned',
  title: 'ÖV-Plan für Zürich verbessern 🎉',
  updatedAt: '2026-07-19T10:00:00.000Z',
  viewerHasVoted: true,
  voteCount: 7,
};

const update: CommunityFeedbackListUpdate = {
  changedAt: '2026-07-19T10:00:00.000Z',
  feedbackId: 'fbk_secret-id',
  fromStatus: null,
  note: 'Wir prüfen den Wunsch im nächsten Planungsschritt.',
  title: 'ÖV-Plan für Zürich verbessern 🎉',
  toStatus: 'open',
  version: 1,
};

const readyModel = (
  overrides: Partial<CommunityFeedbackListViewModel> = {},
): CommunityFeedbackListViewModel => ({
  followedOnly: false,
  items: [feedback],
  message: null,
  mode: 'feedback',
  online: true,
  phase: 'ready',
  query: '',
  refreshing: false,
  status: 'all',
  updates: [update],
  ...overrides,
});

async function renderList(
  model: CommunityFeedbackListViewModel,
  overrides: Partial<CommunityFeedbackListViewProps> = {},
) {
  const props: CommunityFeedbackListViewProps = {
    model,
    onBack: jest.fn(),
    onCompose: jest.fn(),
    onComposeWithScreenshot: jest.fn(),
    onFollowedOnlyChange: jest.fn(),
    onModeChange: jest.fn(),
    onOpenFeedback: jest.fn(),
    onQueryChange: jest.fn(),
    onRefresh: jest.fn(),
    onStatusChange: jest.fn(),
    screenshotCaptureBusy: false,
    screenshotCaptureMessage: null,
    ...overrides,
  };
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <CommunityFeedbackListView {...props} />
      </SafeAreaProvider>,
    );
  });
  return { props, renderer: renderer! };
}

test('uses a virtualized root-scoped list and exposes working filters', async () => {
  const onFollowedOnlyChange = jest.fn();
  const onModeChange = jest.fn();
  const onOpenFeedback = jest.fn();
  const onQueryChange = jest.fn();
  const onStatusChange = jest.fn();
  const { renderer } = await renderList(readyModel(), {
    onFollowedOnlyChange,
    onModeChange,
    onOpenFeedback,
    onQueryChange,
    onStatusChange,
  });

  expect(renderer.root.findByType(FlatList)).toBeTruthy();
  expect(textInside(renderer)).toContain('EVENT-FEEDBACK');
  expect(textInside(renderer)).toContain('ÖV-Plan für Zürich verbessern 🎉');
  expect(textInside(renderer)).toContain('7 Stimmen');
  expect(textInside(renderer)).toContain('2 zusammengeführt');

  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'community-feedback-query' })
      .props.onChangeText('Zürich'),
  );
  expect(onQueryChange).toHaveBeenCalledWith('Zürich');
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ accessibilityLabel: 'Status Geplant' })
      .props.onPress(),
  );
  expect(onStatusChange).toHaveBeenCalledWith('planned');
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'community-feedback-followed-filter' })
      .props.onPress(),
  );
  expect(onFollowedOnlyChange).toHaveBeenCalledWith(true);
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'community-feedback-mode-updates' })
      .props.onPress(),
  );
  expect(onModeChange).toHaveBeenCalledWith('updates');
  await ReactTestRenderer.act(() =>
    renderer.root
      .find(
        node =>
          typeof node.props.accessibilityLabel === 'string' &&
          node.props.accessibilityLabel.includes('ÖV-Plan') &&
          typeof node.props.onPress === 'function',
      )
      .props.onPress(),
  );
  expect(onOpenFeedback).toHaveBeenCalledWith('fbk_secret-id');

  expect(
    renderer.root
      .findAllByType(Text)
      .some(node =>
        Object.prototype.hasOwnProperty.call(
          node.props,
          'maxFontSizeMultiplier',
        ),
      ),
  ).toBe(false);
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

test('lets the header action stack under large-text pressure', async () => {
  const { renderer } = await renderList(readyModel());
  const brandRow = renderer.root.findByProps({
    testID: 'community-feedback-brand-row',
  });

  expect(StyleSheet.flatten(brandRow.props.style)).toEqual(
    expect.objectContaining({
      flexDirection: 'row',
      flexWrap: 'wrap',
    }),
  );
  expect(
    renderer.root.findByProps({
      testID: 'community-feedback-header-back',
    }),
  ).toBeTruthy();
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('keeps the scrolling viewport below the safe area', async () => {
  const { renderer } = await renderList(readyModel());
  const list = renderer.root.findByType(FlatList);

  expect(StyleSheet.flatten(list.props.style)).toEqual(
    expect.objectContaining({ flex: 1, marginTop: metrics.insets.top }),
  );
  expect(StyleSheet.flatten(list.props.contentContainerStyle)).toEqual(
    expect.objectContaining({ paddingTop: 0 }),
  );
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('allows mode tabs to wrap instead of splitting words', async () => {
  const { renderer } = await renderList(readyModel());
  const modeTabs = renderer.root.findByProps({
    testID: 'community-feedback-mode-tabs',
  });
  const feedbackTab = renderer.root
    .findAll(
      node =>
        node.props.testID === 'community-feedback-mode-feedback' &&
        node.props.style !== undefined,
    )
    .at(-1);
  const feedbackTabStyle =
    typeof feedbackTab?.props.style === 'function'
      ? feedbackTab.props.style({ pressed: false })
      : feedbackTab?.props.style;

  expect(StyleSheet.flatten(modeTabs.props.style)).toEqual(
    expect.objectContaining({
      flexDirection: 'row',
      flexWrap: 'wrap',
    }),
  );
  expect(
    StyleSheet.flatten(feedbackTabStyle),
  ).toEqual(
    expect.objectContaining({
      flexBasis: 'auto',
      flexGrow: 1,
      flexShrink: 0,
    }),
  );
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('renders initial null status honestly without inventing unread state', async () => {
  const { renderer } = await renderList(
    readyModel({ mode: 'updates', updates: [update] }),
  );

  expect(textInside(renderer)).toContain('Gestartet als Offen');
  const row = renderer.root.findByType(FeedUpdateRow);
  expect(row.props.unread).toBeUndefined();
  expect(row.props.actor).toBe('CREW STATUS');
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('keeps text compose unchanged and presents screenshot capture as a separate secondary action', async () => {
  const onCompose = jest.fn();
  const onComposeWithScreenshot = jest.fn();
  const { renderer } = await renderList(readyModel(), {
    onCompose,
    onComposeWithScreenshot,
  });

  const textButton = renderer.root
    .findAllByType(Button)
    .find(node => node.props.testID === 'community-feedback-compose');
  const screenshotButton = renderer.root
    .findAllByType(Button)
    .find(
      node => node.props.testID === 'community-feedback-compose-screenshot',
    );
  expect(textButton?.props).toEqual(
    expect.objectContaining({ label: 'Feedback geben', variant: 'brand' }),
  );
  expect(screenshotButton?.props).toEqual(
    expect.objectContaining({
      accessibilityHint: expect.stringContaining('sichtbaren Feedback-Liste'),
      label: 'Screenshot hinzufügen',
      variant: 'surface',
    }),
  );

  await ReactTestRenderer.act(() => textButton?.props.onPress());
  await ReactTestRenderer.act(() => screenshotButton?.props.onPress());
  expect(onCompose).toHaveBeenCalledTimes(1);
  expect(onComposeWithScreenshot).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('announces screenshot capture progress and a safe recoverable failure', async () => {
  const { renderer } = await renderList(readyModel(), {
    screenshotCaptureBusy: true,
    screenshotCaptureMessage:
      'Screenshot konnte nicht hinzugefügt werden. Du kannst weiterhin Text-Feedback geben.',
  });
  const screenshotButton = renderer.root
    .findAllByType(Button)
    .find(
      node => node.props.testID === 'community-feedback-compose-screenshot',
    );

  expect(screenshotButton?.props.loading).toBe(true);
  expect(textInside(renderer)).toContain(
    'Screenshot konnte nicht hinzugefügt werden',
  );
  expect(
    renderer.root.findAll(
      node =>
        node.props.accessibilityLiveRegion === 'polite' &&
        textInsideNode(node).includes('Screenshot konnte'),
    ),
  ).not.toHaveLength(0);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('never renders generic author, diagnostics, attachment or context fields', async () => {
  const unsafe = {
    ...feedback,
    attachmentIds: ['att_DO-NOT-RENDER'],
    authorUserId: 'usr_DO-NOT-RENDER',
    context: { eventId: 'evt_DO-NOT-RENDER' },
    diagnostics: { osVersion: 'SECRET-DIAGNOSTIC' },
  } as CommunityFeedbackListItem;
  const { renderer } = await renderList(readyModel({ items: [unsafe] }));
  const visible = textInside(renderer);

  expect(visible).not.toContain('usr_DO-NOT-RENDER');
  expect(visible).not.toContain('att_DO-NOT-RENDER');
  expect(visible).not.toContain('evt_DO-NOT-RENDER');
  expect(visible).not.toContain('SECRET-DIAGNOSTIC');
  expect(visible).not.toContain('fbk_secret-id');
  await ReactTestRenderer.act(() => renderer.unmount());
});

test.each([
  [
    'loading',
    readyModel({ items: [], phase: 'loading' }),
    'Gespeichertes Feedback bleibt sichtbar',
  ],
  [
    'empty',
    readyModel({ items: [] }),
    'Noch kein sichtbares Feedback in diesem Event',
  ],
  [
    'search empty',
    readyModel({ items: [], query: 'nicht da' }),
    'Keine passenden Meldungen',
  ],
  [
    'offline',
    readyModel({ online: false }),
    'Offline. Du siehst die gespeicherte Liste',
  ],
  [
    'unavailable',
    readyModel({ items: [], phase: 'unavailable' }),
    'Dieser Inhalt ist nicht verfügbar',
  ],
] as const)('renders the %s boundary', async (_name, model, copy) => {
  const { renderer } = await renderList(model);
  expect(textInside(renderer)).toContain(copy);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('keeps long text reflowable and only summarizes list bodies', async () => {
  const { renderer } = await renderList(readyModel());
  const visible = textInside(renderer);
  expect(visible).toContain('Die Übersicht soll verständlicher werden.');
  expect(visible).toContain('…');
  expect(
    renderer.root.findAll(
      node =>
        node.type === Text &&
        Object.prototype.hasOwnProperty.call(node.props, 'numberOfLines'),
    ),
  ).toHaveLength(0);
  await ReactTestRenderer.act(() => renderer.unmount());
});

function textInside(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root
    .findAllByType(Text)
    .flatMap(node => node.props.children)
    .flat(Infinity)
    .join(' ')
    .replace(/\s+/g, ' ');
}

function textInsideNode(node: ReactTestRenderer.ReactTestInstance) {
  return node
    .findAllByType(Text)
    .flatMap(child => child.props.children)
    .flat(Infinity)
    .join(' ');
}
