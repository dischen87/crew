import React from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
} from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { Button } from '../src/design/primitives';
import { RootNavigator } from '../src/navigation/RootNavigator';
import { ScreenFrame } from '../src/screens/ScreenFrame';
import { UnavailableScreen } from '../src/screens/UnavailableScreen';

jest.mock('../src/app/PrivateBootstrapGate', () => {
  const actual = jest.requireActual('../src/app/PrivateBootstrapGate');
  return {
    ...actual,
    usePrivateSessionLifecycle: () => ({
      accountId: null,
      reloadSession: jest.fn(async () => undefined),
      replaceSession: jest.fn(async () => undefined),
      status: 'signedOut',
    }),
  };
});

jest.mock('../src/screens/EventHubScreen', () => {
  const { Text: NativeText } = require('react-native');
  return {
    EventHubScreen: () => (
      <NativeText testID="production-event-hub">Event Hub</NativeText>
    ),
  };
});

jest.mock('../src/screens/EventPublishScreen', () => {
  const { Text: NativeText } = require('react-native');
  return {
    EventPublishScreen: () => (
      <NativeText testID="production-event-publish">Event Publish</NativeText>
    ),
  };
});

jest.mock('../src/screens/EventSetupRecoveryScreen', () => {
  const { Text: NativeText } = require('react-native');
  return {
    EventSetupRecoveryScreen: () => (
      <NativeText testID="production-event-setup-recovery">
        Event Setup Recovery
      </NativeText>
    ),
  };
});

jest.mock('../src/screens/EventBasicsScreen', () => {
  const { Text: NativeText } = require('react-native');
  return {
    EventBasicsScreen: () => (
      <NativeText testID="production-event-basics">Event Basics</NativeText>
    ),
  };
});

jest.mock('../src/screens/EventCreateScreen', () => {
  const { Text: NativeText } = require('react-native');
  return {
    EventCreateScreen: () => (
      <NativeText testID="production-event-create">Event Create</NativeText>
    ),
  };
});

jest.mock('../src/screens/EventsScreen', () => ({
  EventsScreen: () => null,
}));

jest.mock('../src/screens/InboundGateScreen', () => ({
  InboundGateScreen: () => null,
}));

jest.mock('../src/screens/InviteEditorScreen', () => {
  const { Text: NativeText } = require('react-native');
  return {
    InviteEditorScreen: () => (
      <NativeText testID="production-invite-editor">Invite Editor</NativeText>
    ),
  };
});

jest.mock('../src/screens/InviteManagerScreen', () => {
  const { Text: NativeText } = require('react-native');
  return {
    InviteManagerScreen: () => (
      <NativeText testID="production-invite-manager">
        Invite Manager
      </NativeText>
    ),
  };
});

jest.mock('../src/screens/PlanScreen', () => {
  const { Text: NativeText } = require('react-native');
  return {
    PlanRouteScreen: () => (
      <NativeText testID="production-plan">Plan</NativeText>
    ),
  };
});

jest.mock('../src/screens/PlanItemEditorScreen', () => {
  const { Text: NativeText } = require('react-native');
  return {
    PlanItemEditorRouteScreen: () => (
      <NativeText testID="production-plan-item-editor">
        Plan Item Editor
      </NativeText>
    ),
  };
});

jest.mock('../src/screens/LiveItemScreen', () => {
  const { Text: NativeText } = require('react-native');
  return {
    LiveItemScreen: () => (
      <NativeText testID="production-live-item">Live Item</NativeText>
    ),
  };
});

jest.mock('../src/screens/FeedbackRoutes', () => {
  const { Text: NativeText } = require('react-native');
  return {
    CommunityFeedbackItemRouteScreen: () => (
      <NativeText testID="production-community-feedback-item">
        Feedback Item
      </NativeText>
    ),
    CommunityFeedbackListRouteScreen: () => (
      <NativeText testID="production-community-feedback-list">
        Feedback List
      </NativeText>
    ),
    FeedbackComposeRouteScreen: () => (
      <NativeText testID="production-feedback-compose">
        Feedback Compose
      </NativeText>
    ),
  };
});

jest.mock('../src/screens/RecapScreen', () => {
  const { Text: NativeText } = require('react-native');
  return {
    RecapScreen: () => <NativeText testID="production-recap">Recap</NativeText>,
  };
});

jest.mock('../src/screens/TeamSetupScreen', () => ({
  TeamSetupScreen: () => null,
}));

