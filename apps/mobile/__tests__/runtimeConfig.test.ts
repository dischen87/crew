import {
  gatewayBaseUrlForRuntime,
  nativeE2ERequestIdForRuntime,
  runtimeBuildMetadata,
  runtimeFeedbackDiagnostics,
} from '../src/app/runtimeConfig';

const configured = {
  appVersion: '2.3.0',
  buildNumber: '81',
  gatewayBaseUrl: 'https://gateway.staging.crew.example',
  platform: 'ios',
};

test('accepts only a canonical approved HTTPS origin in release', () => {
  expect(gatewayBaseUrlForRuntime(false, configured)).toBe(
    'https://gateway.staging.crew.example',
  );
  expect(
    gatewayBaseUrlForRuntime(false, {
      ...configured,
      gatewayBaseUrl: 'https://gateway.staging.crew.example:8443',
    }),
  ).toBe('https://gateway.staging.crew.example:8443');
});

test.each([
  '',
  ' ',
  'http://gateway.staging.crew.example',
  'https://user@gateway.staging.crew.example',
  'https://gateway.staging.crew.example/path',
  'https://gateway.staging.crew.example?channel=release',
  'https://gateway.staging.crew.example#release',
  'https://gateway.staging.crew.example/',
  'https://localhost',
  'https://localhost.',
  'https://api.localhost',
  'https://api.localhost.',
  'https://127.0.0.1',
  'https://127.7.8.9',
  'https://2130706433',
  'https://0177.0.0.1',
  'https://[::1]',
  'https://[0:0:0:0:0:0:0:1]',
  ' HTTPS://gateway.staging.crew.example',
  'not a URL',
])('rejects unsafe or non-canonical release Gateway value %p', value => {
  expect(
    gatewayBaseUrlForRuntime(false, {
      ...configured,
      gatewayBaseUrl: value,
    }),
  ).toBeNull();
});

test('keeps the development loopback isolated from injected release config', () => {
  expect(
    gatewayBaseUrlForRuntime(true, {
      ...configured,
      gatewayBaseUrl: 'https://unrelated.example',
    }),
  ).toBe('http://127.0.0.1:3000');
  expect(gatewayBaseUrlForRuntime(false, null)).toBeNull();
});

test('accepts only the platform-bound native E2E request ID in development', () => {
  expect(
    nativeE2ERequestIdForRuntime(true, {
      nativeE2ERequestId: 'crew-e2e.ios',
      platform: 'ios',
    }),
  ).toBe('crew-e2e.ios');
  expect(
    nativeE2ERequestIdForRuntime(true, {
      nativeE2ERequestId: 'crew-e2e.android',
      platform: 'android',
    }),
  ).toBe('crew-e2e.android');
});

test.each([
  [false, 'crew-e2e.ios', 'ios'],
  [true, 'crew-e2e.android', 'ios'],
  [true, 'crew-e2e.golf.ios', 'ios'],
  [true, 'crew-e2e.ios.extra', 'ios'],
  [true, 'crew-e2e.ios bearer-secret', 'ios'],
  [true, '', 'ios'],
  [true, 'crew-e2e.ios', 'web'],
  [true, null, 'ios'],
])(
  'rejects a disabled, mismatched or malformed native E2E ID %#',
  (isDevelopment, nativeE2ERequestId, platform) => {
    expect(
      nativeE2ERequestIdForRuntime(isDevelopment, {
        nativeE2ERequestId,
        platform,
      }),
    ).toBeNull();
  },
);

test('fails closed instead of evaluating hostile runtime property access', () => {
  const hostile = new Proxy(
    {},
    {
      get() {
        throw new Error('must stay inside the boundary');
      },
    },
  );
  expect(gatewayBaseUrlForRuntime(false, hostile)).toBeNull();
  expect(runtimeBuildMetadata(hostile)).toBeNull();
  expect(nativeE2ERequestIdForRuntime(true, hostile)).toBeNull();
});

test('exposes only bounded version, build and platform diagnostics', () => {
  const input = {
    ...configured,
    deviceId: 'must-not-cross-the-boundary',
    token: 'must-not-cross-the-boundary',
  };
  expect(runtimeBuildMetadata(input)).toEqual({
    appVersion: '2.3.0',
    buildNumber: '81',
    platform: 'ios',
  });
  expect(runtimeFeedbackDiagnostics(input)).toEqual(
    runtimeBuildMetadata(input),
  );
});

test.each([
  { ...configured, appVersion: '' },
  { ...configured, appVersion: 'eyJhbGciOiJIUzI1NiJ9.secret.signature' },
  { ...configured, buildNumber: 'iPhone16,1' },
  { ...configured, buildNumber: '-1' },
  { ...configured, platform: 'web' },
  { ...configured, platform: 'ios-device-id' },
  null,
  [],
])('fails metadata closed for malformed or device-shaped input %#', value => {
  expect(runtimeBuildMetadata(value)).toBeNull();
  expect(runtimeFeedbackDiagnostics(value)).toBeNull();
});
