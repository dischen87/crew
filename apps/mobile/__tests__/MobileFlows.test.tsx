import { GatewayClientError, type Session } from '@crew/mobile-client';
import {
  MobileSyncAccountChangedError,
  MobileSyncEngine,
} from '@crew/mobile-data';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { Text, TextInput } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { Button } from '../src/design/primitives';
import { EmailIdentityScreen } from '../src/screens/EmailIdentityScreen';
import { EventRootList } from '../src/screens/EventsView';
import { InboundGateScreen } from '../src/screens/InboundGateScreen';
import { InvitePreviewScreen } from '../src/screens/InvitePreviewScreen';
import { SignInScreen } from '../src/screens/SignInScreen';
import { keychainPendingAuthReturnStore } from '../src/storage/pendingAuthReturn';
import { keychainPendingMagicLinkRequestStore } from '../src/storage/pendingMagicLinkRequest';
import { keychainPendingRouteStore } from '../src/storage/pendingRoute';

const mockGatewayClient = { request: jest.fn() };
const mockLifecycle = {
  accountId: null as string | null,
  reloadSession: jest.fn(async () => undefined),
  replaceSession: jest.fn(async () => undefined),
  status: 'signedOut' as 'loading' | 'signedOut' | 'unavailable' | 'ready',
};
const mockPrivateDatabase = {
  accountId: null as string | null,
  database: { all: jest.fn() },
};
const mockSyncRoot = jest.spyOn(MobileSyncEngine.prototype, 'syncRoot');

jest.mock('../src/app/GatewayProvider', () => ({
  useGatewayClient: () => mockGatewayClient,
}));

jest.mock('../src/app/PrivateBootstrapGate', () => ({
  usePrivateDatabase: () => mockPrivateDatabase,
  usePrivateSessionLifecycle: () => mockLifecycle,
}));

jest.mock('../src/storage/pendingRoute', () => ({
  keychainPendingRouteStore: {
    complete: jest.fn(async () => undefined),
    current: jest.fn(async () => null),
    peek: jest.fn(),
    put: jest.fn(),
  },
}));

jest.mock('../src/storage/pendingAuthReturn', () => ({
  keychainPendingAuthReturnStore: {
    complete: jest.fn(async () => true),
    peek: jest.fn(async () => null),
    set: jest.fn(async () => undefined),
  },
}));

jest.mock('../src/storage/pendingMagicLinkRequest', () => ({
  keychainPendingMagicLinkRequestStore: {
    complete: jest.fn(async () => true),
    getOrCreate: jest.fn(async (email: string) => ({
      createdAt: Date.now(),
      email,
      idempotencyKey: '00000000-0000-4000-8000-000000000001',
    })),
  },
}));

jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  return {
    ...actual,
    useSafeAreaInsets: () => ({ bottom: 34, left: 0, right: 0, top: 47 }),
  };
});

const authHandle = '00000000-0000-4000-8000-000000000001';
const inviteHandle = '00000000-0000-4000-8000-000000000002';
const authToken = `ml_${'a'.repeat(43)}`;
const inviteToken = 'abcdefghijklmnopqrst';
const accountId = `usr_${'a'.repeat(32)}`;

const session: Session = {
  accessToken: 'access-token',
  expiresInSeconds: 900,
  refreshToken: 'refresh-token',
  tokenType: 'Bearer',
  user: {
    email: 'crew@example.test',
    id: accountId,
    profile: {
      avatarUrl: null,
      displayName: 'Crew',
      eventReminders: true,
      locale: 'de-CH',
      productUpdates: false,
      reduceMotion: false,
      timeZone: 'Europe/Zurich',
      updatedAt: '2026-07-18T12:00:00Z',
      version: 1,
    },
  },
};

