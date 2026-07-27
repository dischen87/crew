#!/usr/bin/env bun

const actors = Object.freeze({
  owner: 'crew.team.local@example.test',
  participant: 'crew.team.participant.local@example.test',
});

try {
  const role = process.argv[2];
  const platform = process.argv[3];
  if (!Object.hasOwn(actors, role) || !['android', 'ios'].includes(platform)) {
    throw new Error('Invalid role or platform');
  }

  const response = await fetch(
    'http://127.0.0.1:3101/internal/magic-links/consume',
    {
      body: JSON.stringify({email: actors[role]}),
      headers: {
        Authorization: `Bearer ${required('NATIVE_E2E_FIXTURE_BEARER')}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    },
  );
  if (!response.ok) throw new Error('Delivery unavailable');
  let token = (await response.json()).token;
  if (typeof token !== 'string' || !/^ml_[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new Error('Invalid delivery');
  }

  let deepLink = `crewnext://auth/redeem?token=${encodeURIComponent(token)}`;
  if (platform === 'ios') {
    await run([
      '/usr/bin/xcrun',
      'simctl',
      'openurl',
      required('IOS_DEVICE_UDID'),
      deepLink,
    ]);
  } else {
    await run([
      required('ADB'),
      '-s',
      required('ANDROID_SERIAL'),
      'shell',
      'am',
      'start',
      '-W',
      '-a',
      'android.intent.action.VIEW',
      '-d',
      deepLink,
      required('APP_ID'),
    ]);
  }
  token = undefined;
  deepLink = undefined;
  process.stdout.write(`${JSON.stringify({opened: true, platform, role})}\n`);
} catch {
  process.stderr.write('Sanitized team authentication control failed.\n');
  process.exitCode = 1;
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function run(command) {
  const child = Bun.spawn(command, {stderr: 'ignore', stdout: 'ignore'});
  if ((await child.exited) !== 0) throw new Error('Device command failed');
}
