import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {
  CommunityFeedbackItemRouteScreen,
  CommunityFeedbackListRouteScreen,
  FeedbackComposeRouteScreen,
} from '../src/screens/FeedbackRoutes';

const mockCompose = jest.fn((_props: unknown) => null);
const mockList = jest.fn((_props: unknown) => null);
const mockItem = jest.fn((_props: unknown) => null);
const mockDiagnostics = {
  appVersion: '2.3.0',
  buildNumber: '81',
  platform: 'ios' as const,
};

jest.mock('../src/app/GatewayProvider', () => ({
  useRuntimeFeedbackDiagnostics: () => mockDiagnostics,
}));

jest.mock('../src/screens/FeedbackComposeScreen', () => ({
  FeedbackComposeScreen: (props: unknown) => mockCompose(props),
}));

jest.mock('../src/screens/CommunityFeedbackListScreen', () => ({
  CommunityFeedbackListScreen: (props: unknown) => mockList(props),
}));

jest.mock('../src/screens/CommunityFeedbackItemScreen', () => ({
  CommunityFeedbackItemScreen: (props: unknown) => mockItem(props),
}));

beforeEach(() => jest.clearAllMocks());

test('compose returns to the exact source stack entry and has a deterministic fallback', async () => {
  const navigation = navigationMock(true);
  await render(
    <FeedbackComposeRouteScreen
      navigation={navigation as never}
      route={
        {
          name: 'FeedbackCompose',
          params: {
            eventId: 'evt_day',
            rootEventId: 'evt_trip',
            screenKey: 'event-hub/plan',
            sourceLabel: 'Event · Plan',
          },
        } as never
      }
    />,
  );
  const props = mockCompose.mock.calls[0][0] as {
    availableDiagnostics: typeof mockDiagnostics;
    onReturn(): void;
    source: { screenKey: string };
  };
  expect(props.availableDiagnostics).toEqual(mockDiagnostics);
  expect(props.source.screenKey).toBe('event-hub/plan');
  props.onReturn();
  expect(navigation.goBack).toHaveBeenCalledTimes(1);
  expect(navigation.navigate).not.toHaveBeenCalled();

  const fallback = navigationMock(false);
  await render(
    <FeedbackComposeRouteScreen
      navigation={fallback as never}
      route={
        {
          name: 'FeedbackCompose',
          params: {
            rootEventId: 'evt_trip',
            screenKey: 'event-hub/plan',
            sourceLabel: 'Event · Plan',
          },
        } as never
      }
    />,
  );
  (mockCompose.mock.calls.at(-1)?.[0] as { onReturn(): void }).onReturn();
  expect(fallback.navigate).toHaveBeenCalledWith('EventInbound', {
    rootEventId: 'evt_trip',
  });
});

test('compose opens a duplicate suggestion only inside its exact root scope', async () => {
  const scopedNavigation = navigationMock(true);
  await render(
    <FeedbackComposeRouteScreen
      navigation={scopedNavigation as never}
      route={
        {
          name: 'FeedbackCompose',
          params: {
            rootEventId: 'evt_trip',
            screenKey: 'community-feedback/list',
            sourceLabel: 'Event · Feedback',
          },
        } as never
      }
    />,
  );
  const scopedProps = mockCompose.mock.calls.at(-1)?.[0] as {
    onOpenDuplicateSuggestion?(feedbackId: string): void;
  };
  scopedProps.onOpenDuplicateSuggestion?.('fbk_duplicate');
  expect(scopedNavigation.navigate).toHaveBeenCalledWith(
    'CommunityFeedbackItem',
    {
      feedbackId: 'fbk_duplicate',
      rootEventId: 'evt_trip',
    },
  );

  await render(
    <FeedbackComposeRouteScreen
      navigation={navigationMock(true) as never}
      route={
        {
          name: 'FeedbackCompose',
          params: {
            screenKey: 'events/list',
            sourceLabel: 'Events',
          },
        } as never
      }
    />,
  );
  expect(
    (mockCompose.mock.calls.at(-1)?.[0] as Record<string, unknown>)
      .onOpenDuplicateSuggestion,
  ).toBeUndefined();
});

test('list composes with bounded context and opens only root-scoped items', async () => {
  const navigation = navigationMock(true);
  await render(
    <CommunityFeedbackListRouteScreen
      navigation={navigation as never}
      route={
        {
          name: 'CommunityFeedbackList',
          params: { rootEventId: 'evt_trip' },
        } as never
      }
    />,
  );
  const props = mockList.mock.calls[0][0] as {
    onBack(): void;
    onCompose(): void;
    onComposeWithScreenshot(feedbackId: string): void;
    onOpenFeedback(feedbackId: string): void;
    rootEventId: string;
  };
  expect(props.rootEventId).toBe('evt_trip');
  props.onCompose();
  expect(navigation.navigate).toHaveBeenCalledWith('FeedbackCompose', {
    eventId: 'evt_trip',
    rootEventId: 'evt_trip',
    screenKey: 'community-feedback/list',
    sourceLabel: 'Event · Feedback',
  });
  navigation.navigate.mockClear();
  props.onComposeWithScreenshot('fbk_screenshot');
  expect(navigation.navigate).toHaveBeenCalledWith('FeedbackCompose', {
    eventId: 'evt_trip',
    feedbackId: 'fbk_screenshot',
    rootEventId: 'evt_trip',
    screenKey: 'community-feedback/list',
    sourceLabel: 'Event · Feedback',
  });
  props.onOpenFeedback('fbk_item');
  expect(navigation.navigate).toHaveBeenCalledWith('CommunityFeedbackItem', {
    feedbackId: 'fbk_item',
    rootEventId: 'evt_trip',
  });
  props.onBack();
  expect(navigation.goBack).toHaveBeenCalledTimes(1);
});

test('item replaces a merged ID canonically and falls back to the same root list', async () => {
  const navigation = navigationMock(false);
  await render(
    <CommunityFeedbackItemRouteScreen
      navigation={navigation as never}
      route={
        {
          name: 'CommunityFeedbackItem',
          params: { feedbackId: 'fbk_old', rootEventId: 'evt_trip' },
        } as never
      }
    />,
  );
  const props = mockItem.mock.calls[0][0] as {
    onBack(): void;
    onCanonicalFeedback(feedbackId: string): void;
  };
  props.onCanonicalFeedback('fbk_canonical');
  expect(navigation.replace).toHaveBeenCalledWith('CommunityFeedbackItem', {
    feedbackId: 'fbk_canonical',
    rootEventId: 'evt_trip',
  });
  props.onBack();
  expect(navigation.navigate).toHaveBeenCalledWith('CommunityFeedbackList', {
    rootEventId: 'evt_trip',
  });
});

function navigationMock(canGoBack: boolean) {
  return {
    canGoBack: jest.fn(() => canGoBack),
    goBack: jest.fn(),
    navigate: jest.fn(),
    replace: jest.fn(),
  };
}

async function render(element: React.ReactElement) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(element);
  });
  return renderer;
}