jest.mock('../src/screens/TeamDecisionScreen', () => ({
  TeamDecisionScreen: () => null,
}));

jest.mock('../src/screens/TeamFeedScreen', () => {
  const { Text: NativeText } = require('react-native');
  return {
    TeamFeedScreen: () => (
      <NativeText testID="production-team-feed">Team Feed</NativeText>
    ),
  };
});

jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  return {
    ...actual,
    useSafeAreaInsets: () => ({ bottom: 34, left: 0, right: 0, top: 47 }),
  };
});

jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => {
    const { View: NativeView } = require('react-native');
    return {
      Navigator: ({ children }: { children: React.ReactNode }) => children,
      Screen: ({
        component: Component,
        name,
      }: {
        component: React.ElementType;
        name: string;
      }) => {
        const params =
          name === 'InvitePreview' || name === 'EmailIdentity'
            ? { handle: '00000000-0000-4000-8000-000000000001' }
            : name === 'TeamSetup'
            ? { eventId: 'evt_session', rootEventId: 'evt_root' }
            : name === 'TeamFeed'
            ? { eventId: 'evt_session', rootEventId: 'evt_root' }
            : name === 'Decision'
            ? { decisionId: 'dec_team', rootEventId: 'evt_root' }
            : name === 'RecapInbound'
            ? { rootEventId: 'evt_root', version: 'v2' }
            : name === 'EventPublish'
            ? { rootEventId: 'evt_root' }
            : name === 'EventSetupRecovery'
            ? {
                blocker: 'EVENT_TEMPLATE_REQUIRED',
                rootEventId: 'evt_root',
              }
            : name === 'EventBasicsEdit'
            ? { focusField: 'title', rootEventId: 'evt_root' }
            : name === 'Plan'
            ? { rootEventId: 'evt_root' }
            : name === 'PlanItemEditor'
            ? { eventId: 'evt_session', rootEventId: 'evt_root' }
            : name === 'LiveItem'
            ? { itemId: 'iti_session', rootEventId: 'evt_root' }
            : name === 'Invites' || name === 'InviteEditor'
            ? { rootEventId: 'evt_root' }
            : undefined;
        return (
          <NativeView testID={`screen-${name}`}>
            <Component
              navigation={{ navigate: jest.fn(), reset: jest.fn() }}
              route={{ name, params }}
            />
          </NativeView>
        );
      },
    };
  },
}));

function textInside(node: ReactTestRenderer.ReactTestInstance) {
  return node
    .findAllByType(Text)
    .map(text => text.props.children)
    .join(' ');
}

test('keeps public invite and auth screens available while private screens are signed out', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <RootNavigator privateStatus="signedOut" />,
    );
  });

  expect(
    textInside(renderer!.root.findByProps({ testID: 'screen-Events' })),
  ).toContain('Bitte anmelden');
  expect(
    textInside(renderer!.root.findByProps({ testID: 'screen-CreateEvent' })),
  ).toContain('Bitte anmelden');
  expect(
    textInside(renderer!.root.findByProps({ testID: 'screen-TeamFeed' })),
  ).toContain('Bitte anmelden');
  expect(
    textInside(
      renderer!.root.findByProps({ testID: 'screen-NativeE2EEvidence' }),
    ),
  ).toContain('Bitte anmelden');
  expect(
    textInside(
      renderer!.root.findByProps({ testID: 'screen-EventBasicsEdit' }),
    ),
  ).toContain('Bitte anmelden');
  expect(
    textInside(renderer!.root.findByProps({ testID: 'screen-Invites' })),
  ).toContain('Bitte anmelden');
  expect(
    textInside(renderer!.root.findByProps({ testID: 'screen-InviteEditor' })),
  ).toContain('Bitte anmelden');
  expect(
    textInside(renderer!.root.findByProps({ testID: 'screen-Plan' })),
  ).toContain('Bitte anmelden');
  expect(
    textInside(renderer!.root.findByProps({ testID: 'screen-LiveItem' })),
  ).toContain('Bitte anmelden');
  expect(
    renderer!.root
      .findByProps({ testID: 'screen-CreateEvent' })
      .findAllByProps({
        testID: 'production-event-create',
      }),
  ).toEqual([]);
  expect(
    renderer!.root
      .findByProps({ testID: 'screen-EventSetupRecovery' })
      .findAllByProps({ testID: 'production-event-setup-recovery' }),
  ).toEqual([]);
  expect(
    textInside(renderer!.root.findByProps({ testID: 'screen-InvitePreview' })),
  ).toContain('Einladung');
  expect(
    textInside(renderer!.root.findByProps({ testID: 'screen-EmailIdentity' })),
  ).toContain('Anmeldung');
  expect(
    textInside(renderer!.root.findByProps({ testID: 'screen-SignIn' })),
  ).toContain('Mit E-Mail anmelden');

  await ReactTestRenderer.act(async () => {
    renderer!.unmount();
  });
});

