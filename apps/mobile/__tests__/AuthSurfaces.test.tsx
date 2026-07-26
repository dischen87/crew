import React from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ReactTestRenderer from 'react-test-renderer';
import { Button } from '../src/design/primitives';
import { colors, typography } from '../src/design/theme';
import {
  EmailIdentityView,
  type EmailIdentityViewPhase,
} from '../src/screens/EmailIdentityScreen';
import {
  InboundGateView,
  type InboundGateViewState,
} from '../src/screens/InboundGateScreen';
import {
  InvitePreviewView,
  type InvitePreview,
  type InvitePreviewPhase,
} from '../src/screens/InvitePreviewScreen';
import {
  PrivateAccessView,
  type PrivateAccessViewState,
} from '../src/screens/PrivateAccessScreen';
import { SignInView, type SignInViewState } from '../src/screens/SignInScreen';
import { UnavailableView } from '../src/screens/UnavailableScreen';

const metrics = {
  frame: { height: 844, width: 390, x: 0, y: 0 },
  insets: { bottom: 34, left: 0, right: 0, top: 47 },
};

async function render(element: React.ReactElement) {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>{element}</SafeAreaProvider>,
    );
  });
  return renderer!;
}

function textInside(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root
    .findAllByType(Text)
    .flatMap(node => node.props.children)
    .flat(Infinity)
    .filter(value => typeof value === 'string')
    .join(' ');
}

async function unmount(renderer: ReactTestRenderer.ReactTestRenderer) {
  await ReactTestRenderer.act(() => renderer.unmount());
}

test('keeps the Option 2 access shell exact, scrollable and naturally wrapping', async () => {
  const renderer = await render(
    <SignInView
      email=""
      onEmailChange={jest.fn()}
      onSubmit={jest.fn()}
      state="idle"
    />,
  );

  const scroller = renderer.root.findByType(ScrollView);
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
  expect(renderer.root.findByProps({ testID: 'sign-in-view' })).toBeTruthy();
  const heading = renderer.root.findByProps({ accessibilityRole: 'header' });
  expect(heading.props.allowFontScaling).not.toBe(false);
  expect(heading.props.maxFontSizeMultiplier).toBeUndefined();
  expect(heading.props.numberOfLines).toBeUndefined();

  for (const node of renderer.root.findAllByType(Text)) {
    expect(node.props.maxFontSizeMultiplier).toBeUndefined();
    expect(node.props.numberOfLines).toBeUndefined();
  }
  for (const node of renderer.root.findAllByType(Pressable)) {
    const style =
      typeof node.props.style === 'function'
        ? node.props.style({ pressed: false })
        : node.props.style;
    const minimum = StyleSheet.flatten(style).minHeight;
    if (minimum !== undefined) expect(minimum).toBeGreaterThanOrEqual(48);
  }

  await unmount(renderer);
});

test.each<SignInViewState>([
  'idle',
  'invalid',
  'submitting',
  'accepted',
  'unavailable',
])('renders the sign-in %s state without weakening the form', async state => {
  const onEmailChange = jest.fn();
  const onSubmit = jest.fn();
  const renderer = await render(
    <SignInView
      email="crew@example.test"
      onEmailChange={onEmailChange}
      onSubmit={onSubmit}
      state={state}
    />,
  );

  const input = renderer.root.findByType(TextInput);
  expect(input.props.accessibilityLabel).toBe('E-Mail-Adresse');
  expect(input.props.editable).toBe(state !== 'submitting');
  await ReactTestRenderer.act(() => input.props.onChangeText('next@test.ch'));
  expect(onEmailChange).toHaveBeenCalledWith('next@test.ch');

  const copy = textInside(renderer);
  if (state === 'accepted') {
    expect(copy).toContain('ANFRAGE ANGENOMMEN');
    expect(copy).toContain('Wenn die Adresse verwendet werden kann');
  }
  if (state === 'invalid') expect(copy).toContain('gültige E-Mail-Adresse');
  if (state === 'invalid') {
    expect(
      renderer.root
        .findByProps({ accessibilityLabel: 'EINGABE PRÜFEN' })
        .findAllByType(Image),
    ).toHaveLength(0);
  }
  if (state === 'unavailable') {
    expect(copy).toContain('Verbindung');
    expect(
      renderer.root
        .findByProps({ accessibilityLabel: 'GERADE NICHT VERFÜGBAR' })
        .findAllByType(Image),
    ).toHaveLength(1);
  }
  expect(copy).not.toMatch(/ml_[A-Za-z0-9]|usr_[a-f0-9]|evt_[A-Za-z0-9]/);

  await unmount(renderer);
});