function textInside(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .flat(Infinity)
    .join(' ');
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGatewayClient.request.mockReset();
  mockSyncRoot.mockReset().mockResolvedValue({} as never);
  mockPrivateDatabase.accountId = accountId;
  mockPrivateDatabase.database.all.mockReset().mockResolvedValue([]);
  mockLifecycle.accountId = null;
  mockLifecycle.status = 'signedOut';
  mockLifecycle.reloadSession.mockReset().mockResolvedValue(undefined);
  mockLifecycle.replaceSession.mockReset().mockResolvedValue(undefined);
  jest
    .mocked(keychainPendingRouteStore.peek)
    .mockReset()
    .mockResolvedValue(null);
  jest
    .mocked(keychainPendingRouteStore.complete)
    .mockReset()
    .mockResolvedValue(undefined);
  jest
    .mocked(keychainPendingAuthReturnStore.peek)
    .mockReset()
    .mockResolvedValue(null);
  jest
    .mocked(keychainPendingAuthReturnStore.complete)
    .mockReset()
    .mockResolvedValue(true);
  jest
    .mocked(keychainPendingAuthReturnStore.set)
    .mockReset()
    .mockResolvedValue(undefined);
  jest
    .mocked(keychainPendingMagicLinkRequestStore.getOrCreate)
    .mockReset()
    .mockImplementation(async email => ({
      createdAt: Date.now(),
      email,
      idempotencyKey: authHandle,
    }));
  jest
    .mocked(keychainPendingMagicLinkRequestStore.complete)
    .mockReset()
    .mockResolvedValue(true);
});

afterAll(() => mockSyncRoot.mockRestore());

test('keeps magic-link redeem protected through session replacement and returns without token params', async () => {
  jest.mocked(keychainPendingRouteStore.peek).mockResolvedValue({
    createdAt: Date.now(),
    idempotencyKey: authHandle,
    kind: 'auth',
    token: authToken,
  });
  jest
    .mocked(keychainPendingAuthReturnStore.peek)
    .mockResolvedValue(inviteHandle);
  mockGatewayClient.request.mockResolvedValue({
    data: session,
    requestId: 'request-auth',
    status: 200,
  });
  const reset = jest.fn();

  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <EmailIdentityScreen
        navigation={{ reset } as never}
        route={{ params: { handle: authHandle } } as never}
      />,
    );
    await flush();
  });

  expect(mockGatewayClient.request).toHaveBeenCalledWith(
    'identityMagicLinksRedeem',
    expect.objectContaining({
      body: { token: authToken },
      headers: { 'idempotency-key': authHandle },
      signal: expect.anything(),
    }),
  );
  expect(mockLifecycle.replaceSession).toHaveBeenCalledWith(session);
  expect(keychainPendingRouteStore.complete).toHaveBeenCalledWith(authHandle);
  expect(keychainPendingAuthReturnStore.complete).not.toHaveBeenCalled();
  expect(reset).toHaveBeenCalledWith({
    index: 0,
    routes: [
      {
        name: 'InvitePreview',
        params: { handle: inviteHandle, autoRedeem: true },
      },
    ],
  });
  expect(JSON.stringify(reset.mock.calls)).not.toContain(authToken);
  expect(mockLifecycle.replaceSession.mock.invocationCallOrder[0]).toBeLessThan(
    jest.mocked(keychainPendingRouteStore.complete).mock.invocationCallOrder[0],
  );

  await ReactTestRenderer.act(async () => renderer!.unmount());
});

test('retains magic-link and return records across an offline redeem failure', async () => {
  jest.mocked(keychainPendingRouteStore.peek).mockResolvedValue({
    createdAt: Date.now(),
    idempotencyKey: authHandle,
    kind: 'auth',
    token: authToken,
  });
  mockGatewayClient.request.mockRejectedValue(new Error('offline'));

  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <EmailIdentityScreen
        navigation={{ reset: jest.fn() } as never}
        route={{ params: { handle: authHandle } } as never}
      />,
    );
    await flush();
  });

  expect(keychainPendingRouteStore.complete).not.toHaveBeenCalled();
  expect(keychainPendingAuthReturnStore.complete).not.toHaveBeenCalled();
  expect(textInside(renderer!)).toContain('Anmeldung nicht verfügbar');
  await ReactTestRenderer.act(async () => renderer!.unmount());
});

