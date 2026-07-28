#!/usr/bin/env bun

const PUBLIC_URL = 'http://127.0.0.1:3000';
const ROOT_EVENT_ID = 'evt_local_turkey_golf_2026';
const EVENT_ID = 'evt_local_turkey_golf_2026_round_gloria';
const ITEM_ID = 'iti_local_turkey_golf_round_gloria';
const OWNER_EMAIL = 'crew.local@example.test';

try {
  const command = process.argv[2];
  if (command === 'setup') await setup();
  else if (command === 'authenticate') await authenticate();
  else if (command === 'attach' || command === 'detach') {
    await transport(command);
  } else if (command === 'remote-update') await remoteUpdate();
  else if (command === 'remote-delete') await remoteDelete();
  else throw new Error('Unsupported command');
} catch {
  process.stderr.write('Sanitized Plan evidence control command failed.\n');
  process.exitCode = 1;
}

async function setup() {
  const value = await control(
    '/v1/setup',
    { body: JSON.stringify({ scenario: 'golf-tour' }), method: 'POST' },
    201,
  );
  if (value?.rootEventId !== ROOT_EVENT_ID) throw new Error('Fixture mismatch');
  print({ fixture: 'ready', rootEventId: ROOT_EVENT_ID });
}

async function authenticate() {
  let token = await requestMagicLink();
  let deepLink = `crewnext://auth/redeem?token=${encodeURIComponent(token)}`;
  const device = requiredDevice();
  await spawn([
    '/usr/bin/xcrun',
    'simctl',
    'launch',
    device,
    requiredAppId(),
    '-RCT_jsLocation',
    'localhost:8082',
  ]);
  await spawn(['/usr/bin/xcrun', 'simctl', 'openurl', device, deepLink]);
  token = undefined;
  deepLink = undefined;
  print({ opened: true, platform: 'ios', role: 'owner' });
}

async function transport(state) {
  const value = await control(`/v1/transport/${state}`, { method: 'POST' });
  if (value?.transport !== `${state}ed`) {
    throw new Error('Transport mismatch');
  }
  print({ transport: value.transport });
}

async function remoteUpdate() {
  const session = await sessionForOwner();
  const page = await api(
    `/core/v1/event-roots/${ROOT_EVENT_ID}/events/${EVENT_ID}/itinerary?limit=100`,
    {},
    200,
    session.accessToken,
  );
  const item = page?.items?.find(candidate => candidate?.id === ITEM_ID);
  if (!Number.isSafeInteger(item?.version) || item.version < 1) {
    throw new Error('Itinerary version missing');
  }
  const updated = await api(
    `/core/v1/event-roots/${ROOT_EVENT_ID}/itinerary/${ITEM_ID}`,
    {
      body: JSON.stringify({
        baseVersion: item.version,
        changes: { title: 'Serverstand Gloria Golf Club' },
      }),
      headers: {
        'idempotency-key': 'plan.state.conflict.remote-update.v1',
      },
      method: 'PATCH',
    },
    200,
    session.accessToken,
  );
  if (
    updated?.item?.id !== ITEM_ID ||
    updated.item.version !== item.version + 1 ||
    updated.item.title !== 'Serverstand Gloria Golf Club'
  ) {
    throw new Error('Remote update mismatch');
  }
  print({ itemId: ITEM_ID, remoteVersionAdvanced: true });
}

async function remoteDelete() {
  const session = await sessionForOwner();
  const current = await api(
    `/core/v1/event-roots/${ROOT_EVENT_ID}/events/${EVENT_ID}`,
    {},
    200,
    session.accessToken,
  );
  const version = current?.event?.version;
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error('Event version missing');
  }
  const deleted = await api(
    `/core/v1/event-roots/${ROOT_EVENT_ID}/events/${EVENT_ID}?baseVersion=${version}&subtree=true`,
    {
      headers: {
        'idempotency-key': 'plan.state.tombstone.remote-delete.v1',
      },
      method: 'DELETE',
    },
    200,
    session.accessToken,
  );
  if (deleted?.deleted !== true) throw new Error('Remote delete mismatch');
  print({ eventId: EVENT_ID, subtreeDeleted: true });
}

