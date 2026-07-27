import React from 'react';
import {
  GatewayClientError,
  type GatewayErrorCode,
  type OperationId,
} from '@crew/mobile-client';
import { AccessibilityInfo, Alert, Share, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ReactTestRenderer from 'react-test-renderer';
import {
  InviteEditorScreen,
  setInviteAccessibilityFocus,
  validNativeInviteExpirySelection,
  validateInviteForm,
} from '../src/screens/InviteEditorScreen';
import {
  InviteManagerScreen,
  inviteManagerSession,
  listInvitations,
} from '../src/screens/InviteManagerScreen';

const mockAccountId = `usr_${'a'.repeat(32)}`;
const rootEventId = 'evt_turkey_golf';
const subject = { userId: mockAccountId };
const mockRequestAsUser = jest.fn();
const mockSessionSubject = jest.fn();
const mockSecureUuidV4 = jest.fn();
const mockPickExpiry = jest.fn();
const mockUsePreventRemove = jest.fn();
const mockGatewayClient = {
  requestAsUser: mockRequestAsUser,
  sessionSubject: mockSessionSubject,
};
let mockGatewayClientValue: typeof mockGatewayClient | null = mockGatewayClient;
const mockPrivateDatabase = { accountId: mockAccountId, database: {} };
let mockLocalStore: {
  listDrafts: jest.Mock;
  listInvitations: jest.Mock;
  listMemberships: jest.Mock;
  putDraft: jest.Mock;
};
let mockOnline = true;

jest.mock('@crew/mobile-data', () => {
  const actual = jest.requireActual('@crew/mobile-data');
  return {
    ...actual,
    MobileDataStore: jest.fn(() => mockLocalStore),
  };
});

jest.mock('../src/app/GatewayProvider', () => ({
  useGatewayClient: () => mockGatewayClientValue,
}));

jest.mock('../src/app/PrivateBootstrapGate', () => ({
  usePrivateDatabase: () => mockPrivateDatabase,
  usePrivateSessionLifecycle: () => ({
    accountId: mockAccountId,
    reloadSession: jest.fn(),
    replaceSession: jest.fn(),
    status: 'ready',
  }),
}));

jest.mock('../src/screens/useOnlineState', () => ({
  useOnlineState: () => mockOnline,
}));

jest.mock('../src/storage/secureRandom', () => ({
  secureUuidV4: () => mockSecureUuidV4(),
}));

jest.mock('../src/specs/NativeCrewInviteExpiry', () => ({
  __esModule: true,
  default: {
    pickExpiry: (...args: unknown[]) => mockPickExpiry(...args),
  },
}));

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  usePreventRemove: (...args: unknown[]) => mockUsePreventRemove(...args),
}));

jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  return {
    ...actual,
    useSafeAreaInsets: () => ({ bottom: 34, left: 0, right: 0, top: 47 }),
  };
});

const metrics = {
  frame: { height: 844, width: 390, x: 0, y: 0 },
  insets: { bottom: 34, left: 0, right: 0, top: 47 },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSecureUuidV4.mockReset();
  mockPickExpiry.mockReset();
  mockOnline = true;
  mockGatewayClientValue = mockGatewayClient;
  mockLocalStore = {
    listDrafts: jest.fn(async () => []),
    listInvitations: jest.fn(async () => []),
    listMemberships: jest.fn(async () => []),
    putDraft: jest.fn(async () => undefined),
  };
  mockSessionSubject.mockResolvedValue(subject);
  mockSecureUuidV4
    .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
    .mockReturnValueOnce('22222222-2222-4222-8222-222222222222')
    .mockReturnValue('33333333-3333-4333-8333-333333333333');
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.spyOn(Share, 'share').mockResolvedValue({
    action: Share.sharedAction,
  });
});

afterEach(() => jest.restoreAllMocks());

test('paginates the server membership and accepts only the active current manager', async () => {
  mockRequestAsUser
    .mockResolvedValueOnce({
      data: {
        items: [membership(`usr_${'b'.repeat(32)}`, 'owner')],
        pageInfo: { hasMore: true, nextCursor: 'next-memberships' },
      },
    })
    .mockResolvedValueOnce({
      data: {
        items: [membership(mockAccountId, 'organizer')],
        pageInfo: { hasMore: false, nextCursor: null },
      },
    });

  await expect(
    inviteManagerSession(
      {
        requestAsUser: mockRequestAsUser,
        sessionSubject: mockSessionSubject,
      } as never,
      mockAccountId,
      rootEventId,
    ),
  ).resolves.toMatchObject({
    activeMemberCount: 2,
    role: 'organizer',
    subject,
  });
  expect(mockRequestAsUser.mock.calls).toEqual([
    [
      subject,
      'eventMembershipsList',
      {
        path: { rootEventId },
        query: { cursor: undefined, limit: 200 },
      },
    ],
    [
      subject,
      'eventMembershipsList',
      {
        path: { rootEventId },
        query: { cursor: 'next-memberships', limit: 200 },
      },
    ],
  ]);
});

test('rejects repeated membership cursors instead of accepting a partial role', async () => {
  mockRequestAsUser
    .mockResolvedValueOnce({
      data: {
        items: [membership(mockAccountId, 'owner')],
        pageInfo: { hasMore: true, nextCursor: 'same-cursor' },
      },
    })
    .mockResolvedValueOnce({
      data: {
        items: [],
        pageInfo: { hasMore: true, nextCursor: 'same-cursor' },
      },
    });

  await expect(
    inviteManagerSession(
      {
        requestAsUser: mockRequestAsUser,
        sessionSubject: mockSessionSubject,
      } as never,
      mockAccountId,
      rootEventId,
    ),
  ).rejects.toThrow('Invite pagination incomplete');
  expect(mockRequestAsUser).toHaveBeenCalledTimes(2);
});

test('caps membership pagination at 25 pages', async () => {
  let page = 0;
  mockRequestAsUser.mockImplementation(async () => {
    page += 1;
    return {
      data: {
        items: [membership(mockAccountId, 'owner')],
        pageInfo: { hasMore: true, nextCursor: `cursor-${page}` },
      },
    };
  });

  await expect(
    inviteManagerSession(
      {
        requestAsUser: mockRequestAsUser,
        sessionSubject: mockSessionSubject,
      } as never,
      mockAccountId,
      rootEventId,
    ),
  ).rejects.toThrow('Invite pagination incomplete');
  expect(mockRequestAsUser).toHaveBeenCalledTimes(25);
});

test.each([
  ['missing cursor', { hasMore: true, nextCursor: null }],
  ['cursor despite completed page', { hasMore: false, nextCursor: 'extra' }],
] as const)(
  'rejects invitation pagination with %s',
  async (_label, pageInfo) => {
    mockRequestAsUser.mockImplementation(
      async (_subject: unknown, operation: string) => {
        if (operation === 'eventMembershipsList') {
          return {
            data: {
              items: [membership(mockAccountId, 'owner')],
              pageInfo: { hasMore: false, nextCursor: null },
            },
          };
        }
        if (operation === 'eventInvitationsList') {
          return {
            data: {
              items: [invitation('inv_partial', 'active', 1)],
              pageInfo,
            },
          };
        }
        throw new Error(`Unexpected operation ${operation}`);
      },
    );

    await expect(
      listInvitations(
        {
          requestAsUser: mockRequestAsUser,
          sessionSubject: mockSessionSubject,
        } as never,
        mockAccountId,
        rootEventId,
      ),
    ).rejects.toThrow('Invite pagination incomplete');
  },
);