test('consumes a terminal magic link without exposing it and offers the existing sign-in route', async () => {
  jest.mocked(keychainPendingRouteStore.peek).mockResolvedValue({
    createdAt: Date.now(),
    idempotencyKey: authHandle,
    kind: 'auth',
    token: authToken,
  });
  mockGatewayClient.request.mockRejectedValue(
    new GatewayClientError({
      operationId: 'identityMagicLinksRedeem',
      status: 410,
      requestId: 'request-terminal-auth',
      code: 'MAGIC_LINK_INVALID',
      retryable: false,
      retryAfterSeconds: null,
    }),
  );
  const navigate = jest.fn();

  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <EmailIdentityScreen
        navigation={{ navigate } as never}
        route={{ params: { handle: authHandle } } as never}
      />,
    );
    await flush();
  });

  expect(keychainPendingRouteStore.complete).toHaveBeenCalledWith(authHandle);
  expect(textInside(renderer!)).toContain('Anmeldelink nicht verfügbar');
  expect(textInside(renderer!)).not.toMatch(
    /ml_|request-terminal-auth|MAGIC_LINK_INVALID/,
  );
  await ReactTestRenderer.act(async () => {
    renderer!.root.findByProps({ testID: 'identity-new-link' }).props.onPress();
  });
  expect(navigate).toHaveBeenCalledWith('SignIn');
  await ReactTestRenderer.act(async () => renderer!.unmount());
});

test('shows invite loading explicitly and never sends loading or unavailable bootstrap to sign-in', async () => {
  let finishPreview!: (value: unknown) => void;
  mockGatewayClient.request.mockReturnValue(
    new Promise(resolve => {
      finishPreview = resolve;
    }),
  );
  jest.mocked(keychainPendingRouteStore.peek).mockResolvedValue({
    createdAt: Date.now(),
    idempotencyKey: inviteHandle,
    kind: 'invite',
    token: inviteToken,
  });
  mockLifecycle.status = 'loading';
  const navigate = jest.fn();

  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <InvitePreviewScreen
        navigation={{ navigate } as never}
        route={{ params: { handle: inviteHandle } } as never}
      />,
    );
    await Promise.resolve();
  });
  expect(textInside(renderer!)).toContain('Einladung wird geprüft');
  expect(textInside(renderer!)).not.toContain('Einladung nicht verfügbar');

  await ReactTestRenderer.act(async () => {
    finishPreview({
      data: { ...invitePreview(), role: 'organizer' },
      requestId: 'preview',
      status: 200,
    });
    await flush();
  });
  expect(textInside(renderer!)).toMatch(/DEINE ROLLE\s+Organisation/);
  expect(renderer!.root.findAllByType(Button)).toHaveLength(0);
  expect(navigate).not.toHaveBeenCalledWith('SignIn');

  mockLifecycle.status = 'unavailable';
  await ReactTestRenderer.act(async () => {
    renderer!.update(
      <InvitePreviewScreen
        navigation={{ navigate } as never}
        route={{ params: { handle: inviteHandle } } as never}
      />,
    );
  });
  expect(renderer!.root.findAllByType(Button)).toHaveLength(1);
  await ReactTestRenderer.act(async () => {
    renderer!.root
      .findByProps({ testID: 'invite-session-retry' })
      .props.onPress();
    await flush();
  });
  expect(mockLifecycle.reloadSession).toHaveBeenCalledTimes(1);
  expect(mockGatewayClient.request.mock.calls.map(call => call[0])).toEqual([
    'eventInvitationsPreview',
  ]);
  expect(keychainPendingRouteStore.complete).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalledWith('SignIn');
  await ReactTestRenderer.act(async () => renderer!.unmount());
});

