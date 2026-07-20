import React from 'react';
import { Text, TextInput } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ReactTestRenderer from 'react-test-renderer';
import {
  CommunityFeedbackItemView,
  type CommunityFeedbackItem,
  type CommunityFeedbackItemViewModel,
  type CommunityFeedbackItemViewProps,
} from '../src/screens/CommunityFeedbackItemView';

const metrics = {
  frame: { height: 844, width: 390, x: 0, y: 0 },
  insets: { bottom: 34, left: 0, right: 0, top: 47 },
};

const feedback: CommunityFeedbackItem = {
  body: `Vollständiger Text mit Zürich, ÖV und Emoji 👩🏽‍💻. ${'Kein Abschneiden. '.repeat(
    70,
  )}`,
  commentCount: 1,
  comments: [
    {
      body: 'Der Kommentar bleibt anonymisiert und vollständig sichtbar.',
      createdAt: '2026-07-19T11:00:00.000Z',
      id: 'fbc_secret-comment',
    },
  ],
  commentsHasMore: false,
  duplicateCount: 1,
  followed: false,
  id: 'fbk_secret-feedback',
  status: 'in_progress',
  statusHistory: [
    {
      changedAt: '2026-07-18T10:00:00.000Z',
      fromStatus: null,
      note: 'Erste Prüfung gestartet.',
      toStatus: 'open',
      version: 1,
    },
    {
      changedAt: '2026-07-19T10:00:00.000Z',
      fromStatus: 'open',
      note: 'Das Team arbeitet daran.',
      toStatus: 'in_progress',
      version: 2,
    },
  ],
  statusHistoryCount: 2,
  statusHistoryHasMore: false,
  title: 'Lange Rückmeldung für die Event-Übersicht 🎉',
  updatedAt: '2026-07-19T10:00:00.000Z',
  viewerHasVoted: false,
  voteCount: 12,
};

const readyModel = (
  overrides: Partial<CommunityFeedbackItemViewModel> = {},
): CommunityFeedbackItemViewModel => ({
  commentBody: '',
  commentError: null,
  feedback,
  message: null,
  messageKind: null,
  online: true,
  phase: 'ready',
  redirected: false,
  working: null,
  ...overrides,
});

async function renderItem(
  model: CommunityFeedbackItemViewModel,
  overrides: Partial<CommunityFeedbackItemViewProps> = {},
) {
  const props: CommunityFeedbackItemViewProps = {
    model,
    onBack: jest.fn(),
    onCommentBodyChange: jest.fn(),
    onFollowChange: jest.fn(),
    onRefresh: jest.fn(),
    onSubmitComment: jest.fn(),
    onVoteChange: jest.fn(),
    ...overrides,
  };
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <CommunityFeedbackItemView {...props} />
      </SafeAreaProvider>,
    );
  });
  return { props, renderer: renderer! };
}