test('conceals participant access before any invitation summary is requested', async () => {
  mockRequestAsUser.mockResolvedValue({
    data: {
      items: [membership(mockAccountId, 'participant')],
      pageInfo: { hasMore: false, nextCursor: null },
    },
  });
  const renderer = await renderManager();

  expect(textInside(renderer)).toContain(
    'Diese Einladungsverwaltung ist für dieses Konto nicht verfügbar.',
  );
  expect(
    mockRequestAsUser.mock.calls.map(([, operation]) => operation),
  ).toEqual(['eventMembershipsList']);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('never publishes stale summaries while the online role gate is pending, then conceals a participant', async () => {
  setStaleManagerCache();
  let resolveGate!: (value: unknown) => void;
  mockRequestAsUser.mockReturnValue(
    new Promise(resolve => {
      resolveGate = resolve;
    }),
  );
  const renderer = await renderManager();

  expect(textInside(renderer)).toContain('Einladungen werden geladen');
  expect(
    renderer.root.findAllByProps({
      testID: 'invite-manager-item-inv_stale_private',
    }),
  ).toHaveLength(0);
  expect(mockLocalStore.listMemberships).not.toHaveBeenCalled();
  expect(mockLocalStore.listInvitations).not.toHaveBeenCalled();

  await ReactTestRenderer.act(async () => {
    resolveGate({
      data: {
        items: [membership(mockAccountId, 'participant')],
        pageInfo: { hasMore: false, nextCursor: null },
      },
    });
    await flush();
  });
  expect(textInside(renderer)).toContain(
    'Diese Einladungsverwaltung ist für dieses Konto nicht verfügbar.',
  );
  expect(
    renderer.root.findAllByProps({
      testID: 'invite-manager-item-inv_stale_private',
    }),
  ).toHaveLength(0);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('conceals stale summaries when the online role gate returns 404', async () => {
  setStaleManagerCache();
  mockRequestAsUser.mockRejectedValue(
    gatewayError('eventMembershipsList', 404, 'NOT_FOUND', false),
  );
  const renderer = await renderManager();

  expect(textInside(renderer)).toContain('Einladungen nicht verfügbar');
  expect(
    renderer.root.findAllByProps({
      testID: 'invite-manager-item-inv_stale_private',
    }),
  ).toHaveLength(0);
  expect(mockLocalStore.listInvitations).not.toHaveBeenCalled();
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('keeps stale summaries hidden after an initial online network failure', async () => {
  setStaleManagerCache();
  mockRequestAsUser.mockRejectedValue(new Error('network unavailable'));
  const renderer = await renderManager();

  expect(textInside(renderer)).toContain('Serverprüfung erforderlich');
  expect(textInside(renderer)).toContain(
    'Ohne aktuelle Serverprüfung zeigt Crew keine gespeicherten Einladungen an.',
  );
  expect(
    renderer.root.findAllByProps({
      testID: 'invite-manager-item-inv_stale_private',
    }),
  ).toHaveLength(0);
  expect(mockLocalStore.listInvitations).not.toHaveBeenCalled();
  expect(
    renderer.root.findByProps({ testID: 'invite-manager-retry' }).props,
  ).toMatchObject({ disabled: false, label: 'Erneut versuchen' });
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('keeps only this-mount server-confirmed summaries after a transient refresh failure and retries', async () => {
  const active = invitation('inv_confirmed_refresh', 'active', 4);
  let listAttempt = 0;
  mockRequestAsUser.mockImplementation(
    async (_subject: unknown, operation: string) => {
      if (operation === 'eventMembershipsList') {
        return {
          data: {
            items: [membership(mockAccountId, 'owner')],
            pageInfo: { hasMore: false, nextCursor: null },
          },
        };
      }
      if (operation === 'eventInvitationsList') {
        listAttempt += 1;
        if (listAttempt === 2) throw new Error('refresh unavailable');
        return {
          data: {
            items: [
              {
                ...active,
                useCount: listAttempt === 3 ? 2 : 1,
              },
            ],
            pageInfo: { hasMore: false, nextCursor: null },
          },
        };
      }
      throw new Error(`Unexpected operation ${operation}`);
    },
  );
  const renderer = await renderManager();

  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ testID: 'invite-manager-refresh' })
      .props.onPress();
    await flush();
  });
  expect(
    renderer.root.findByProps({
      testID: 'invite-manager-item-inv_confirmed_refresh',
    }),
  ).toBeTruthy();
  expect(textInside(renderer)).toContain(
    'Der in dieser Sitzung bestätigte Stand bleibt sichtbar.',
  );
  expect(
    renderer.root.findByProps({ testID: 'invite-manager-refresh' }).props.label,
  ).toBe('Erneut versuchen');

  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ testID: 'invite-manager-refresh' })
      .props.onPress();
    await flush();
  });
  expect(textInside(renderer).replace(/\s+/g, ' ')).toContain(
    '2 von 4 genutzt',
  );
  expect(
    renderer.root.findByProps({ testID: 'invite-manager-refresh' }).props.label,
  ).toBe('Serverstand neu laden');
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('refreshes the manager list when returning from the invite editor', async () => {
  const before = invitation('inv_before_editor', 'active', 1);
  const created = invitation('inv_created_in_editor', 'active', 1);
  let listAttempt = 0;
  let onFocus: (() => void) | undefined;
  mockRequestAsUser.mockImplementation(
    async (_subject: unknown, operation: string) => {
      if (operation === 'eventMembershipsList') {
        return {
          data: {
            items: [membership(mockAccountId, 'owner')],
            pageInfo: { hasMore: false, nextCursor: null },
          },
        };
      }
      if (operation === 'eventInvitationsList') {
        listAttempt += 1;
        return {
          data: {
            items: listAttempt === 1 ? [before] : [created, before],
            pageInfo: { hasMore: false, nextCursor: null },
          },
        };
      }
      throw new Error(`Unexpected operation ${operation}`);
    },
  );
  const navigation = {
    addListener: jest.fn((event: string, listener: () => void) => {
      if (event === 'focus') onFocus = listener;
      return jest.fn();
    }),
    canGoBack: jest.fn(() => true),
    goBack: jest.fn(),
    navigate: jest.fn(),
  };
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(managerElement(navigation));
    await flush();
  });

  expect(
    renderer.root.findByProps({
      testID: 'invite-manager-item-inv_before_editor',
    }),
  ).toBeTruthy();
  expect(onFocus).toBeDefined();

  await ReactTestRenderer.act(async () => {
    onFocus?.();
    await flush();
  });

  expect(
    renderer.root.findByProps({
      testID: 'invite-manager-item-inv_created_in_editor',
    }),
  ).toBeTruthy();
  expect(listAttempt).toBe(2);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('lists safe summaries and revokes only after confirmation and a fresh role check', async () => {
  const active = invitation('inv_active_link', 'active', 4);
  mockRequestAsUser.mockImplementation(
    async (_subject: unknown, operation: string) => {
      if (operation === 'eventMembershipsList') {
        return {
          data: {
            items: [membership(mockAccountId, 'owner')],
            pageInfo: { hasMore: false, nextCursor: null },
          },
        };
      }
      if (operation === 'eventInvitationsList') {
        return {
          data: {
            items: [active],
            pageInfo: { hasMore: false, nextCursor: null },
          },
        };
      }
      if (operation === 'eventInvitationsRevoke') {
        return {
          data: {
            invitation: {
              ...active,
              normalizedEmailHint: null,
              status: 'revoked',
              version: 5,
            },
          },
        };
      }
      throw new Error(`Unexpected operation ${operation}`);
    },
  );
  const renderer = await renderManager();

  expect(textInside(renderer)).toContain('Aktiv');
  expect(textInside(renderer)).toContain('1 Mitglied');
  expect(
    renderer.root.findByProps({ accessibilityRole: 'summary' }).props
      .accessibilityLabel,
  ).toContain('3 Nutzungen verbleibend.');
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'invite-manager-revoke-inv_active_link' })
      .props.onPress(),
  );
  expect(Alert.alert).toHaveBeenCalledTimes(1);
  const actions = jest.mocked(Alert.alert).mock.calls[0]?.[2];
  const confirm = actions?.find(action => action.style === 'destructive');
  await ReactTestRenderer.act(async () => {
    confirm?.onPress?.();
    await flush();
  });

  const revokeCall = mockRequestAsUser.mock.calls.find(
    ([, operation]) => operation === 'eventInvitationsRevoke',
  );
  expect(revokeCall).toEqual([
    subject,
    'eventInvitationsRevoke',
    {
      body: { baseVersion: 4 },
      headers: {
        'idempotency-key': '11111111-1111-4111-8111-111111111111',
      },
      path: {
        invitationId: 'inv_active_link',
        rootEventId,
      },
    },
  ]);
  expect(
    mockRequestAsUser.mock.calls.map(([, operation]) => operation),
  ).toEqual([
    'eventMembershipsList',
    'eventInvitationsList',
    'eventMembershipsList',
    'eventInvitationsRevoke',
  ]);
  expect(textInside(renderer)).toContain('Widerrufen');
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('does not let an older refresh republish an active invitation after revoke succeeds', async () => {
  const active = invitation('inv_refresh_revoke_race', 'active', 4);
  let listAttempt = 0;
  let resolveRefresh!: (value: unknown) => void;
  const delayedRefresh = new Promise(resolve => {
    resolveRefresh = resolve;
  });
  mockRequestAsUser.mockImplementation(
    async (_subject: unknown, operation: string) => {
      if (operation === 'eventMembershipsList') {
        return {
          data: {
            items: [membership(mockAccountId, 'owner')],
            pageInfo: { hasMore: false, nextCursor: null },
          },
        };
      }
      if (operation === 'eventInvitationsList') {
        listAttempt += 1;
        if (listAttempt === 2) return delayedRefresh;
        return {
          data: {
            items: [active],
            pageInfo: { hasMore: false, nextCursor: null },
          },
        };
      }
      if (operation === 'eventInvitationsRevoke') {
        return {
          data: {
            invitation: {
              ...active,
              normalizedEmailHint: null,
              status: 'revoked',
              version: 5,
            },
          },
        };
      }
      throw new Error(`Unexpected operation ${operation}`);
    },
  );
  const renderer = await renderManager();

  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({
        testID: 'invite-manager-revoke-inv_refresh_revoke_race',
      })
      .props.onPress(),
  );
  const actions = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2];
  const confirm = actions?.find(action => action.style === 'destructive');
  if (!confirm?.onPress) throw new Error('Missing revoke confirmation');

  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ testID: 'invite-manager-refresh' })
      .props.onPress();
    await flush();
  });
  expect(
    renderer.root.findByProps({ testID: 'invite-manager-create' }).props
      .disabled,
  ).toBe(true);
  expect(
    renderer.root.findByProps({ testID: 'invite-manager-refresh' }).props,
  ).toMatchObject({ disabled: true, label: 'Wird aktualisiert' });
  expect(
    renderer.root.findByProps({
      testID: 'invite-manager-revoke-inv_refresh_revoke_race',
    }).props.disabled,
  ).toBe(true);

  await ReactTestRenderer.act(async () => {
    confirm.onPress?.();
    await flush();
  });
  expect(textInside(renderer)).toContain('Widerrufen');

  await ReactTestRenderer.act(async () => {
    resolveRefresh({
      data: {
        items: [active],
        pageInfo: { hasMore: false, nextCursor: null },
      },
    });
    await flush();
  });

  expect(textInside(renderer)).toContain('Widerrufen');
  expect(textInside(renderer)).not.toContain('Aktiv');
  expect(
    renderer.root.findAllByProps({
      testID: 'invite-manager-revoke-inv_refresh_revoke_race',
    }),
  ).toHaveLength(0);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('clears the server-confirmed fallback after revoke authority is denied', async () => {
  const active = invitation('inv_revoked_authority', 'active', 4);
  let membershipAttempt = 0;
  mockRequestAsUser.mockImplementation(
    async (_subject: unknown, operation: string) => {
      if (operation === 'eventMembershipsList') {
        membershipAttempt += 1;
        if (membershipAttempt === 1) {
          return {
            data: {
              items: [membership(mockAccountId, 'owner')],
              pageInfo: { hasMore: false, nextCursor: null },
            },
          };
        }
        if (membershipAttempt === 2) {
          throw gatewayError('eventMembershipsList', 403, 'FORBIDDEN', false);
        }
        throw new Error('authority refresh unavailable');
      }
      if (operation === 'eventInvitationsList') {
        return {
          data: {
            items: [active],
            pageInfo: { hasMore: false, nextCursor: null },
          },
        };
      }
      throw new Error(`Unexpected operation ${operation}`);
    },
  );
  const navigation = {
    addListener: jest.fn(() => jest.fn()),
    canGoBack: jest.fn(() => true),
    goBack: jest.fn(),
    navigate: jest.fn(),
  };
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(managerElement(navigation));
    await flush();
  });

  await confirmRevoke(renderer, active.id);
  expect(textInside(renderer)).toContain('Einladungen nicht verfügbar');

  mockOnline = false;
  await ReactTestRenderer.act(async () => {
    renderer.update(managerElement(navigation));
    await flush();
  });
  mockOnline = true;
  await ReactTestRenderer.act(async () => {
    renderer.update(managerElement(navigation));
    await flush();
  });

  expect(textInside(renderer)).toContain('Serverprüfung erforderlich');
  expect(
    renderer.root.findAllByProps({
      testID: 'invite-manager-item-inv_revoked_authority',
    }),
  ).toHaveLength(0);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('reuses one revoke key across a lost response and in-progress conflict, then clears it after success', async () => {
  const active = invitation('inv_retry_revoke', 'active', 4);
  const revokeRequests: Array<{
    headers: { 'idempotency-key': string };
  }> = [];
  let revokeAttempt = 0;
  mockRequestAsUser.mockImplementation(
    async (_subject: unknown, operation: string, request: never) => {
      if (operation === 'eventMembershipsList') {
        return {
          data: {
            items: [membership(mockAccountId, 'owner')],
            pageInfo: { hasMore: false, nextCursor: null },
          },
        };
      }
      if (operation === 'eventInvitationsList') {
        return {
          data: {
            items: [active],
            pageInfo: { hasMore: false, nextCursor: null },
          },
        };
      }
      if (operation === 'eventInvitationsRevoke') {
        revokeRequests.push(request);
        revokeAttempt += 1;
        if (revokeAttempt === 1) throw new Error('response lost');
        if (revokeAttempt === 2) {
          throw gatewayError(
            'eventInvitationsRevoke',
            409,
            'IDEMPOTENCY_IN_PROGRESS',
            true,
          );
        }
        return {
          data: {
            invitation: {
              ...active,
              normalizedEmailHint: null,
              status: 'revoked',
              version: 5,
            },
          },
        };
      }
      throw new Error(`Unexpected operation ${operation}`);
    },
  );
  const renderer = await renderManager();

  await confirmRevoke(renderer, active.id);
  expect(textInside(renderer)).toContain('Es wurde nichts bestätigt');
  await confirmRevoke(renderer, active.id);
  expect(textInside(renderer)).toContain('Widerruf wird noch verarbeitet');
  await confirmRevoke(renderer, active.id);

  expect(revokeRequests.slice(0, 3).map(request => request.headers)).toEqual([
    { 'idempotency-key': '11111111-1111-4111-8111-111111111111' },
    { 'idempotency-key': '11111111-1111-4111-8111-111111111111' },
    { 'idempotency-key': '11111111-1111-4111-8111-111111111111' },
  ]);

  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ testID: 'invite-manager-refresh' })
      .props.onPress();
    await flush();
  });
  await confirmRevoke(renderer, active.id);
  expect(revokeRequests[3]?.headers).toEqual({
    'idempotency-key': '22222222-2222-4222-8222-222222222222',
  });
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('clears a terminal revoke conflict and requires a refreshed server state', async () => {
  const active = invitation('inv_conflict_revoke', 'active', 7);
  const revokeRequests: Array<{
    headers: { 'idempotency-key': string };
  }> = [];
  let revokeAttempt = 0;
  mockRequestAsUser.mockImplementation(
    async (_subject: unknown, operation: string, request: never) => {
      if (operation === 'eventMembershipsList') {
        return {
          data: {
            items: [membership(mockAccountId, 'owner')],
            pageInfo: { hasMore: false, nextCursor: null },
          },
        };
      }
      if (operation === 'eventInvitationsList') {
        return {
          data: {
            items: [active],
            pageInfo: { hasMore: false, nextCursor: null },
          },
        };
      }
      if (operation === 'eventInvitationsRevoke') {
        revokeRequests.push(request);
        revokeAttempt += 1;
        if (revokeAttempt === 1) {
          throw gatewayError(
            'eventInvitationsRevoke',
            409,
            'VERSION_CONFLICT',
            false,
          );
        }
        return {
          data: {
            invitation: {
              ...active,
              normalizedEmailHint: null,
              status: 'revoked',
              version: 8,
            },
          },
        };
      }
      throw new Error(`Unexpected operation ${operation}`);
    },
  );
  const renderer = await renderManager();

  await confirmRevoke(renderer, active.id);
  expect(textInside(renderer)).toContain('Lade die Liste neu');
  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ testID: 'invite-manager-refresh' })
      .props.onPress();
    await flush();
  });
  await confirmRevoke(renderer, active.id);

  expect(revokeRequests.map(request => request.headers)).toEqual([
    { 'idempotency-key': '11111111-1111-4111-8111-111111111111' },
    { 'idempotency-key': '22222222-2222-4222-8222-222222222222' },
  ]);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('hides organizer delegation from organizers and validates it defensively', async () => {
  mockRequestAsUser.mockResolvedValue({
    data: {
      items: [membership(mockAccountId, 'organizer')],
      pageInfo: { hasMore: false, nextCursor: null },
    },
  });
  const renderer = await renderEditor();

  expect(
    renderer.root.findAllByProps({
      testID: 'invite-editor-role-organizer',
    }),
  ).toHaveLength(0);
  expect(
    renderer.root.findByProps({
      testID: 'invite-editor-role-participant',
    }).props.accessibilityState,
  ).toMatchObject({ checked: true, disabled: false });
  expect(
    renderer.root.findByProps({
      accessibilityLabel: 'Rolle',
      accessibilityRole: 'radiogroup',
    }).props.accessibilityHint,
  ).toContain('aktuelle Auswahl angesagt');
  expect(
    renderer.root.findByProps({
      testID: 'invite-editor-role-participant',
    }).props,
  ).toMatchObject({
    accessibilityLabel: 'Teilnehmen, ausgewählt',
    accessibilityRole: 'radio',
    accessibilityState: { checked: true, disabled: false },
  });
  expect(
    renderer.root.findByProps({
      testID: 'invite-editor-role-viewer',
    }).props,
  ).toMatchObject({
    accessibilityHint:
      'Kann Eventinhalte nur ansehen. Doppeltippen zum Auswählen.',
    accessibilityLabel: 'Nur ansehen, nicht ausgewählt',
    accessibilityRole: 'radio',
    accessibilityState: { checked: false, disabled: false },
  });
  expect(
    validateInviteForm(
      {
        email: '',
        expiresAt: '2030-07-25T18:00:00.000Z',
        maxUses: '1',
        role: 'organizer',
        timeZone: 'Europe/Zurich',
      },
      'organizer',
    ).errors.role,
  ).toContain('Nur Eigentümer:innen');
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('keeps an exact ISO instant through a DST overlap and rejects malformed native results', () => {
  const overlap = {
    expiresAt: '2030-10-27T01:30:00.000Z',
    timeZone: 'Europe/Zurich',
  };
  expect(
    validNativeInviteExpirySelection(
      overlap,
      Date.parse('2030-10-01T00:00:00.000Z'),
    ),
  ).toEqual(overlap);
  expect(
    validNativeInviteExpirySelection(
      { ...overlap, expiresAt: '2030-10-27T01:30:00Z' },
      Date.parse('2030-10-01T00:00:00.000Z'),
    ),
  ).toBeNull();
  expect(
    validNativeInviteExpirySelection(
      { ...overlap, timeZone: 'Not/A_Real_Zone' },
      Date.parse('2030-10-01T00:00:00.000Z'),
    ),
  ).toBeNull();
});

test('uses the native expiry picker, persists its timezone and leaves cancel unchanged', async () => {
  mockRequestAsUser.mockResolvedValue({
    data: {
      items: [membership(mockAccountId, 'owner')],
      pageInfo: { hasMore: false, nextCursor: null },
    },
  });
  const selection = {
    expiresAt: '2030-10-27T01:30:00.000Z',
    timeZone: 'Europe/Zurich',
  };
  mockPickExpiry.mockResolvedValueOnce(selection).mockResolvedValueOnce(null);
  const renderer = await renderEditor();

  const expiry = () =>
    renderer.root.findByProps({ testID: 'invite-editor-expires-at' });
  expect(expiry().props).toMatchObject({
    accessibilityLabel: 'Gültig bis',
    accessibilityRole: 'button',
    accessibilityState: { disabled: false },
  });
  expect(expiry().props.accessibilityHint).toContain('systemeigene Auswahl');
  await ReactTestRenderer.act(async () => {
    await expiry().props.onPress();
    await new Promise(resolve => setTimeout(resolve, 0));
    await flush();
  });

  const [initialExpiresAt, minimumExpiresAt] =
    mockPickExpiry.mock.calls[0] ?? [];
  expect(new Date(initialExpiresAt).toISOString()).toBe(initialExpiresAt);
  expect(new Date(minimumExpiresAt).toISOString()).toBe(minimumExpiresAt);
  expect(
    JSON.parse(mockLocalStore.putDraft.mock.calls.at(-1)?.[0].contentJson),
  ).toEqual({
    email: '',
    expiresAt: selection.expiresAt,
    maxUses: '1',
    role: 'participant',
    schemaVersion: 2,
    timeZone: selection.timeZone,
  });
  expect(expiry().props.accessibilityValue.text).toContain('Europe/Zurich');

  const writesBeforeCancel = mockLocalStore.putDraft.mock.calls.length;
  await ReactTestRenderer.act(async () => {
    await expiry().props.onPress();
    await new Promise(resolve => setTimeout(resolve, 0));
    await flush();
  });
  expect(mockLocalStore.putDraft).toHaveBeenCalledTimes(writesBeforeCancel);
  expect(expiry().props.accessibilityValue.text).toContain('Europe/Zurich');
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('keeps the newly intended role selected and exposes deterministic native focus', async () => {
  mockRequestAsUser.mockResolvedValue({
    data: {
      items: [membership(mockAccountId, 'owner')],
      pageInfo: { hasMore: false, nextCursor: null },
    },
  });
  const focus = jest.spyOn(AccessibilityInfo, 'setAccessibilityFocus');
  const renderer = await renderEditor();

  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ testID: 'invite-editor-role-viewer' })
      .props.onPress();
    await flush();
  });

  expect(
    renderer.root.findByProps({ testID: 'invite-editor-role-viewer' }).props
      .accessibilityState,
  ).toMatchObject({ checked: true, disabled: false });
  setInviteAccessibilityFocus(51);
  expect(focus).toHaveBeenLastCalledWith(51);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('preserves an organizer role from an owner draft after an organizer signs in', async () => {
  mockLocalStore.listDrafts.mockResolvedValue([
    {
      accountUserId: mockAccountId,
      contentJson: JSON.stringify({
        email: '',
        expiresAt: '2030-07-25T18:00:00.000Z',
        maxUses: '1',
        role: 'organizer',
        schemaVersion: 2,
        timeZone: 'Europe/Zurich',
      }),
      createdAt: '2026-07-18T09:00:00.000Z',
      entityType: 'invite-editor',
      eventId: null,
      id: `invite-editor:${rootEventId}`,
      rootEventId,
      updatedAt: '2026-07-18T09:00:00.000Z',
    },
  ]);
  mockRequestAsUser.mockResolvedValue({
    data: {
      items: [membership(mockAccountId, 'organizer')],
      pageInfo: { hasMore: false, nextCursor: null },
    },
  });
  const renderer = await renderEditor();

  expect(
    renderer.root.findByProps({
      testID: 'invite-editor-role-organizer',
    }).props.accessibilityState,
  ).toMatchObject({ checked: true, disabled: false });
  expect(textInside(renderer)).toContain('Nur Eigentümer:innen');
  expect(
    renderer.root.findByProps({ testID: 'invite-editor-create' }).props
      .disabled,
  ).toBe(true);
  expect(mockLocalStore.putDraft).not.toHaveBeenCalled();

  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ testID: 'invite-editor-role-participant' })
      .props.onPress();
    await flush();
  });
  expect(
    renderer.root.findByProps({
      testID: 'invite-editor-role-participant',
    }).props.accessibilityState,
  ).toMatchObject({ checked: true, disabled: false });
  expect(textInside(renderer)).not.toContain('Nur Eigentümer:innen');
  expect(
    renderer.root.findByProps({ testID: 'invite-editor-create' }).props
      .disabled,
  ).toBe(false);
  expect(
    JSON.parse(mockLocalStore.putDraft.mock.calls.at(-1)?.[0].contentJson).role,
  ).toBe('participant');
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('requires an explicit role choice when owner authority is downgraded during create', async () => {
  let membershipAttempt = 0;
  mockRequestAsUser.mockImplementation(
    async (_subject: unknown, operation: string) => {
      if (operation === 'eventMembershipsList') {
        membershipAttempt += 1;
        return {
          data: {
            items: [
              membership(
                mockAccountId,
                membershipAttempt === 1 ? 'owner' : 'organizer',
              ),
            ],
            pageInfo: { hasMore: false, nextCursor: null },
          },
        };
      }
      throw new Error(`Unexpected operation ${operation}`);
    },
  );
  const renderer = await renderEditor();

  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ testID: 'invite-editor-role-organizer' })
      .props.onPress();
    await flush();
  });
  expect(
    renderer.root.findByProps({ testID: 'invite-editor-create' }).props
      .disabled,
  ).toBe(false);
  const draftWritesBeforeDowngrade = mockLocalStore.putDraft.mock.calls.length;

  await pressCreate(renderer);

  expect(
    renderer.root.findByProps({
      testID: 'invite-editor-role-organizer',
    }).props.accessibilityState,
  ).toMatchObject({ checked: true, disabled: false });
  expect(textInside(renderer)).toContain('Nur Eigentümer:innen');
  expect(textInside(renderer)).toContain(
    'Deine aktuelle Serverrolle wurde übernommen.',
  );
  expect(
    renderer.root.findByProps({ testID: 'invite-editor-create' }).props
      .disabled,
  ).toBe(true);
  expect(
    mockRequestAsUser.mock.calls.some(
      ([, operation]) => operation === 'eventInvitationsCreate',
    ),
  ).toBe(false);
  expect(mockLocalStore.putDraft).toHaveBeenCalledTimes(
    draftWritesBeforeDowngrade,
  );
  expect(
    JSON.parse(mockLocalStore.putDraft.mock.calls.at(-1)?.[0].contentJson).role,
  ).toBe('organizer');

  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ testID: 'invite-editor-role-participant' })
      .props.onPress();
    await flush();
  });
  expect(textInside(renderer)).not.toContain('Nur Eigentümer:innen');
  expect(
    renderer.root.findByProps({ testID: 'invite-editor-create' }).props
      .disabled,
  ).toBe(false);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('restores and deliberately clears only allow-listed invite draft fields', async () => {
  mockLocalStore.listDrafts.mockResolvedValue([
    {
      accountUserId: mockAccountId,
      contentJson: JSON.stringify({
        email: 'saved@example.com',
        expiresAt: '2030-07-25T18:00:00.000Z',
        maxUses: '8',
        role: 'viewer',
        schemaVersion: 2,
        timeZone: 'Europe/Zurich',
      }),
      createdAt: '2026-07-18T09:00:00.000Z',
      entityType: 'invite-editor',
      eventId: null,
      id: `invite-editor:${rootEventId}`,
      rootEventId,
      updatedAt: '2026-07-18T09:00:00.000Z',
    },
  ]);
  mockRequestAsUser.mockResolvedValue({
    data: {
      items: [membership(mockAccountId, 'owner')],
      pageInfo: { hasMore: false, nextCursor: null },
    },
  });
  const renderer = await renderEditor();

  expect(textInside(renderer)).toContain('Entwurf wiederaufgenommen');
  expect(
    renderer.root.findByProps({ testID: 'invite-editor-email' }).props.value,
  ).toBe('saved@example.com');
  expect(
    renderer.root.findByProps({ testID: 'invite-editor-max-uses' }).props.value,
  ).toBe('8');

  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ testID: 'invite-editor-email' })
      .props.onChangeText('changed@example.com');
    await flush();
  });
  const savedChange = mockLocalStore.putDraft.mock.calls.at(-1)?.[0];
  expect(savedChange).toMatchObject({
    accountUserId: mockAccountId,
    entityType: 'invite-editor',
    eventId: null,
    id: `invite-editor:${rootEventId}`,
    rootEventId,
  });
  expect(JSON.parse(savedChange.contentJson)).toEqual({
    email: 'changed@example.com',
    expiresAt: '2030-07-25T18:00:00.000Z',
    maxUses: '8',
    role: 'viewer',
    schemaVersion: 2,
    timeZone: 'Europe/Zurich',
  });
  expect(savedChange.contentJson).not.toMatch(
    /token|idempotency|invitationId/i,
  );

  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ testID: 'invite-editor-clear-draft' })
      .props.onPress();
    await flush();
  });
  expect(textInside(renderer)).toContain('Gespeicherter Entwurf geleert');
  expect(
    JSON.parse(mockLocalStore.putDraft.mock.calls.at(-1)?.[0].contentJson),
  ).toMatchObject({
    email: '',
    maxUses: '1',
    role: 'participant',
    schemaVersion: 2,
  });
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('blocks back and route removal while create is pending, then releases after the token arrives', async () => {
  let resolveCreate!: (value: unknown) => void;
  const delayedCreate = new Promise(resolve => {
    resolveCreate = resolve;
  });
  mockRequestAsUser.mockImplementation(
    async (
      _subject: unknown,
      operation: string,
      request: { body: { id: string } },
    ) => {
      if (operation === 'eventMembershipsList') {
        return {
          data: {
            items: [membership(mockAccountId, 'owner')],
            pageInfo: { hasMore: false, nextCursor: null },
          },
        };
      }
      if (operation === 'eventInvitationsCreate') return delayedCreate;
      throw new Error(
        `Unexpected operation ${operation} for ${request.body.id}`,
      );
    },
  );
  const navigation = {
    canGoBack: jest.fn(() => true),
    goBack: jest.fn(),
    navigate: jest.fn(),
  };
  const renderer = await renderEditor(navigation);

  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ testID: 'invite-editor-create' })
      .props.onPress();
    await flush();
  });

  expect(mockUsePreventRemove).toHaveBeenLastCalledWith(
    true,
    expect.any(Function),
  );
  expect(
    renderer.root.findByProps({ testID: 'invite-editor-back' }).props.disabled,
  ).toBe(true);
  await ReactTestRenderer.act(() =>
    renderer.root.findByProps({ testID: 'invite-editor-back' }).props.onPress(),
  );
  expect(navigation.goBack).not.toHaveBeenCalled();
  expect(navigation.navigate).not.toHaveBeenCalled();

  await ReactTestRenderer.act(async () => {
    resolveCreate({
      data: {
        invitation: {
          ...invitation(
            'inv_22222222-2222-4222-8222-222222222222',
            'active',
            1,
          ),
          normalizedEmailHint: null,
        },
        token: 'safeInviteToken1234567890',
      },
    });
    await flush();
  });

  expect(mockUsePreventRemove).toHaveBeenLastCalledWith(
    false,
    expect.any(Function),
  );
  await ReactTestRenderer.act(() =>
    renderer.root.findByProps({ testID: 'invite-editor-done' }).props.onPress(),
  );
  expect(navigation.goBack).toHaveBeenCalledTimes(1);
  expect(navigation.navigate).not.toHaveBeenCalled();
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('reuses one id and idempotency key after an uncertain create response, then shares only from live state', async () => {
  const createRequests: unknown[] = [];
  let createAttempt = 0;
  mockRequestAsUser.mockImplementation(
    async (_subject: unknown, operation: string, request: unknown) => {
      if (operation === 'eventMembershipsList') {
        return {
          data: {
            items: [membership(mockAccountId, 'owner')],
            pageInfo: { hasMore: false, nextCursor: null },
          },
        };
      }
      if (operation === 'eventInvitationsCreate') {
        createRequests.push(request);
        createAttempt += 1;
        if (createAttempt === 1) throw new Error('response lost');
        return {
          data: {
            invitation: {
              ...invitation(
                'inv_22222222-2222-4222-8222-222222222222',
                'active',
                1,
              ),
              normalizedEmailHint: 'person@example.com',
            },
            token: 'safeInviteToken1234567890',
          },
        };
      }
      throw new Error(`Unexpected operation ${operation}`);
    },
  );
  jest
    .spyOn(Share, 'share')
    .mockResolvedValueOnce({ action: Share.dismissedAction })
    .mockResolvedValueOnce({ action: Share.sharedAction });
  const navigation = {
    canGoBack: jest.fn(() => true),
    goBack: jest.fn(),
    navigate: jest.fn(),
  };
  const renderer = await renderEditor(navigation);

  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'invite-editor-email' })
      .props.onChangeText(' Person@Example.COM '),
  );
  const createButton = () =>
    renderer.root.findByProps({ testID: 'invite-editor-create' });
  await ReactTestRenderer.act(async () => {
    createButton().props.onPress();
    await flush();
  });
  expect(textInside(renderer)).toContain('Deine Eingaben bleiben erhalten.');
  await ReactTestRenderer.act(async () => {
    createButton().props.onPress();
    await flush();
  });

  expect(createRequests).toHaveLength(2);
  expect(createRequests[0]).toEqual(createRequests[1]);
  expect(createRequests[0]).toMatchObject({
    body: {
      id: 'inv_22222222-2222-4222-8222-222222222222',
      maxUses: 1,
      normalizedEmailHint: 'person@example.com',
      role: 'participant',
    },
    headers: {
      'idempotency-key': '11111111-1111-4111-8111-111111111111',
    },
    path: { rootEventId },
  });
  expect(mockSecureUuidV4).toHaveBeenCalledTimes(2);
  expect(navigation.navigate).not.toHaveBeenCalled();

  const shareButton = () =>
    renderer.root.findByProps({ testID: 'invite-editor-share' });
  await ReactTestRenderer.act(async () => {
    shareButton().props.onPress();
    await flush();
  });
  expect(textInside(renderer)).toContain('Noch nicht geteilt');
  await ReactTestRenderer.act(async () => {
    shareButton().props.onPress();
    await flush();
  });
  expect(Share.share).toHaveBeenCalledTimes(2);
  expect(Share.share).toHaveBeenNthCalledWith(1, {
    message:
      'Komm zu unserer Crew:\nhttps://crew-haus.com/join/safeInviteToken1234567890',
    title: 'Crew Einladung',
  });
  expect(Share.share).toHaveBeenNthCalledWith(
    2,
    jest.mocked(Share.share).mock.calls[0]?.[0],
  );

  await ReactTestRenderer.act(() =>
    renderer.root.findByProps({ testID: 'invite-editor-done' }).props.onPress(),
  );
  expect(navigation.goBack).toHaveBeenCalledTimes(1);
  expect(navigation.navigate).not.toHaveBeenCalled();
  await flush();
  expect(
    mockLocalStore.putDraft.mock.calls.every(([draft]) => {
      const content = String(draft.contentJson);
      return (
        !content.includes('safeInviteToken1234567890') &&
        !/idempotency|invitationId/.test(content)
      );
    }),
  ).toBe(true);
  expect(
    JSON.parse(mockLocalStore.putDraft.mock.calls.at(-1)?.[0].contentJson),
  ).toMatchObject({
    email: '',
    maxUses: '1',
    role: 'participant',
    schemaVersion: 2,
  });
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('keeps the once-only token shareable across connectivity and client changes', async () => {
  mockRequestAsUser.mockImplementation(
    async (
      _subject: unknown,
      operation: string,
      request: { body: { id: string } },
    ) => {
      if (operation === 'eventMembershipsList') {
        return {
          data: {
            items: [membership(mockAccountId, 'owner')],
            pageInfo: { hasMore: false, nextCursor: null },
          },
        };
      }
      if (operation === 'eventInvitationsCreate') {
        return {
          data: {
            invitation: {
              ...invitation(request.body.id, 'active', 1),
              normalizedEmailHint: null,
            },
            token: 'connectivitySafeToken1234567890',
          },
        };
      }
      throw new Error(`Unexpected operation ${operation}`);
    },
  );
  jest
    .mocked(Share.share)
    .mockResolvedValueOnce({ action: Share.dismissedAction })
    .mockResolvedValueOnce({ action: Share.sharedAction });
  const navigation = {
    canGoBack: jest.fn(() => true),
    goBack: jest.fn(),
    navigate: jest.fn(),
  };
  const renderer = await renderEditor(navigation);
  await pressCreate(renderer);

  mockOnline = false;
  mockGatewayClientValue = null;
  await ReactTestRenderer.act(async () => {
    renderer.update(editorElement(navigation));
    await flush();
  });
  expect(
    renderer.root.findByProps({ testID: 'invite-editor-share' }),
  ).toBeTruthy();

  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ testID: 'invite-editor-share' })
      .props.onPress();
    await flush();
  });
  expect(textInside(renderer)).toContain('Noch nicht geteilt');
  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ testID: 'invite-editor-share' })
      .props.onPress();
    await flush();
  });
  expect(Share.share).toHaveBeenCalledTimes(2);
  expect(Share.share).toHaveBeenLastCalledWith({
    message:
      'Komm zu unserer Crew:\nhttps://crew-haus.com/join/connectivitySafeToken1234567890',
    title: 'Crew Einladung',
  });
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('keeps the same create attempt for a retryable idempotency-in-progress response', async () => {
  const createRequests: Array<{
    body: { id: string };
    headers: { 'idempotency-key': string };
  }> = [];
  let createAttempt = 0;
  mockRequestAsUser.mockImplementation(
    async (
      _subject: unknown,
      operation: string,
      request: {
        body: { id: string };
        headers: { 'idempotency-key': string };
      },
    ) => {
      if (operation === 'eventMembershipsList') {
        return {
          data: {
            items: [membership(mockAccountId, 'owner')],
            pageInfo: { hasMore: false, nextCursor: null },
          },
        };
      }
      if (operation === 'eventInvitationsCreate') {
        createRequests.push(request);
        createAttempt += 1;
        if (createAttempt === 1) {
          throw gatewayError(
            'eventInvitationsCreate',
            409,
            'IDEMPOTENCY_IN_PROGRESS',
            true,
          );
        }
        return {
          data: {
            invitation: {
              ...invitation(request.body.id, 'active', 1),
              normalizedEmailHint: null,
            },
            token: 'safeInviteToken1234567890',
          },
        };
      }
      throw new Error(`Unexpected operation ${operation}`);
    },
  );
  const renderer = await renderEditor();

  await pressCreate(renderer);
  expect(textInside(renderer)).toContain('noch verarbeitet');
  await pressCreate(renderer);

  expect(createRequests).toHaveLength(2);
  expect(createRequests[1]).toEqual(createRequests[0]);
  expect(mockSecureUuidV4).toHaveBeenCalledTimes(2);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test.each([
  'ID_COLLISION',
  'IDEMPOTENCY_KEY_REUSED',
  'VERSION_CONFLICT',
] as const)('starts a new create attempt after terminal %s', async code => {
  const createRequests: Array<{
    body: { id: string };
    headers: { 'idempotency-key': string };
  }> = [];
  let createAttempt = 0;
  mockRequestAsUser.mockImplementation(
    async (
      _subject: unknown,
      operation: string,
      request: {
        body: { id: string };
        headers: { 'idempotency-key': string };
      },
    ) => {
      if (operation === 'eventMembershipsList') {
        return {
          data: {
            items: [membership(mockAccountId, 'owner')],
            pageInfo: { hasMore: false, nextCursor: null },
          },
        };
      }
      if (operation === 'eventInvitationsCreate') {
        createRequests.push(request);
        createAttempt += 1;
        if (createAttempt === 1) {
          throw gatewayError('eventInvitationsCreate', 409, code, false);
        }
        return {
          data: {
            invitation: {
              ...invitation(request.body.id, 'active', 1),
              normalizedEmailHint: null,
            },
            token: 'safeInviteToken1234567890',
          },
        };
      }
      throw new Error(`Unexpected operation ${operation}`);
    },
  );
  const renderer = await renderEditor();

  await pressCreate(renderer);
  expect(textInside(renderer)).toContain(
    'Beim nächsten Erstellen beginnt Crew sicher neu.',
  );
  await pressCreate(renderer);

  expect(createRequests).toHaveLength(2);
  expect(createRequests[1]?.headers).not.toEqual(createRequests[0]?.headers);
  expect(createRequests[1]?.body.id).not.toBe(createRequests[0]?.body.id);
  expect(mockSecureUuidV4).toHaveBeenCalledTimes(4);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('shows token-free synced summaries to a locally confirmed manager after an offline restart', async () => {
  mockOnline = false;
  mockGatewayClientValue = null;
  mockLocalStore.listMemberships.mockResolvedValue([
    {
      accountUserId: mockAccountId,
      createdAt: '2026-07-18T09:00:00.000Z',
      memberUserId: mockAccountId,
      role: 'owner',
      rootEventId,
      status: 'active',
      updatedAt: '2026-07-18T09:00:00.000Z',
      version: 1,
    },
  ]);
  mockLocalStore.listInvitations.mockResolvedValue([
    {
      ...invitation('inv_offline_safe', 'active', 2),
      accountUserId: mockAccountId,
    },
  ]);
  const renderer = await renderManager();

  expect(textInside(renderer)).toContain('Offline · sicher gespeichert');
  expect(textInside(renderer)).toContain('Aktiv');
  expect(textInside(renderer)).toContain('1 Mitglied');
  expect(
    renderer.root.findByProps({
      testID: 'invite-manager-item-inv_offline_safe',
    }),
  ).toBeTruthy();
  expect(mockLocalStore.listMemberships).toHaveBeenCalledWith(
    mockAccountId,
    rootEventId,
  );
  expect(mockLocalStore.listInvitations).toHaveBeenCalledWith(
    mockAccountId,
    rootEventId,
  );
  expect(mockRequestAsUser).not.toHaveBeenCalled();
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('renders an invalid cached expiry neutrally without crashing', async () => {
  mockOnline = false;
  mockGatewayClientValue = null;
  mockLocalStore.listMemberships.mockResolvedValue([cachedMembership('owner')]);
  mockLocalStore.listInvitations.mockResolvedValue([
    {
      ...invitation('inv_invalid_expiry', 'active', 2),
      accountUserId: mockAccountId,
      expiresAt: 'not-a-date',
    },
  ]);
  const renderer = await renderManager();

  expect(textInside(renderer)).toContain('Ablauf unklar');
  expect(textInside(renderer)).toContain('Datum nicht verfügbar');
  expect(
    renderer.root.findAllByProps({
      testID: 'invite-manager-revoke-inv_invalid_expiry',
    }),
  ).toHaveLength(0);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('keeps a cached editor form disabled after transient authority failure and explicitly retries', async () => {
  mockLocalStore.listMemberships.mockResolvedValue([cachedMembership('owner')]);
  mockLocalStore.listDrafts.mockResolvedValue([
    {
      accountUserId: mockAccountId,
      contentJson: JSON.stringify({
        email: 'retry@example.com',
        expiresAt: '2030-07-25T18:00:00.000Z',
        maxUses: '3',
        role: 'viewer',
        schemaVersion: 2,
        timeZone: 'Europe/Zurich',
      }),
      createdAt: '2026-07-18T09:00:00.000Z',
      entityType: 'invite-editor',
      eventId: null,
      id: `invite-editor:${rootEventId}`,
      rootEventId,
      updatedAt: '2026-07-18T09:00:00.000Z',
    },
  ]);
  let authorityAttempt = 0;
  mockRequestAsUser.mockImplementation(async () => {
    authorityAttempt += 1;
    if (authorityAttempt === 1) throw new Error('authority unavailable');
    return {
      data: {
        items: [membership(mockAccountId, 'owner')],
        pageInfo: { hasMore: false, nextCursor: null },
      },
    };
  });
  const renderer = await renderEditor();

  expect(textInside(renderer)).toContain(
    'Serverprüfung erforderlich · Entwurf lokal',
  );
  expect(
    renderer.root.findByProps({ testID: 'invite-editor-email' }).props.value,
  ).toBe('retry@example.com');
  expect(
    renderer.root.findByProps({ testID: 'invite-editor-create' }).props
      .disabled,
  ).toBe(true);
  expect(
    renderer.root.findByProps({
      testID: 'invite-editor-retry-authority',
    }).props.label,
  ).toBe('Server erneut prüfen');

  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ testID: 'invite-editor-retry-authority' })
      .props.onPress();
    await flush();
  });
  expect(
    renderer.root.findByProps({ testID: 'invite-editor-create' }).props
      .disabled,
  ).toBe(false);
  expect(
    renderer.root.findAllByProps({
      testID: 'invite-editor-retry-authority',
    }),
  ).toHaveLength(0);
  expect(
    renderer.root.findByProps({ testID: 'invite-editor-email' }).props.value,
  ).toBe('retry@example.com');
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('waits for a pending draft write before authority retry reloads SQLite', async () => {
  mockLocalStore.listMemberships.mockResolvedValue([cachedMembership('owner')]);
  let storedDraft = {
    accountUserId: mockAccountId,
    contentJson: JSON.stringify({
      email: 'old@example.com',
      expiresAt: '2030-07-25T18:00:00.000Z',
      maxUses: '3',
      role: 'viewer',
      schemaVersion: 2,
      timeZone: 'Europe/Zurich',
    }),
    createdAt: '2026-07-18T09:00:00.000Z',
    entityType: 'invite-editor',
    eventId: null,
    id: `invite-editor:${rootEventId}`,
    rootEventId,
    updatedAt: '2026-07-18T09:00:00.000Z',
  };
  let completeWrite!: () => void;
  mockLocalStore.listDrafts.mockImplementation(async () => [storedDraft]);
  mockLocalStore.putDraft.mockImplementation(
    (draft: typeof storedDraft) =>
      new Promise<void>(resolve => {
        completeWrite = () => {
          storedDraft = draft;
          resolve();
        };
      }),
  );
  let authorityAttempt = 0;
  mockRequestAsUser.mockImplementation(async () => {
    authorityAttempt += 1;
    if (authorityAttempt === 1) throw new Error('authority unavailable');
    return {
      data: {
        items: [membership(mockAccountId, 'owner')],
        pageInfo: { hasMore: false, nextCursor: null },
      },
    };
  });
  const renderer = await renderEditor();

  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ testID: 'invite-editor-email' })
      .props.onChangeText('new@example.com');
    await flush();
  });
  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ testID: 'invite-editor-retry-authority' })
      .props.onPress();
    await flush();
  });
  expect(
    renderer.root.findByProps({ testID: 'invite-editor-email' }).props.value,
  ).toBe('new@example.com');
  expect(mockLocalStore.listDrafts).toHaveBeenCalledTimes(1);

  await ReactTestRenderer.act(async () => {
    completeWrite();
    await flush();
  });
  expect(
    renderer.root.findByProps({ testID: 'invite-editor-email' }).props.value,
  ).toBe('new@example.com');
  expect(mockLocalStore.listDrafts).toHaveBeenCalledTimes(2);
  expect(
    renderer.root.findByProps({ testID: 'invite-editor-create' }).props
      .disabled,
  ).toBe(false);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('offers an authority retry even without a local manager role', async () => {
  let authorityAttempt = 0;
  mockRequestAsUser.mockImplementation(async () => {
    authorityAttempt += 1;
    if (authorityAttempt === 1) throw new Error('authority unavailable');
    return {
      data: {
        items: [membership(mockAccountId, 'owner')],
        pageInfo: { hasMore: false, nextCursor: null },
      },
    };
  });
  const renderer = await renderEditor();

  expect(textInside(renderer)).toContain('Serverprüfung erforderlich');
  expect(
    renderer.root.findByProps({
      testID: 'invite-editor-retry-authority',
    }).props,
  ).toMatchObject({ disabled: false, label: 'Server erneut prüfen' });

  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ testID: 'invite-editor-retry-authority' })
      .props.onPress();
    await flush();
  });
  expect(
    renderer.root.findByProps({ testID: 'invite-editor-create' }).props
      .disabled,
  ).toBe(false);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('never starts role or mutation requests while the editor opens offline', async () => {
  mockOnline = false;
  const renderer = await renderEditor();

  expect(textInside(renderer)).toContain(
    'Neue Zugriffslinks werden nie offline',
  );
  expect(mockRequestAsUser).not.toHaveBeenCalled();
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('restores an offline editor draft for a locally confirmed manager without enabling create', async () => {
  mockOnline = false;
  mockLocalStore.listMemberships.mockResolvedValue([
    {
      accountUserId: mockAccountId,
      createdAt: '2026-07-18T09:00:00.000Z',
      memberUserId: mockAccountId,
      role: 'organizer',
      rootEventId,
      status: 'active',
      updatedAt: '2026-07-18T09:00:00.000Z',
      version: 1,
    },
  ]);
  mockLocalStore.listDrafts.mockResolvedValue([
    {
      accountUserId: mockAccountId,
      contentJson: JSON.stringify({
        email: 'offline@example.com',
        expiresAt: '2030-07-25T18:00:00.000Z',
        maxUses: '4',
        role: 'participant',
        schemaVersion: 2,
        timeZone: 'Europe/Zurich',
      }),
      createdAt: '2026-07-18T09:00:00.000Z',
      entityType: 'invite-editor',
      eventId: null,
      id: `invite-editor:${rootEventId}`,
      rootEventId,
      updatedAt: '2026-07-18T09:00:00.000Z',
    },
  ]);
  const renderer = await renderEditor();

  expect(textInside(renderer)).toContain('Offline · Entwurf lokal gespeichert');
  expect(
    renderer.root.findByProps({ testID: 'invite-editor-email' }).props.value,
  ).toBe('offline@example.com');
  expect(
    renderer.root.findByProps({ testID: 'invite-editor-create' }).props,
  ).toMatchObject({ disabled: true, label: 'Online erstellen' });
  expect(mockRequestAsUser).not.toHaveBeenCalled();
  await ReactTestRenderer.act(() => renderer.unmount());
});

async function confirmRevoke(
  renderer: ReactTestRenderer.ReactTestRenderer,
  invitationId: string,
) {
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: `invite-manager-revoke-${invitationId}` })
      .props.onPress(),
  );
  const actions = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2];
  const confirm = actions?.find(action => action.style === 'destructive');
  if (!confirm?.onPress) throw new Error('Missing revoke confirmation');
  await ReactTestRenderer.act(async () => {
    confirm.onPress?.();
    await flush();
  });
}