test('consumes an unusable invite and returns through the existing Events route', async () => {
  jest.mocked(keychainPendingRouteStore.peek).mockResolvedValue({
    createdAt: Date.now(),
    idempotencyKey: inviteHandle,
    kind: 'invite',
    token: inviteToken,
  });
  jest
    .mocked(keychainPendingAuthReturnStore.peek)
    .mockResolvedValue(inviteHandle);
  mockGatewayClient.request.mockResolvedValue({
    data: { ...invitePreview(), usable: false },
    requestId: 'preview-terminal',
    status: 200,
  });
  const navigate = jest.fn();

  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <InvitePreviewScreen
        navigation={{ navigate } as never}
        route={{ params: { handle: inviteHandle } } as never}
      />,
    );
    await flush();
  });

  expect(keychainPendingRouteStore.complete).toHaveBeenCalledWith(inviteHandle);
  expect(keychainPendingAuthReturnStore.complete).toHaveBeenCalledWith(
    inviteHandle,
  );
  expect(textInside(renderer!)).toContain('Einladung nicht verfügbar');
  expect(textInside(renderer!)).not.toMatch(
    /evt_root_a|preview-terminal|abcdefghijklmnopqrst/,
  );
  await ReactTestRenderer.act(async () => {
    renderer!.root
      .findByProps({ testID: 'invite-terminal-events' })
      .props.onPress();
  });
  expect(navigate).toHaveBeenCalledWith('Events');
  await ReactTestRenderer.act(async () => renderer!.unmount());
});

test('stores a signed-out invite return before using the existing sign-in route', async () => {
  jest.mocked(keychainPendingRouteStore.peek).mockResolvedValue({
    createdAt: Date.now(),
    idempotencyKey: inviteHandle,
    kind: 'invite',
    token: inviteToken,
  });
  mockGatewayClient.request.mockResolvedValue({
    data: invitePreview(),
    requestId: 'preview-signed-out',
    status: 200,
  });
  const navigate = jest.fn();

  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <InvitePreviewScreen
        navigation={{ navigate } as never}
        route={{ params: { handle: inviteHandle } } as never}
      />,
    );
    await flush();
  });

  expect(textInside(renderer!)).toContain('Mit E-Mail fortfahren');
  await ReactTestRenderer.act(async () => {
    await renderer!.root
      .findByProps({ testID: 'invite-redeem' })
      .props.onPress();
  });
  expect(keychainPendingAuthReturnStore.set).toHaveBeenCalledWith(inviteHandle);
  expect(navigate).toHaveBeenCalledWith('SignIn');
  expect(keychainPendingRouteStore.complete).not.toHaveBeenCalled();
  expect(textInside(renderer!)).not.toMatch(
    /evt_root_a|preview-signed-out|abcdefghijklmnopqrst/,
  );
  await ReactTestRenderer.act(async () => renderer!.unmount());
});

test('resumes an accepted organizer invite and completes both records only after redeem', async () => {
  mockLifecycle.accountId = accountId;
  mockLifecycle.status = 'ready';
  jest
    .mocked(keychainPendingAuthReturnStore.peek)
    .mockResolvedValue(inviteHandle);
  jest.mocked(keychainPendingRouteStore.peek).mockResolvedValue({
    createdAt: Date.now(),
    idempotencyKey: inviteHandle,
    kind: 'invite',
    token: inviteToken,
  });
  mockGatewayClient.request.mockImplementation(async operationId => {
    if (operationId === 'eventInvitationsPreview') {
      return {
        data: { ...invitePreview(), role: 'organizer' },
        requestId: 'preview',
        status: 200,
      };
    }
    return {
      data: {
        membership: {
          createdAt: '2026-07-18T12:00:00Z',
          role: 'organizer',
          rootEventId: 'evt_root_a',
          status: 'active',
          updatedAt: '2026-07-18T12:00:00Z',
          userId: accountId,
          version: 1,
        },
      },
      requestId: 'redeem',
      status: 200,
    };
  });
  const reset = jest.fn();

  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <InvitePreviewScreen
        navigation={{ reset } as never}
        route={{ params: { handle: inviteHandle, autoRedeem: true } } as never}
      />,
    );
    await flush();
    await flush();
  });

  expect(mockGatewayClient.request.mock.calls.map(call => call[0])).toEqual([
    'eventInvitationsPreview',
    'eventInvitationsRedeem',
  ]);
  expect(mockGatewayClient.request).toHaveBeenLastCalledWith(
    'eventInvitationsRedeem',
    expect.objectContaining({
      body: { token: inviteToken },
      headers: { 'idempotency-key': inviteHandle },
      signal: expect.anything(),
    }),
  );
  expect(keychainPendingRouteStore.complete).toHaveBeenCalledWith(inviteHandle);
  expect(keychainPendingAuthReturnStore.complete).toHaveBeenCalledWith(
    inviteHandle,
  );
  expect(reset).toHaveBeenCalledWith({
    index: 1,
    routes: [
      { name: 'Events' },
      { name: 'EventInbound', params: { rootEventId: 'evt_root_a' } },
    ],
  });
  expect(JSON.stringify(reset.mock.calls)).not.toContain(inviteToken);
  await ReactTestRenderer.act(async () => renderer!.unmount());
});