test('renders full sanitized detail, comments and nullable status history', async () => {
  const { renderer } = await renderItem(readyModel());
  const visible = textInside(renderer);

  expect(visible).toContain(feedback.body);
  expect(visible).toContain('Gestartet als Offen');
  expect(visible).toContain('Offen → In Arbeit');
  expect(visible).toContain(
    'Der Kommentar bleibt anonymisiert und vollständig sichtbar.',
  );
  expect(visible).not.toContain('fbk_secret-feedback');
  expect(visible).not.toContain('fbc_secret-comment');
  expect(
    renderer.root.findAll(
      node =>
        node.type === Text &&
        Object.prototype.hasOwnProperty.call(node.props, 'numberOfLines'),
    ),
  ).toHaveLength(0);
  const heading = renderer.root.findByProps({
    accessibilityRole: 'header',
    children: 'Feedback im Event',
  });
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

test('runs online vote, follow and comment controls through callbacks', async () => {
  const onCommentBodyChange = jest.fn();
  const onFollowChange = jest.fn();
  const onSubmitComment = jest.fn();
  const onVoteChange = jest.fn();
  const { renderer } = await renderItem(
    readyModel({ commentBody: 'Bitte so umsetzen.' }),
    {
      onCommentBodyChange,
      onFollowChange,
      onSubmitComment,
      onVoteChange,
    },
  );

  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'community-feedback-vote' })
      .props.onPress(),
  );
  expect(onVoteChange).toHaveBeenCalledWith(true);
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'community-feedback-follow' })
      .props.onPress(),
  );
  expect(onFollowChange).toHaveBeenCalledWith(true);
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'community-feedback-comment-input' })
      .props.onChangeText('Neue Eingabe'),
  );
  expect(onCommentBodyChange).toHaveBeenCalledWith('Neue Eingabe');
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'community-feedback-comment-submit' })
      .props.onPress(),
  );
  expect(onSubmitComment).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('disables every community write offline and states that nothing is queued', async () => {
  const onFollowChange = jest.fn();
  const onSubmitComment = jest.fn();
  const onVoteChange = jest.fn();
  const { renderer } = await renderItem(readyModel({ online: false }), {
    onFollowChange,
    onSubmitComment,
    onVoteChange,
  });

  expect(textInside(renderer)).toContain(
    'Online erforderlich. Es wurde nichts vorgemerkt.',
  );
  for (const testID of [
    'community-feedback-vote',
    'community-feedback-follow',
    'community-feedback-comment-submit',
  ]) {
    expect(renderer.root.findByProps({ testID }).props.disabled).toBe(true);
  }
  expect(onVoteChange).not.toHaveBeenCalled();
  expect(onFollowChange).not.toHaveBeenCalled();
  expect(onSubmitComment).not.toHaveBeenCalled();
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('mutually disables writes while any action is active', async () => {
  const { renderer } = await renderItem(readyModel({ working: 'vote' }));

  expect(
    renderer.root.findByProps({ testID: 'community-feedback-vote' }).props
      .loading,
  ).toBe(true);
  expect(
    renderer.root.findByProps({ testID: 'community-feedback-follow' }).props
      .disabled,
  ).toBe(true);
  expect(
    renderer.root.findByProps({ testID: 'community-feedback-comment-input' })
      .props.disabled,
  ).toBe(true);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('announces redirects without identifiers and keeps info messages non-alerting', async () => {
  const { renderer } = await renderItem(
    readyModel({
      message: 'Stimme gesendet.',
      messageKind: 'info',
      redirected: true,
    }),
  );

  expect(textInside(renderer)).toContain(
    'Diese Meldung wurde zusammengeführt. Du siehst jetzt die aktuelle Fassung.',
  );
  expect(textInside(renderer)).toContain('Stimme gesendet.');
  expect(
    renderer.root.findAll(
      node =>
        node.props.accessibilityRole === 'alert' &&
        node.children.includes('Stimme gesendet.'),
    ),
  ).toHaveLength(0);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('never renders unsafe generic fields even when supplied at runtime', async () => {
  const unsafe = {
    ...feedback,
    attachments: [{ id: 'att_NEVER' }],
    authorUserId: 'usr_NEVER',
    context: { rootEventId: 'evt_NEVER' },
    diagnostics: { platform: 'SECRET-PLATFORM' },
  } as CommunityFeedbackItem;
  const { renderer } = await renderItem(readyModel({ feedback: unsafe }));
  const visible = textInside(renderer);

  expect(visible).not.toContain('att_NEVER');
  expect(visible).not.toContain('usr_NEVER');
  expect(visible).not.toContain('evt_NEVER');
  expect(visible).not.toContain('SECRET-PLATFORM');
  await ReactTestRenderer.act(() => renderer.unmount());
});

test.each([
  ['loading', readyModel({ feedback: null, phase: 'loading' }), 'Eventzugriff'],
  [
    'removed',
    readyModel({ feedback: null, phase: 'removed' }),
    'nicht mehr Teil dieses Events',
  ],
  [
    'unavailable',
    readyModel({ feedback: null, phase: 'unavailable' }),
    'Geschützte Event- und Feedbackdaten bleiben verborgen',
  ],
] as const)('renders the %s boundary', async (_name, model, copy) => {
  const { renderer } = await renderItem(model);
  expect(textInside(renderer)).toContain(copy);
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