async function pressCreate(renderer: ReactTestRenderer.ReactTestRenderer) {
  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ testID: 'invite-editor-create' })
      .props.onPress();
    await flush();
  });
}

async function renderManager() {
  const navigation = {
    addListener: jest.fn(() => jest.fn()),
    canGoBack: jest.fn(() => true),
    goBack: jest.fn(),
    navigate: jest.fn(),
  };
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(managerElement(navigation));
    await flush();
  });
  return renderer;
}

async function renderEditor(
  navigation = {
    canGoBack: jest.fn(() => true),
    goBack: jest.fn(),
    navigate: jest.fn(),
  },
) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(editorElement(navigation));
    await flush();
  });
  return renderer;
}

function managerElement(navigation: unknown) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <InviteManagerScreen
        navigation={navigation as never}
        route={
          {
            name: 'Invites',
            params: { rootEventId },
          } as never
        }
      />
    </SafeAreaProvider>
  );
}

function editorElement(navigation: unknown) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <InviteEditorScreen
        navigation={navigation as never}
        route={
          {
            name: 'InviteEditor',
            params: { rootEventId },
          } as never
        }
      />
    </SafeAreaProvider>
  );
}

function membership(
  userId: string,
  role: 'organizer' | 'owner' | 'participant' | 'viewer',
) {
  return {
    createdAt: '2026-07-18T09:00:00.000Z',
    role,
    rootEventId,
    status: 'active',
    updatedAt: '2026-07-18T09:00:00.000Z',
    userId,
    version: 1,
  };
}