test.each<EmailIdentityViewPhase>(['loading', 'retryable', 'expired'])(
  'renders the email identity %s recovery truth without a secret',
  async phase => {
    const onRetry = jest.fn();
    const onRequestNewLink = jest.fn();
    const renderer = await render(
      <EmailIdentityView
        onRequestNewLink={onRequestNewLink}
        onRetry={onRetry}
        phase={phase}
      />,
    );

    expect(textInside(renderer)).not.toMatch(
      /00000000-0000|ml_[A-Za-z0-9]|usr_[a-f0-9]|evt_[A-Za-z0-9]/,
    );
    expect(renderer.root.findAllByType(Button)).toHaveLength(
      phase === 'loading' ? 0 : 1,
    );
    if (phase === 'retryable') {
      const action = renderer.root.findByProps({ testID: 'identity-retry' });
      await ReactTestRenderer.act(() => action.props.onPress());
      expect(onRetry).toHaveBeenCalledTimes(1);
    }
    if (phase === 'expired') {
      expect(textInside(renderer)).toContain('ungültig oder abgelaufen');
      const action = renderer.root.findByProps({
        testID: 'identity-new-link',
      });
      await ReactTestRenderer.act(() => action.props.onPress());
      expect(onRequestNewLink).toHaveBeenCalledTimes(1);
    }

    await unmount(renderer);
  },
);

test.each<InvitePreviewPhase>([
  'loading',
  'accountMismatch',
  'terminal',
  'unavailable',
])('renders the invite %s state with concealed recovery', async phase => {
  const callbacks = {
    onBackToEvents: jest.fn(),
    onRedeem: jest.fn(),
    onRetry: jest.fn(),
    onRetrySession: jest.fn(),
    onSwitchAccount: jest.fn(),
  };
  const renderer = await render(
    <InvitePreviewView
      {...callbacks}
      phase={phase}
      preview={null}
      redeeming={false}
      sessionStatus="signedOut"
    />,
  );
  const copy = textInside(renderer);
  expect(copy).not.toMatch(
    /invite-secret|00000000-0000|usr_[a-f0-9]|evt_[A-Za-z0-9]/,
  );
  if (phase === 'loading') {
    expect(copy).toContain('noch keine privaten Event-Daten');
    expect(renderer.root.findAllByType(Button)).toHaveLength(0);
  } else {
    expect(renderer.root.findAllByType(Button)).toHaveLength(1);
  }
  if (phase === 'accountMismatch') {
    expect(copy).toContain('Anderes Konto erforderlich');
    expect(copy).not.toContain('crew@example.test');
  }
  if (phase === 'terminal') {
    expect(copy).toContain('Es wurde keine Mitgliedschaft erstellt');
    expect(
      renderer.root.findAllByProps({ testID: 'invite-preview-retry' }),
    ).toHaveLength(0);
  }

  await unmount(renderer);
});