test('keeps an email-bound invite recoverable while switching to the invited account', async () => {
  mockLifecycle.accountId = accountId;
  mockLifecycle.status = 'ready';
  jest.mocked(keychainPendingRouteStore.peek).mockResolvedValue({
    createdAt: Date.now(),
    idempotencyKey: inviteHandle,
    kind: 'invite',
    token: inviteToken,
  });
  mockGatewayClient.request
    .mockResolvedValueOnce({
      data: { ...invitePreview(), emailBound: true },
      requestId: 'preview',
      status: 200,
    })
    .mockRejectedValueOnce(
      new GatewayClientError({
        operationId: 'eventInvitationsRedeem',
        status: 403,
        requestId: 'request-mismatch',
        code: 'INVITATION_EMAIL_MISMATCH',
        retryable: false,
        retryAfterSeconds: null,
      }),
    );
  const navigate = jest.fn();

  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <InvitePreviewScreen
        navigation={{ navigate } as never}
        route={{ params: { handle: inviteHandle, autoRedeem: true } } as never}
      />,
    );
    await flush();
    await flush();
  });

  expect(textInside(renderer!)).toContain('Anderes Konto erforderlich');
  expect(keychainPendingRouteStore.complete).not.toHaveBeenCalled();
  expect(keychainPendingAuthReturnStore.complete).not.toHaveBeenCalled();
  expect(keychainPendingAuthReturnStore.set).toHaveBeenCalledWith(inviteHandle);

  await ReactTestRenderer.act(async () => {
    await renderer!.root.findByType(Button).props.onPress();
  });
  expect(mockLifecycle.replaceSession).toHaveBeenCalledWith(null);
  expect(navigate).toHaveBeenCalledWith('SignIn');
  expect(keychainPendingRouteStore.complete).not.toHaveBeenCalled();
  await ReactTestRenderer.act(async () => renderer!.unmount());
});

test('reuses the same magic-link request idempotency key after a retry', async () => {
  mockGatewayClient.request
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({
      data: { accepted: true },
      requestId: 'request',
      status: 202,
    });

  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <SignInScreen navigation={{} as never} route={{} as never} />,
    );
  });
  await ReactTestRenderer.act(async () => {
    renderer!.root
      .findByType(TextInput)
      .props.onChangeText('Crew@Example.test');
  });
  await ReactTestRenderer.act(async () => {
    await renderer!.root.findByType(Button).props.onPress();
  });
  await ReactTestRenderer.act(async () => {
    await renderer!.root.findByType(Button).props.onPress();
  });

  const firstKey =
    mockGatewayClient.request.mock.calls[0][1].headers['idempotency-key'];
  const retryKey =
    mockGatewayClient.request.mock.calls[1][1].headers['idempotency-key'];
  expect(retryKey).toBe(firstKey);
  expect(mockGatewayClient.request.mock.calls[0][1].body.email).toBe(
    'crew@example.test',
  );
  expect(textInside(renderer!)).toContain(
    'Wenn die Adresse verwendet werden kann',
  );
  await ReactTestRenderer.act(async () => renderer!.unmount());
});

