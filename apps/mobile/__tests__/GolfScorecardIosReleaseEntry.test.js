'use strict';

const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const entry = readFileSync(
  resolve(__dirname, '../evidence/golf-scorecard-ios-release-entry.js'),
  'utf8',
);

test('keeps the iOS Golf Release entry on production composition and crypto providers', () => {
  for (const source of [
    'FeedbackDeliveryPump',
    'GatewayProvider',
    'PrivateBootstrapGate',
    'RootNavigator',
    'secureSessionStore',
  ]) {
    expect(entry).toContain(source);
  }
  expect(entry).toContain("baseUrl: 'http://127.0.0.1:3000'");
  expect(entry).toContain("requestId: () => 'crew-e2e.ios'");
  expect(entry).toContain(
    "randomUuidAbsent: typeof globalThis.crypto?.randomUUID !== 'function'",
  );
  expect(entry).toContain(
    "secureRandomPresent: typeof globalThis.crypto?.getRandomValues === 'function'",
  );
  expect(entry).toContain(
    "subtleAbsent: typeof globalThis.crypto?.subtle?.digest !== 'function'",
  );
  expect(entry).not.toMatch(/\brandomUUID\s*:/);
  expect(entry).not.toMatch(/\bsha256\s*:/);
  expect(entry).not.toContain('MobileSyncEngine');
  expect(entry).not.toContain('GolfScorecardRuntime.create =');
});
