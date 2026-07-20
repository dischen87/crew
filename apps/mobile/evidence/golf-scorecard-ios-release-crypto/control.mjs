#!/usr/bin/env bun

const controlUrl = requiredLoopbackUrl(
  process.env.NATIVE_E2E_CONTROL_URL,
  'NATIVE_E2E_CONTROL_URL',
);
const controlBearer = requiredSecret(
  process.env.NATIVE_E2E_CONTROL_BEARER,
  'NATIVE_E2E_CONTROL_BEARER',
);
const fixtureBearer = requiredSecret(
  process.env.NATIVE_E2E_FIXTURE_BEARER,
  'NATIVE_E2E_FIXTURE_BEARER',
);

const command = process.argv[2];

try {
  switch (command) {
    case 'status':
      print(await control('/v1/status'));
      break;
    case 'setup': {
      const response = await control(
        '/v1/setup',
        {
          body: JSON.stringify({ scenario: 'golf-tour' }),
          method: 'POST',
        },
        201,
      );
      assertSetup(response);
      print({
        ownerPresent: true,
        participantPresent: true,
        scenario: 'golf-tour',
        setup: 'ready',
      });
      break;
    }
    case 'clear':
      await control('/v1/traces', { method: 'DELETE' }, 204);
      print({ traces: 0 });
      break;
    case 'allow':
      print(
        await control('/v1/traces/allow', {
          body: JSON.stringify({ requestIds: ['crew-e2e.ios'] }),
          method: 'POST',
        }),
      );
      break;
    case 'detach':
    case 'attach':
      print(
        await control(`/v1/transport/${command}`, {
          body: '',
          method: 'POST',
        }),
      );
      break;
    case 'fault':
      print(
        await control(
          '/v1/faults/sync-push-once',
          {
            body: JSON.stringify({ requestId: 'crew-e2e.ios' }),
            method: 'POST',
          },
          201,
        ),
      );
      break;
    case 'traces': {
      const response = await control('/v1/traces');
      if (!Array.isArray(response?.traces)) fail('Invalid trace response');
      print({ traces: response.traces.map(sanitizeTrace) });
      break;
    }
    case 'redeem':
      await redeem(process.argv[3]);
      break;
    default:
      fail('Unsupported command');
  }
} catch {
  fail('Sanitized control command failed');
}

async function redeem(role) {
  const email = {
    owner: 'crew.local@example.test',
    participant: 'crew.golf.participant.local@example.test',
  }[role];
  if (!email) fail('Role must be owner or participant');
  const device = required(process.env.IOS_DEVICE_UDID, 'IOS_DEVICE_UDID');
  const response = await fetch(
    new URL('/internal/magic-links/consume', controlUrl),
    {
      body: JSON.stringify({ email }),
      headers: {
        Authorization: `Bearer ${fixtureBearer}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    },
  );
  if (!response.ok) fail('Magic link is not ready');
  const body = await response.json();
  let token = body?.token;
  if (typeof token !== 'string' || !/^ml_[A-Za-z0-9_-]{43}$/.test(token)) {
    fail('Invalid magic-link response');
  }
  const opened = Bun.spawn(
    [
      '/usr/bin/xcrun',
      'simctl',
      'openurl',
      device,
      `crewnext://auth/redeem?token=${encodeURIComponent(token)}`,
    ],
    { stderr: 'ignore', stdout: 'ignore' },
  );
  const exitCode = await opened.exited;
  token = undefined;
  if (exitCode !== 0) fail('Simulator did not accept the auth return');
  print({ opened: true, role });
}

async function control(path, init = {}, expectedStatus = 200) {
  const response = await fetch(new URL(path, controlUrl), {
    ...init,
    headers: {
      Authorization: `Bearer ${controlBearer}`,
      ...(init.body === undefined
        ? {}
        : { 'Content-Type': 'application/json' }),
    },
  });
  if (response.status !== expectedStatus) fail('Unexpected control response');
  return expectedStatus === 204 ? null : response.json();
}

function assertSetup(value) {
  if (
    value?.scenario !== 'golf-tour' ||
    typeof value?.rootEventId !== 'string' ||
    value?.owner?.email !== 'crew.local@example.test' ||
    typeof value?.owner?.userId !== 'string' ||
    value?.participant?.email !== 'crew.golf.participant.local@example.test' ||
    typeof value?.participant?.userId !== 'string'
  ) {
    fail('Invalid setup response');
  }
}

function sanitizeTrace(value) {
  if (
    !Number.isInteger(value?.sequence) ||
    value.requestId !== 'crew-e2e.ios' ||
    !fingerprint(value.bodyFingerprint) ||
    !(
      value.idempotencyFingerprint === null ||
      fingerprint(value.idempotencyFingerprint)
    ) ||
    !['forwarded', 'success-suppressed', 'transport-detached'].includes(
      value.outcome,
    ) ||
    typeof value.replayed !== 'boolean' ||
    !Number.isInteger(value.facadeStatus) ||
    !(
      value.downstreamStatus === null ||
      Number.isInteger(value.downstreamStatus)
    )
  ) {
    fail('Invalid trace record');
  }
  return {
    bodyFingerprint: value.bodyFingerprint,
    downstreamStatus: value.downstreamStatus,
    facadeStatus: value.facadeStatus,
    idempotencyFingerprint: value.idempotencyFingerprint,
    outcome: value.outcome,
    replayed: value.replayed,
    requestChannel: 'ios',
    sequence: value.sequence,
  };
}

function fingerprint(value) {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
}

function requiredLoopbackUrl(value, name) {
  const parsed = new URL(required(value, name));
  if (
    parsed.protocol !== 'http:' ||
    parsed.hostname !== '127.0.0.1' ||
    parsed.port !== '3101' ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    fail(`${name} must be the exact loopback control URL`);
  }
  return parsed;
}

function requiredSecret(value, name) {
  const secret = required(value, name);
  if (secret.length < 32) fail(`${name} must contain at least 32 characters`);
  return secret;
}

function required(value, name) {
  if (!value) fail(`${name} is required`);
  return value;
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function fail(message) {
  throw new Error(message);
}