async function sessionForOwner() {
  let token = await requestMagicLink();
  const value = await api(
    '/core/v1/auth/magic-links/redeem',
    {
      body: JSON.stringify({ token }),
      headers: {
        'idempotency-key': `plan.state.auth.redeem.${crypto.randomUUID()}`,
      },
      method: 'POST',
    },
    200,
  );
  token = undefined;
  if (
    typeof value?.accessToken !== 'string' ||
    !/^usr_[a-f0-9]{32}$/.test(value?.user?.id)
  ) {
    throw new Error('Session missing');
  }
  return { accessToken: value.accessToken };
}

async function requestMagicLink() {
  await api(
    '/core/v1/auth/magic-links',
    {
      body: JSON.stringify({ email: OWNER_EMAIL }),
      headers: {
        'idempotency-key': `plan.state.auth.start.${crypto.randomUUID()}`,
      },
      method: 'POST',
    },
    202,
  );
  const response = await fetch(
    new URL('/internal/magic-links/consume', controlUrl()),
    {
      body: JSON.stringify({ email: OWNER_EMAIL }),
      headers: {
        Authorization: `Bearer ${requiredSecret('NATIVE_E2E_FIXTURE_BEARER')}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    },
  );
  if (!response.ok) throw new Error('Magic-link delivery unavailable');
  const value = await response.json();
  if (
    typeof value?.token !== 'string' ||
    !/^ml_[A-Za-z0-9_-]{43}$/.test(value.token)
  ) {
    throw new Error('Magic-link token missing');
  }
  return value.token;
}

async function control(path, init = {}, expectedStatus = 200) {
  return request(
    new URL(path, controlUrl()),
    {
      ...init,
      headers: {
        Authorization: `Bearer ${requiredSecret('NATIVE_E2E_CONTROL_BEARER')}`,
        ...(init.body === undefined
          ? {}
          : { 'Content-Type': 'application/json' }),
        ...init.headers,
      },
    },
    expectedStatus,
  );
}

async function api(path, init = {}, expectedStatus = 200, token) {
  return request(
    new URL(path, PUBLIC_URL),
    {
      ...init,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.body === undefined
          ? {}
          : { 'Content-Type': 'application/json' }),
        ...init.headers,
      },
    },
    expectedStatus,
  );
}

async function request(url, init, expectedStatus) {
  const response = await fetch(url, init);
  if (response.status !== expectedStatus) {
    throw new Error('Unexpected API status');
  }
  return response.json();
}

function controlUrl() {
  const value = new URL(required('NATIVE_E2E_CONTROL_URL'));
  if (
    value.href !== 'http://127.0.0.1:3101/' ||
    value.username ||
    value.password
  ) {
    throw new Error('Control URL must be exact loopback');
  }
  return value;
}

function requiredSecret(name) {
  const value = required(name);
  if (value.length < 32) throw new Error(`${name} is too short`);
  return value;
}

function requiredAppId() {
  const value = required('APP_ID');
  if (!/^[A-Za-z][A-Za-z0-9._]{2,127}$/.test(value)) {
    throw new Error('APP_ID is invalid');
  }
  return value;
}

function requiredDevice() {
  const value = required('IOS_DEVICE_UDID');
  if (!/^[A-Fa-f0-9-]{36}$/.test(value)) {
    throw new Error('IOS_DEVICE_UDID is invalid');
  }
  return value;
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function spawn(command) {
  const env = Object.fromEntries(
    ['DEVELOPER_DIR', 'HOME', 'LANG', 'PATH', 'TMPDIR'].flatMap(name =>
      process.env[name] === undefined ? [] : [[name, process.env[name]]],
    ),
  );
  const child = Bun.spawn(command, { env, stderr: 'ignore', stdout: 'ignore' });
  if ((await child.exited) !== 0) throw new Error('Device command failed');
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