test('keeps the whole shell scrollable and its wrapping title uncapped for scaled text', async () => {
  const title =
    'Sehr lange Überschrift für grosse dynamische Schrift und schmale Geräte';
  const dismissKeyboard = jest
    .spyOn(Keyboard, 'dismiss')
    .mockImplementation(() => undefined);
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <ScreenFrame title={title} description="Description" />,
    );
  });

  const scroller = renderer!.root.findByType(ScrollView);
  const keyboardAvoider = renderer!.root.findByType(KeyboardAvoidingView);
  expect(keyboardAvoider.props).toMatchObject({
    behavior: 'padding',
    enabled: Platform.OS === 'android',
  });
  expect(StyleSheet.flatten(keyboardAvoider.props.style)).toMatchObject({
    flex: 1,
  });
  expect(scroller.props.automaticallyAdjustKeyboardInsets).toBe(true);
  expect(scroller.props.keyboardDismissMode).toBe(
    Platform.OS === 'ios' ? 'interactive' : 'on-drag',
  );
  expect(scroller.props.onScrollBeginDrag).toBe(dismissKeyboard);
  scroller.props.onScrollBeginDrag();
  expect(dismissKeyboard).toHaveBeenCalledTimes(1);
  expect(
    StyleSheet.flatten(scroller.props.contentContainerStyle),
  ).toMatchObject({
    flexGrow: 1,
    paddingBottom: 34,
    paddingTop: 0,
  });
  expect(StyleSheet.flatten(scroller.props.style)).toMatchObject({
    flex: 1,
    marginTop: 47,
  });
  expect(scroller.props.contentInsetAdjustmentBehavior).toBe('never');
  expect(scroller.props.scrollEnabled).not.toBe(false);
  const heading = scroller.findByProps({ accessibilityRole: 'header' });
  expect(heading.props.children).toBe(title);
  expect(heading.props.allowFontScaling).not.toBe(false);
  expect(heading.props.maxFontSizeMultiplier).toBeUndefined();
  expect(heading.props.numberOfLines).toBeUndefined();
  expect(
    renderer!.root
      .findAllByType(Text)
      .every(node => node.props.maxFontSizeMultiplier === undefined),
  ).toBe(true);

  await ReactTestRenderer.act(async () => {
    renderer!.unmount();
  });
  dismissKeyboard.mockRestore();
});

test('enables shared keyboard avoidance on Android', async () => {
  const originalOS = Platform.OS;
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    value: 'android',
  });
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

  try {
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <ScreenFrame title="Team Feed" description="Description" />,
      );
    });

    expect(renderer!.root.findByType(KeyboardAvoidingView).props).toMatchObject(
      {
        behavior: 'padding',
        enabled: true,
      },
    );
  } finally {
    await ReactTestRenderer.act(async () => renderer?.unmount());
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: originalOS,
    });
  }
});

test('routes an authorized event root through the production EventHubScreen', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <RootNavigator privateStatus="ready" />,
    );
  });

  expect(
    renderer!.root.findByProps({ testID: 'screen-EventInbound' }).findByProps({
      testID: 'production-event-hub',
    }),
  ).toBeTruthy();

  await ReactTestRenderer.act(async () => renderer!.unmount());
});

test('routes authorized draft review through the production EventPublishScreen', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <RootNavigator privateStatus="ready" />,
    );
  });

  expect(
    renderer!.root.findByProps({ testID: 'screen-EventPublish' }).findByProps({
      testID: 'production-event-publish',
    }),
  ).toBeTruthy();

  await ReactTestRenderer.act(async () => renderer!.unmount());
});

test('gates setup recovery privately and routes ready accounts to production', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <RootNavigator privateStatus="ready" />,
    );
  });

  expect(
    renderer!.root
      .findByProps({ testID: 'screen-EventSetupRecovery' })
      .findByProps({ testID: 'production-event-setup-recovery' }),
  ).toBeTruthy();

  await ReactTestRenderer.act(async () => renderer!.unmount());
});