test('keeps duplicate event titles independently switchable by root event ID', async () => {
  const onSelect = jest.fn();

  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <EventRootList
        events={[
          eventRoot('evt_root_a', 'Weekend'),
          eventRoot('evt_root_b', 'Weekend'),
        ]}
        onSelect={onSelect}
      />,
    );
  });

  const firstButton = renderer!.root.findByProps({
    testID: 'event-evt_root_a',
  });
  const secondButton = renderer!.root.findByProps({
    testID: 'event-evt_root_b',
  });
  await ReactTestRenderer.act(async () => firstButton.props.onPress());
  await ReactTestRenderer.act(async () => secondButton.props.onPress());
  expect(onSelect.mock.calls).toEqual([['evt_root_a'], ['evt_root_b']]);

  await ReactTestRenderer.act(async () => renderer!.unmount());
});

test('conceals an unauthorized event root after the generated Gateway check', async () => {
  mockLifecycle.accountId = accountId;
  mockLifecycle.status = 'ready';
  mockGatewayClient.request.mockRejectedValue(
    new GatewayClientError({
      operationId: 'eventsGet',
      status: 404,
      requestId: 'request-private-root',
      code: 'NOT_FOUND',
      retryable: false,
      retryAfterSeconds: null,
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const navigate = jest.fn();

  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <QueryClientProvider client={client}>
        <InboundGateScreen
          navigation={{ navigate } as never}
          route={
            {
              name: 'EventInbound',
              params: { rootEventId: 'evt_private_root' },
            } as never
          }
        />
      </QueryClientProvider>,
    );
    await flush();
  });
  await ReactTestRenderer.act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
    await flush();
  });

  expect(mockGatewayClient.request).toHaveBeenCalledWith('eventsGet', {
    path: {
      eventId: 'evt_private_root',
      rootEventId: 'evt_private_root',
    },
  });
  expect(textInside(renderer!)).toContain('Dieser Inhalt ist nicht verfügbar.');
  expect(textInside(renderer!)).not.toMatch(
    /evt_private_root|request-private-root|NOT_FOUND/,
  );
  await ReactTestRenderer.act(async () =>
    renderer!.root.findByType(Button).props.onPress(),
  );
  expect(navigate).toHaveBeenCalledWith('Events');

  await ReactTestRenderer.act(async () => renderer!.unmount());
  client.clear();
});

test('retries an item route and resolves its real itinerary ID from the private projection', async () => {
  mockLifecycle.accountId = accountId;
  mockLifecycle.status = 'ready';
  let projectedRows: ReturnType<typeof itineraryRow>[] = [];
  mockPrivateDatabase.database.all.mockImplementation(
    async () => projectedRows,
  );
  mockSyncRoot.mockImplementation(async () => {
    projectedRows = [
      itineraryRow('iti_other', 'Andere Session'),
      itineraryRow('iti_private_item', 'Workshop'),
    ];
    return {} as never;
  });
  mockGatewayClient.request
    .mockRejectedValueOnce(new Error('offline iti_private_item'))
    .mockResolvedValueOnce({
      data: { event: { title: 'Sommerfest' } },
      requestId: 'request-recovered-root',
      status: 200,
    });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const navigate = jest.fn();

  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <QueryClientProvider client={client}>
        <InboundGateScreen
          navigation={{ navigate } as never}
          route={
            {
              name: 'ItemInbound',
              params: {
                rootEventId: 'evt_private_root',
                itemId: 'iti_private_item',
              },
            } as never
          }
        />
      </QueryClientProvider>,
    );
    await flush();
  });
  await ReactTestRenderer.act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
    await flush();
  });

  expect(textInside(renderer!)).toContain('Zugriff nicht bestätigt');
  expect(textInside(renderer!)).not.toMatch(
    /evt_private_root|iti_private_item|offline/,
  );
  await ReactTestRenderer.act(async () => {
    renderer!.root
      .findByProps({ testID: 'inbound-gate-retry' })
      .props.onPress();
    await new Promise(resolve => setTimeout(resolve, 0));
    await flush();
  });

  expect(mockGatewayClient.request).toHaveBeenNthCalledWith(2, 'eventsGet', {
    path: {
      eventId: 'evt_private_root',
      rootEventId: 'evt_private_root',
    },
  });
  expect(mockSyncRoot).toHaveBeenCalledWith(accountId, 'evt_private_root');
  expect(mockPrivateDatabase.database.all).toHaveBeenCalledWith(
    expect.any(String),
    [accountId, 'evt_private_root'],
  );
  expect(mockGatewayClient.request.mock.invocationCallOrder[1]).toBeLessThan(
    mockSyncRoot.mock.invocationCallOrder[0]!,
  );
  expect(mockSyncRoot.mock.invocationCallOrder[0]).toBeLessThan(
    mockPrivateDatabase.database.all.mock.invocationCallOrder[0]!,
  );
  expect(textInside(renderer!)).toContain('Workshop');
  expect(textInside(renderer!)).not.toContain('Andere Session');
  expect(textInside(renderer!)).not.toMatch(
    /evt_private_root|iti_private_item|request-recovered-root/,
  );

  await ReactTestRenderer.act(async () => renderer!.unmount());
  client.clear();
});

