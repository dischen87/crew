import { getStateFromPath } from '@react-navigation/native';
import { linking, sanitizeInboundUrl } from '../src/navigation/linking';
import type {
  PendingRouteDraft,
  PendingRouteStore,
} from '../src/storage/pendingRoute';

function memoryStore() {
  const routes: PendingRouteDraft[] = [];
  const store: PendingRouteStore = {
    async put(route) {
      routes.push(route);
      return '00000000-0000-4000-8000-000000000001';
    },
    async peek() {
      return null;
    },
    async current() {
      return null;
    },
    async complete() {},
  };
  return { routes, store };
}

test('moves invite and auth secrets behind an opaque navigation handle', async () => {
  const invite = memoryStore();
  const inviteUrl = await sanitizeInboundUrl(
    'crewnext://join/abcdefghijklmnopqrst',
    invite.store,
  );
  expect(inviteUrl).toBe(
    'crewnext://inbound/invite/00000000-0000-4000-8000-000000000001',
  );
  expect(inviteUrl).not.toContain('abcdefghijklmnopqrst');
  expect(invite.routes).toEqual([
    {
      kind: 'invite',
      token: 'abcdefghijklmnopqrst',
      createdAt: expect.any(Number),
    },
  ]);

  const auth = memoryStore();
  const authUrl = await sanitizeInboundUrl(
    `crewnext://auth/redeem?token=ml_${'a'.repeat(43)}`,
    auth.store,
  );
  expect(authUrl).toContain('/inbound/auth/');
  expect(authUrl).not.toContain(`ml_${'a'.repeat(43)}`);
  expect(auth.routes[0]).toMatchObject({
    kind: 'auth',
    token: `ml_${'a'.repeat(43)}`,
  });

  await expect(
    sanitizeInboundUrl(
      'https://crew-haus.com/events/evt_weekend',
      memoryStore().store,
      false,
    ),
  ).resolves.toBe('https://crew-haus.com/events/evt_weekend');
  expect(linking.prefixes).toContain('https://crew-haus.com');
});

test('accepts canonical HTTPS invite and auth links in Release', async () => {
  const invite = memoryStore();
  await expect(
    sanitizeInboundUrl(
      'https://crew-haus.com/join/abcdefghijklmnopqrst',
      invite.store,
      false,
    ),
  ).resolves.toBe(
    'crewnext://inbound/invite/00000000-0000-4000-8000-000000000001',
  );
  expect(invite.routes).toEqual([
    {
      kind: 'invite',
      token: 'abcdefghijklmnopqrst',
      createdAt: expect.any(Number),
    },
  ]);

  const auth = memoryStore();
  await expect(
    sanitizeInboundUrl(
      `https://crew-haus.com/auth/redeem?token=ml_${'a'.repeat(43)}`,
      auth.store,
      false,
    ),
  ).resolves.toContain('crewnext://inbound/auth/');
  expect(auth.routes[0]).toMatchObject({
    kind: 'auth',
    token: `ml_${'a'.repeat(43)}`,
  });
});

test('sanitizes secrets when custom-scheme URL fields are missing like Hermes', async () => {
  const RealUrl = globalThis.URL;
  globalThis.URL = class HermesLikeUrl extends RealUrl {
    constructor(input: string | URL, base?: string | URL) {
      super(
        typeof input === 'string' && input.startsWith('crewnext:')
          ? 'crewnext:///'
          : input,
        base,
      );
    }
  } as typeof URL;

  try {
    const invite = memoryStore();
    const sanitized = await sanitizeInboundUrl(
      'crewnext://join/abcdefghijklmnopqrst',
      invite.store,
    );
    expect(sanitized).not.toContain('abcdefghijklmnopqrst');
    expect(invite.routes).toHaveLength(1);
  } finally {
    globalThis.URL = RealUrl;
  }
});

test('rejects foreign schemes, oversized values and secret-like query parameters', async () => {
  const { store } = memoryStore();
  for (const value of [
    'https://crew.app/events/evt_a',
    'http://crew-haus.com/events/evt_a',
    'https://crew-haus.com.evil/events/evt_a',
    'https://crew-haus.com:444/events/evt_a',
    'https://crew-haus.com/events/evt_a#secret',
  ]) {
    await expect(sanitizeInboundUrl(value, store)).resolves.toContain(
      'invalid_link',
    );
  }
  await expect(
    sanitizeInboundUrl(`crewnext://events/${'a'.repeat(2_100)}`, store),
  ).resolves.toContain('invalid_link');
  await expect(
    sanitizeInboundUrl('crewnext://events/evt_a?secret=value', store),
  ).resolves.toContain('invalid_link');
  await expect(
    sanitizeInboundUrl('crewnext://join/abcdefghijklmnopqrst/extra', store),
  ).resolves.toContain('invalid_link');
  await expect(
    sanitizeInboundUrl(
      `crewnext://join/abcdefghijklmnopqrst?token=ml_${'a'.repeat(43)}`,
      store,
    ),
  ).resolves.toContain('invalid_link');
  await expect(
    sanitizeInboundUrl(
      `crewnext://auth/redeem/extra?token=ml_${'a'.repeat(43)}`,
      store,
    ),
  ).resolves.toContain('invalid_link');
  await expect(
    sanitizeInboundUrl(
      `crewnext://auth/redeem?token=ml_${'a'.repeat(43)}&token=ml_${'b'.repeat(
        43,
      )}`,
      store,
    ),
  ).resolves.toContain('invalid_link');
  await expect(
    sanitizeInboundUrl('crewnext://user:pass@events/evt_a', store),
  ).resolves.toContain('invalid_link');
  await expect(
    sanitizeInboundUrl('crewnext://events\\evt_a', store),
  ).resolves.toContain('invalid_link');
  await expect(
    sanitizeInboundUrl('crewnext://events/evt_a#token', store),
  ).resolves.toContain('invalid_link');
});