test('routes the private plan, editor and live item production vertical', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <RootNavigator privateStatus="ready" />,
    );
  });

  expect(
    renderer!.root
      .findByProps({ testID: 'screen-Plan' })
      .findByProps({ testID: 'production-plan' }),
  ).toBeTruthy();
  expect(
    renderer!.root
      .findByProps({ testID: 'screen-PlanItemEditor' })
      .findByProps({ testID: 'production-plan-item-editor' }),
  ).toBeTruthy();
  expect(
    renderer!.root
      .findByProps({ testID: 'screen-LiveItem' })
      .findByProps({ testID: 'production-live-item' }),
  ).toBeTruthy();

  await ReactTestRenderer.act(async () => renderer!.unmount());
});

test('routes existing draft basics through the dedicated production editor', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <RootNavigator privateStatus="ready" />,
    );
  });

  expect(
    renderer!.root
      .findByProps({ testID: 'screen-EventBasicsEdit' })
      .findByProps({ testID: 'production-event-basics' }),
  ).toBeTruthy();

  await ReactTestRenderer.act(async () => renderer!.unmount());
});

test('routes private event creation through the production creation screen', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <RootNavigator privateStatus="ready" />,
    );
  });

  expect(
    renderer!.root.findByProps({ testID: 'screen-CreateEvent' }).findByProps({
      testID: 'production-event-create',
    }),
  ).toBeTruthy();

  await ReactTestRenderer.act(async () => renderer!.unmount());
});

test('routes an authorized recap through the production RecapScreen', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <RootNavigator privateStatus="ready" />,
    );
  });

  expect(
    renderer!.root.findByProps({ testID: 'screen-RecapInbound' }).findByProps({
      testID: 'production-recap',
    }),
  ).toBeTruthy();

  await ReactTestRenderer.act(async () => renderer!.unmount());
});

test('gates the Team Feed privately and routes ready accounts to production', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <RootNavigator privateStatus="ready" />,
    );
  });

  expect(
    renderer!.root.findByProps({ testID: 'screen-TeamFeed' }).findByProps({
      testID: 'production-team-feed',
    }),
  ).toBeTruthy();

  await ReactTestRenderer.act(async () => renderer!.unmount());
});

test('gates invitation management privately and routes ready accounts to production', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <RootNavigator privateStatus="ready" />,
    );
  });

  expect(
    renderer!.root.findByProps({ testID: 'screen-Invites' }).findByProps({
      testID: 'production-invite-manager',
    }),
  ).toBeTruthy();
  expect(
    renderer!.root.findByProps({ testID: 'screen-InviteEditor' }).findByProps({
      testID: 'production-invite-editor',
    }),
  ).toBeTruthy();

  await ReactTestRenderer.act(async () => renderer!.unmount());
});

test('routes all private feedback surfaces through production route adapters', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <RootNavigator privateStatus="ready" />,
    );
  });

  expect(
    renderer!.root
      .findByProps({ testID: 'screen-FeedbackCompose' })
      .findByProps({
        testID: 'production-feedback-compose',
      }),
  ).toBeTruthy();
  expect(
    renderer!.root
      .findByProps({ testID: 'screen-CommunityFeedbackList' })
      .findByProps({ testID: 'production-community-feedback-list' }),
  ).toBeTruthy();
  expect(
    renderer!.root
      .findByProps({ testID: 'screen-CommunityFeedbackItem' })
      .findByProps({ testID: 'production-community-feedback-item' }),
  ).toBeTruthy();

  await ReactTestRenderer.act(async () => renderer!.unmount());
});

test('uses a concealed unavailable fallback with a deterministic recovery', async () => {
  const navigate = jest.fn();
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <UnavailableScreen
        navigation={{ navigate } as never}
        route={{} as never}
      />,
    );
  });

  const copy = textInside(renderer!.root);
  expect(copy).toContain(
    'Gehe zurück zu deinen Events und wähle dort einen verfügbaren Inhalt.',
  );
  expect(copy.match(/Inhalt nicht verfügbar/g)).toHaveLength(1);
  expect(copy).not.toMatch(/ungültig|abgelaufen|Konto/);

  await ReactTestRenderer.act(async () => {
    renderer!.root.findByType(Button).props.onPress();
  });
  expect(navigate).toHaveBeenCalledWith('Events');

  await ReactTestRenderer.act(async () => {
    renderer!.unmount();
  });
});
