import { createDefaultGatewayClient } from '../src/app/GatewayProvider';

test('keeps an unconfigured release network-fail-closed', () => {
  expect(createDefaultGatewayClient(false)).toBeNull();
});

test('constructs a release client only from an approved native HTTPS origin', () => {
  expect(
    createDefaultGatewayClient(false, {
      gatewayBaseUrl: 'https://gateway.production.crew.example',
    }),
  ).not.toBeNull();
  expect(
    createDefaultGatewayClient(false, {
      gatewayBaseUrl: 'https://gateway.production.crew.example/path',
    }),
  ).toBeNull();
});

test('uses only the controlled loopback Gateway in development', () => {
  expect(
    createDefaultGatewayClient(true, {
      gatewayBaseUrl: 'https://gateway.production.crew.example',
    }),
  ).not.toBeNull();
});

test('uses the fixed allow-listed request ID only for a matching development build', async () => {
  const seen: string[] = [];
  const fetchMock = jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (_input, init) => {
      const requestId = new Headers(init?.headers).get('x-request-id') ?? '';
      seen.push(requestId);
      return new Response(JSON.stringify({ accepted: true }), {
        headers: {
          'Content-Type': 'application/json',
          'X-Request-ID': requestId,
        },
        status: 202,
      });
    });
  const client = createDefaultGatewayClient(true, {
    nativeE2ERequestId: 'crew-e2e.ios',
    platform: 'ios',
  });

  await client?.request('identityMagicLinksCreate', {
    body: { email: 'native-e2e@example.com' },
  });

  expect(seen).toEqual(['crew-e2e.ios']);
  fetchMock.mockRestore();
});
