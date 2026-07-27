#!/usr/bin/env bun

const PUBLIC_URL = 'http://127.0.0.1:3000';
const ROOT_EVENT_ID = 'evt_publish_role_setup_final';
const ACTORS = Object.freeze({
  owner: 'crew.local@example.test',
  organizer: 'crew.golf.organizer.local@example.test',
});

try {
  const command = process.argv[2];
  if (command === 'prepare') await prepare();
  else if (command === 'authenticate')
    await authenticate(process.argv[3], process.argv[4]);
  else throw new Error('Unsupported command');
} catch {
  process.stderr.write('Sanitized invite-manager control command failed.\n');
  process.exitCode = 1;
}

async function prepare() {
  const owner = await sessionFor(ACTORS.owner);
  const organizer = await sessionFor(ACTORS.organizer);

  const created = await api(
    '/core/v1/event-roots',
    {
      body: JSON.stringify({
        description: 'Native role denial matrix.',
        endsAt: '2026-10-05T17:00:00.000Z',
        id: ROOT_EVENT_ID,
        kind: 'other',
        startsAt: '2026-10-01T09:00:00.000Z',
        status: 'draft',
        timeZone: 'Europe/Zurich',
        title: 'Native Role Setup',
      }),
      headers: { 'idempotency-key': 'invite.manager.role.setup.create.v1' },
      method: 'POST',
    },
    201,
    owner.accessToken,
  );
  if (created?.event?.id !== ROOT_EVENT_ID) {
    throw new Error('Role root mismatch');
  }

  const invitation = await api(
    `/core/v1/event-roots/${ROOT_EVENT_ID}/invitations`,
    {
      body: JSON.stringify({
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        id: 'inv_invite_manager_role_setup_organizer',
        maxUses: 1,
        normalizedEmailHint: ACTORS.organizer,
        role: 'organizer',
      }),
      headers: {
        'idempotency-key': 'invite.manager.role.setup.organizer.invite.v1',
      },
      method: 'POST',
    },
    201,
    owner.accessToken,
  );
  let invitationToken = invitation?.token;
  if (
    typeof invitationToken !== 'string' ||
    !/^cin_[A-Za-z0-9_-]{43}$/.test(invitationToken)
  ) {
    throw new Error('Invitation token missing');
  }
  const redeemed = await api(
    '/core/v1/invitations/redeem',
    {
      body: JSON.stringify({ token: invitationToken }),
      headers: {
        'idempotency-key': 'invite.manager.role.setup.organizer.redeem.v1',
      },
      method: 'POST',
    },
    200,
    organizer.accessToken,
  );
  invitationToken = undefined;
  if (
    redeemed?.membership?.rootEventId !== ROOT_EVENT_ID ||
    redeemed.membership.userId !== organizer.userId ||
    redeemed.membership.role !== 'organizer' ||
    redeemed.membership.status !== 'active'
  ) {
    throw new Error('Organizer membership mismatch');
  }

  const memberships = await api(
    `/core/v1/event-roots/${ROOT_EVENT_ID}/memberships`,
    {},
    200,
    owner.accessToken,
  );
  const roles = new Set(
    memberships?.items
      ?.filter(item => item?.status === 'active')
      .map(item => item.role),
  );
  if (!roles.has('owner') || !roles.has('organizer')) {
    throw new Error('Role fixture incomplete');
  }
  print({
    fixture: 'ready',
    memberships: ['owner', 'organizer'],
    rootEventId: ROOT_EVENT_ID,
  });
}

async function authenticate(role, platform) {
  if (!Object.hasOwn(ACTORS, role) || !['ios', 'android'].includes(platform)) {
    throw new Error('Role or platform is invalid');
  }
  const appId = requiredAppId();
  let token = await requestMagicLink(ACTORS[role]);
  let deepLink = `crewnext://auth/redeem?token=${encodeURIComponent(token)}`;
  if (platform === 'ios') {
    const device = requiredIosDevice();
    await spawn(['/usr/bin/xcrun', 'simctl', 'launch', device, appId]);
    await spawn(['/usr/bin/xcrun', 'simctl', 'openurl', device, deepLink]);
  } else {
    const device = requiredAndroidDevice();
    await spawn([
      'adb',
      '-s',
      device,
      'shell',
      'am',
      'start',
      '-W',
      '-a',
      'android.intent.action.VIEW',
      '-d',
      deepLink,
      appId,
    ]);
  }
  token = undefined;
  deepLink = undefined;
  print({ opened: true, platform, role });
}

async function sessionFor(email) {
  let token = await requestMagicLink(email);
  const value = await api(
    '/core/v1/auth/magic-links/redeem',
    {
      body: JSON.stringify({ token }),
      headers: {
        'idempotency-key': `invite.manager.auth.redeem.${crypto.randomUUID()}`,
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
  return { accessToken: value.accessToken, userId: value.user.id };
}

async function requestMagicLink(email) {
  await api(
    '/core/v1/auth/magic-links',
    {
      body: JSON.stringify({ email }),
      headers: {
        'idempotency-key': `invite.manager.auth.start.${crypto.randomUUID()}`,
      },
      method: 'POST',
    },
    202,
  );
  const response = await fetch(
    new URL('/internal/magic-links/consume', controlUrl()),
    {
      body: JSON.stringify({ email }),
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

async function api(path, init = {}, expectedStatus = 200, token) {
  const response = await fetch(new URL(path, PUBLIC_URL), {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.body === undefined
        ? {}
        : { 'Content-Type': 'application/json' }),
      ...init.headers,
    },
  });
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

function requiredIosDevice() {
  const value = required('IOS_DEVICE_UDID');
  if (!/^[A-Fa-f0-9-]{36}$/.test(value)) {
    throw new Error('IOS_DEVICE_UDID is invalid');
  }
  return value;
}

function requiredAndroidDevice() {
  const value = required('ANDROID_SERIAL');
  if (!/^[A-Za-z0-9._:-]{1,96}$/.test(value)) {
    throw new Error('ANDROID_SERIAL is invalid');
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
    [
      'ANDROID_HOME',
      'ANDROID_SDK_ROOT',
      'DEVELOPER_DIR',
      'HOME',
      'LANG',
      'PATH',
      'TMPDIR',
    ].flatMap(name =>
      process.env[name] === undefined ? [] : [[name, process.env[name]]],
    ),
  );
  const child = Bun.spawn(command, { env, stderr: 'ignore', stdout: 'ignore' });
  if ((await child.exited) !== 0) throw new Error('Device command failed');
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