test('conceals an item when the active account changes during root sync', async () => {
  mockLifecycle.accountId = accountId;
  mockLifecycle.status = 'ready';
  mockGatewayClient.request.mockResolvedValue({
    data: { event: { title: 'Sommerfest' } },
    requestId: 'request-authorized-root',
    status: 200,
  });
  mockSyncRoot.mockRejectedValue(new MobileSyncAccountChangedError());
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <QueryClientProvider client={client}>
        <InboundGateScreen
          navigation={{ navigate: jest.fn() } as never}
          route={
            {
              name: 'ItemInbound',
              params: {
                rootEventId: 'evt_private_root',
                itemId: 'iti_private_item',
              },
            } as never
          }
        />
      </QueryClientProvider>,
    );
    await flush();
  });
  await ReactTestRenderer.act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
    await flush();
  });

  expect(textInside(renderer!)).toContain('Dieser Inhalt ist nicht verfügbar.');
  expect(
    renderer!.root.findAllByProps({ testID: 'inbound-gate-retry' }),
  ).toHaveLength(0);
  expect(mockPrivateDatabase.database.all).not.toHaveBeenCalled();
  expect(textInside(renderer!)).not.toMatch(
    /evt_private_root|iti_private_item|request-authorized-root/,
  );

  await ReactTestRenderer.act(async () => renderer!.unmount());
  client.clear();
});

function itineraryRow(id: string, title: string) {
  return {
    account_user_id: accountId,
    all_day: 0,
    created_at: '2026-07-18T12:00:00.000Z',
    deleted_at: null,
    details_json: '{}',
    details_schema_version: 1,
    ends_at: '2026-07-18T14:00:00.000Z',
    event_id: 'evt_private_session',
    id,
    notes: null,
    place_id: null,
    place_snapshot_json: null,
    root_event_id: 'evt_private_root',
    sort_key: '1',
    starts_at: '2026-07-18T13:00:00.000Z',
    status: 'active',
    time_zone: 'Europe/Zurich',
    title,
    updated_at: '2026-07-18T12:00:00.000Z',
    version: 1,
  };
}

function invitePreview() {
  return {
    emailBound: false,
    endsAt: null,
    role: 'participant' as const,
    rootEventId: 'evt_root_a',
    startsAt: null,
    title: 'Weekend',
    usable: true,
  };
}

function eventRoot(rootEventId: string, title: string) {
  return {
    createdAt: '2026-07-18T12:00:00Z',
    endsAt: null,
    kind: 'trip' as const,
    membershipStatus: 'active' as const,
    role: 'participant' as const,
    rootEventId,
    startsAt: null,
    status: 'published' as const,
    timeZone: 'Europe/Zurich',
    title,
    updatedAt: '2026-07-18T12:00:00Z',
    version: 1,
  };
}