function cachedMembership(role: 'organizer' | 'owner') {
  return {
    accountUserId: mockAccountId,
    createdAt: '2026-07-18T09:00:00.000Z',
    memberUserId: mockAccountId,
    role,
    rootEventId,
    status: 'active' as const,
    updatedAt: '2026-07-18T09:00:00.000Z',
    version: 1,
  };
}

function setStaleManagerCache() {
  mockLocalStore.listMemberships.mockResolvedValue([cachedMembership('owner')]);
  mockLocalStore.listInvitations.mockResolvedValue([
    {
      ...invitation('inv_stale_private', 'active', 2),
      accountUserId: mockAccountId,
    },
  ]);
}

function invitation(id: string, status: 'active' | 'revoked', version: number) {
  return {
    createdAt: '2026-07-18T09:00:00.000Z',
    emailBound: false,
    expiresAt: '2030-07-25T18:00:00.000Z',
    id,
    maxUses: 4,
    role: 'participant' as const,
    rootEventId,
    status,
    updatedAt: '2026-07-18T09:00:00.000Z',
    useCount: 1,
    version,
  };
}

function gatewayError(
  operationId: OperationId,
  status: number,
  code: GatewayErrorCode,
  retryable: boolean,
) {
  return new GatewayClientError({
    code,
    operationId,
    requestId: 'request-invite-review',
    retryable,
    retryAfterSeconds: null,
    status,
  });
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function textInside(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root
    .findAllByType(Text)
    .flatMap(node => node.props.children)
    .flat(Infinity)
    .filter(value => typeof value === 'string' || typeof value === 'number')
    .join(' ');
}