test('rejects secret-bearing custom schemes when the release gate is closed', async () => {
  const invite = memoryStore();
  await expect(
    sanitizeInboundUrl(
      'crewnext://join/abcdefghijklmnopqrst',
      invite.store,
      false,
    ),
  ).resolves.toContain('invalid_link');
  expect(invite.routes).toEqual([]);

  const auth = memoryStore();
  await expect(
    sanitizeInboundUrl(
      `crewnext://auth/redeem?token=ml_${'a'.repeat(43)}`,
      auth.store,
      false,
    ),
  ).resolves.toContain('invalid_link');
  expect(auth.routes).toEqual([]);
});

test('allows only the exact root-scoped native E2E path behind the development gate', async () => {
  const { store } = memoryStore();
  await expect(
    sanitizeInboundUrl('crewnext://e2e/outbox/evt_native-root', store, true),
  ).resolves.toBe('crewnext://e2e/outbox/evt_native-root');
  for (const value of [
    'crewnext://e2e/outbox/invalid',
    'crewnext://e2e/outbox/evt_root/extra',
    'crewnext://e2e/outbox/evt_root/',
    'crewnext://e2e//outbox/evt_root',
    'crewnext://e2e/ignored/../outbox/evt_root',
    'crewnext://E2E/outbox/evt_root',
    'crewnext://e2e./outbox/evt_root',
    'crewnext://e2e../outbox/evt_root',
    'crewnext://e2e%2e/outbox/evt_root',
    'crewnext://E2E%2E/outbox/evt_root',
    'crewnext://e2e%E3%80%82/outbox/evt_root',
    'crewnext://%65%32%65./outbox/evt_root',
    'crewnext://e2e/outbox/%65vt_root',
    'crewnext://e2e/outbox/evt_root%2Fextra',
    'crewnext://e2e/outbox/evt_root?',
    'crewnext://e2e/outbox/evt_root#',
    'crewnext://e2e/outbox/evt_root?mode=write',
    'crewnext://e2e/outbox/evt_root#write',
  ]) {
    await expect(sanitizeInboundUrl(value, store, true)).resolves.toContain(
      'invalid_link',
    );
  }
  await expect(
    sanitizeInboundUrl('crewnext://e2e/outbox/evt_native-root', store, false),
  ).resolves.toContain('invalid_link');
});

test('maps every non-secret inbound family through declarative navigation', () => {
  const config = linking.config!;
  const cases = [
    ['events', 'Events'],
    ['events/evt_root', 'EventInbound'],
    ['events/evt_root/edit-basics/title', 'EventBasicsEdit'],
    ['events/evt_root/review', 'EventPublish'],
    ['events/evt_root/recover/EVENT_TEMPLATE_REQUIRED', 'EventSetupRecovery'],
    ['events/evt_root/items/evt_item', 'ItemInbound'],
    ['events/evt_root/feed/feed_entry', 'FeedInbound'],
    ['feedback/fdb_item', 'FeedbackInbound'],
    ['events/evt_root/feedback', 'CommunityFeedbackList'],
    ['events/evt_root/feedback/fbk_item', 'CommunityFeedbackItem'],
    ['events/evt_root/recap/v2', 'RecapInbound'],
    ['e2e/outbox/evt_root', 'NativeE2EEvidence'],
    ['events/evt_root/team/evt_session', 'TeamSetup'],
    ['events/evt_root/decisions/tdc_dinner', 'Decision'],
    ['inbound/invite/00000000-0000-4000-8000-000000000001', 'InvitePreview'],
    ['inbound/auth/00000000-0000-4000-8000-000000000001', 'EmailIdentity'],
  ] as const;

  for (const [path, expectedRoute] of cases) {
    const state = getStateFromPath(path, config);
    expect(state?.routes.at(-1)?.name).toBe(expectedRoute);
  }
});

test('decodes setup recovery query metadata without filling missing values', () => {
  const config = linking.config!;
  const state = getStateFromPath(
    'events/evt_root/recover/EVENT_CAPABILITY_PLACE_REQUIRED?eventId=evt%5Fround&capabilityType=golf',
    config,
  );
  expect(state?.routes.at(-1)).toMatchObject({
    name: 'EventSetupRecovery',
    params: {
      blocker: 'EVENT_CAPABILITY_PLACE_REQUIRED',
      capabilityType: 'golf',
      eventId: 'evt_round',
      rootEventId: 'evt_root',
    },
  });

  const missing = getStateFromPath(
    'events/evt_root/recover/EVENT_CAPABILITY_REQUIRED',
    config,
  );
  expect(missing?.routes.at(-1)).toMatchObject({
    name: 'EventSetupRecovery',
    params: {
      blocker: 'EVENT_CAPABILITY_REQUIRED',
      rootEventId: 'evt_root',
    },
  });
  expect(missing?.routes.at(-1)?.params).not.toHaveProperty('eventId');
  expect(missing?.routes.at(-1)?.params).not.toHaveProperty('capabilityType');
});