test('renders signed-out and signed-in invite actions from one safe preview', async () => {
  const longTitle =
    'Strategiewoche für Produkt, Betrieb und internationale Partnerorganisationen';
  const preview: InvitePreview = {
    emailBound: true,
    endsAt: null,
    role: 'organizer',
    rootEventId: 'evt_private_root',
    startsAt: null,
    title: longTitle,
    usable: true,
  };
  const onRedeem = jest.fn();
  const props = {
    onBackToEvents: jest.fn(),
    onRedeem,
    onRetry: jest.fn(),
    onRetrySession: jest.fn(),
    onSwitchAccount: jest.fn(),
    phase: 'ready' as const,
    preview,
    redeeming: false,
  };
  const signedOut = await render(
    <InvitePreviewView {...props} sessionStatus="signedOut" />,
  );
  expect(textInside(signedOut)).toContain('Mit E-Mail fortfahren');
  expect(JSON.stringify(signedOut.toJSON())).not.toContain('evt_private_root');
  const title = signedOut.root
    .findAllByType(Text)
    .find(node => node.props.children === longTitle);
  expect(title?.props.numberOfLines).toBeUndefined();
  const roleLabel = signedOut.root
    .findAllByType(Text)
    .find(node => node.props.children === 'DEINE ROLLE');
  expect(StyleSheet.flatten(roleLabel?.props.style).color).toBe(colors.text);
  await ReactTestRenderer.act(() =>
    signedOut.root.findByProps({ testID: 'invite-redeem' }).props.onPress(),
  );
  expect(onRedeem).toHaveBeenCalledTimes(1);
  await unmount(signedOut);

  const ready = await render(
    <InvitePreviewView {...props} sessionStatus="ready" />,
  );
  expect(textInside(ready)).toContain('Einladung annehmen');
  expect(textInside(ready)).toContain('An eingeladene E-Mail gebunden');
  await unmount(ready);

  const preparing = await render(
    <InvitePreviewView {...props} sessionStatus="loading" />,
  );
  expect(textInside(preparing)).toContain('ZUGANG WIRD VORBEREITET');
  expect(preparing.root.findAllByType(Button)).toHaveLength(0);
  await unmount(preparing);

  const unavailable = await render(
    <InvitePreviewView {...props} sessionStatus="unavailable" />,
  );
  expect(textInside(unavailable)).toContain('nicht angenommen');
  expect(unavailable.root.findAllByType(Button)).toHaveLength(1);
  await ReactTestRenderer.act(() =>
    unavailable.root
      .findByProps({ testID: 'invite-session-retry' })
      .props.onPress(),
  );
  expect(props.onRetrySession).toHaveBeenCalledTimes(1);
  expect(onRedeem).toHaveBeenCalledTimes(1);
  await unmount(unavailable);
});

test('preserves invite base typography and natural wrapping at Large Text', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

  try {
    renderer = await render(
      <InvitePreviewView
        onBackToEvents={jest.fn()}
        onRedeem={jest.fn()}
        onRetry={jest.fn()}
        onRetrySession={jest.fn()}
        onSwitchAccount={jest.fn()}
        phase="ready"
        preview={{
          emailBound: true,
          endsAt: null,
          role: 'organizer',
          rootEventId: 'evt_private_root',
          startsAt: null,
          title:
            'Strategiewoche für Produkt, Betrieb und internationale Partnerorganisationen',
          usable: true,
        }}
        redeeming={false}
        sessionStatus="signedOut"
      />,
    );
    const description = renderer.root.findByProps({
      children:
        'Strategiewoche für Produkt, Betrieb und internationale Partnerorganisationen',
    });
    const role = renderer.root.findByProps({ children: 'Organisation' });

    expect(StyleSheet.flatten(description.props.style)).toMatchObject({
      fontSize: typography.body.fontSize,
      lineHeight: typography.body.lineHeight,
    });
    expect(StyleSheet.flatten(role.props.style)).toMatchObject({
      fontSize: typography.heading.fontSize,
      lineHeight: typography.heading.lineHeight,
    });
    expect(description.props.lineBreakStrategyIOS).toBe('push-out');
    expect(role.props.lineBreakStrategyIOS).toBe('push-out');
    expect(description.props.maxFontSizeMultiplier).toBeUndefined();
    expect(role.props.maxFontSizeMultiplier).toBeUndefined();
    expect(description.props.numberOfLines).toBeUndefined();
    expect(role.props.numberOfLines).toBeUndefined();
  } finally {
    if (renderer) await unmount(renderer);
  }
});

test.each<PrivateAccessViewState>([
  'loading',
  'sessionRequired',
  'unavailable',
])('renders private access %s without private identifiers', async state => {
  const renderer = await render(
    <PrivateAccessView onAction={jest.fn()} state={state} />,
  );
  expect(textInside(renderer)).not.toMatch(/usr_[a-f0-9]|evt_[A-Za-z0-9]/);
  expect(renderer.root.findAllByType(Button)).toHaveLength(
    state === 'loading' ? 0 : 1,
  );
  await unmount(renderer);
});

