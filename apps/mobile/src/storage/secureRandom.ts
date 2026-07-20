export function secureRandomBytes(length: number): Uint8Array {
  const crypto = globalThis.crypto;
  if (!crypto?.getRandomValues) {
    throw new Error('Secure random generation is unavailable');
  }

  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function secureUuidV4(): string {
  const bytes = secureRandomBytes(16);
  bytes[6] = (bytes[6] % 16) + 64;
  bytes[8] = (bytes[8] % 64) + 128;
  const hex = Array.from(bytes, value =>
    value.toString(16).padStart(2, '0'),
  ).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}
