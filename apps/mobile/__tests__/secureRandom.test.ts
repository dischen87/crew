import { secureRandomBytes, secureUuidV4 } from '../src/storage/secureRandom';

let originalCrypto: PropertyDescriptor | undefined;

beforeEach(() => {
  originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
});

afterEach(() => {
  if (originalCrypto) {
    Object.defineProperty(globalThis, 'crypto', originalCrypto);
  } else {
    delete (globalThis as { crypto?: Crypto }).crypto;
  }
  jest.restoreAllMocks();
});

test('formats CSPRNG bytes as an RFC 4122 UUIDv4 without Math.random', () => {
  const getRandomValues = jest.fn((bytes: Uint8Array) => {
    bytes.fill(0xff);
    return bytes;
  });
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { getRandomValues },
  });
  const mathRandom = jest.spyOn(Math, 'random');

  expect(secureUuidV4()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
  expect(getRandomValues).toHaveBeenCalledTimes(1);
  expect(mathRandom).not.toHaveBeenCalled();
});

test('fails closed when the native secure random source is unavailable', () => {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: undefined,
  });

  expect(() => secureRandomBytes(32)).toThrow(
    'Secure random generation is unavailable',
  );
});