test.each([
  [
    'secureStorage' as const,
    'geschützten Gerätespeicher gerade nicht sicher lesen',
    'GERÄTESCHUTZ NICHT ERREICHBAR',
  ],
  [
    'privateData' as const,
    'geschützten Offline-Daten nicht sicher öffnen',
    'PRIVATE DATEN GESPERRT',
  ],
])(
  'keeps Retry primary and exposes an accessible German %s safe escape',
  async (unavailableReason, description, statusLabel) => {
    const onRetry = jest.fn();
    const onSafeExit = jest.fn();
    const renderer = await render(
      <PrivateAccessView
        onAction={onRetry}
        onSafeExit={onSafeExit}
        state="unavailable"
        unavailableReason={unavailableReason}
      />,
    );

    const copy = textInside(renderer);
    expect(copy).toContain(description);
    expect(copy).toContain(statusLabel);
    expect(copy).toContain('privaten Daten bleiben unverändert');
    expect(copy).not.toMatch(/defekt|beschädigt|korrupt|keychain|usr_|evt_/i);
    const buttons = renderer.root.findAllByType(Button);
    expect(buttons.map(button => button.props.testID)).toEqual([
      'private-access-retry',
      'private-access-safe-exit',
    ]);
    expect(buttons[0].props.variant).toBe('action');
    expect(buttons[1].props.variant).toBe('surface');
    expect(buttons[1].props.accessibilityHint).toContain(
      'Private Offline-Daten werden nicht gelöscht',
    );

    await ReactTestRenderer.act(() => buttons[0].props.onPress());
    await ReactTestRenderer.act(() => buttons[1].props.onPress());
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onSafeExit).toHaveBeenCalledTimes(1);
    await unmount(renderer);
  },
);

test('announces safe-exit failure and locks both actions while confirmation is running', async () => {
  const pending = await render(
    <PrivateAccessView
      onAction={jest.fn()}
      onSafeExit={jest.fn()}
      safeExitState="pending"
      state="unavailable"
    />,
  );
  expect(
    pending.root.findByProps({ testID: 'private-access-retry' }).props.disabled,
  ).toBe(true);
  expect(
    pending.root.findByProps({ testID: 'private-access-safe-exit' }).props
      .loading,
  ).toBe(true);
  await unmount(pending);

  const failed = await render(
    <PrivateAccessView
      onAction={jest.fn()}
      onSafeExit={jest.fn()}
      safeExitState="failed"
      state="unavailable"
    />,
  );
  const failure = failed.root.findByProps({
    testID: 'private-access-safe-exit-error',
  });
  expect(failure.props.accessibilityRole).toBe('alert');
  expect(failure.props.accessibilityLiveRegion).toBe('assertive');
  expect(textInside(failed)).toContain(
    'Der sichere Wechsel konnte nicht abgeschlossen werden',
  );
  await unmount(failed);
});

test.each<InboundGateViewState>([
  { kind: 'loading' },
  { kind: 'retryable' },
  { kind: 'unavailable' },
  {
    kind: 'ready',
    title:
      'Sehr langes internationales Event mit mehreren Arbeitsgruppen und Reiseabschnitten',
  },
])('renders inbound gate $kind with the correct safe action', async state => {
  const renderer = await render(
    <InboundGateView onEvents={jest.fn()} onRetry={jest.fn()} state={state} />,
  );
  const copy = textInside(renderer);
  expect(copy).not.toMatch(/request-|usr_[a-f0-9]|evt_[A-Za-z0-9]/);
  if (state.kind === 'retryable') expect(copy).toContain('Erneut versuchen');
  if (state.kind === 'unavailable') {
    expect(copy).toContain('Es werden keine Angaben');
    expect(copy).toContain('Zu Events');
  }
  await unmount(renderer);
});

test('keeps the generic unavailable surface fully concealed', async () => {
  const onEvents = jest.fn();
  const renderer = await render(<UnavailableView onEvents={onEvents} />);
  const copy = textInside(renderer);
  expect(copy).toContain(
    'Gehe zurück zu deinen Events und wähle dort einen verfügbaren Inhalt.',
  );
  expect(copy.match(/Inhalt nicht verfügbar/g)).toHaveLength(1);
  expect(copy).not.toMatch(/ungültig|abgelaufen|Konto|Root|Token|reason/i);
  await ReactTestRenderer.act(() =>
    renderer.root.findByProps({ testID: 'unavailable-events' }).props.onPress(),
  );
  expect(onEvents).toHaveBeenCalledTimes(1);
  await unmount(renderer);
});
