import * as Keychain from 'react-native-keychain';
import { secureUuidV4 } from './secureRandom';

const SERVICE = 'app.crew.next.pending-magic-request.v1';
const MAX_AGE_MS = 15 * 60 * 1_000;
const MAX_FUTURE_SKEW_MS = 60_000;
const IDEMPOTENCY_PATTERN = /^[a-f0-9-]{36}$/;
let tail: Promise<void> = Promise.resolve();

type PendingMagicLinkRequest = {
  email: string;
  idempotencyKey: string;
  createdAt: number;
};

export interface PendingMagicLinkRequestStore {
  getOrCreate(email: string): Promise<PendingMagicLinkRequest>;
  complete(email: string, idempotencyKey: string): Promise<boolean>;
}

export const keychainPendingMagicLinkRequestStore: PendingMagicLinkRequestStore =
  {
    getOrCreate(email) {
      return exclusive(async () => {
        const normalizedEmail = normalizeEmail(email);
        const current = await read();
        if (current?.email === normalizedEmail) return current;

        const next = {
          email: normalizedEmail,
          idempotencyKey: secureUuidV4(),
          createdAt: Date.now(),
        };
        await Keychain.setGenericPassword(
          normalizedEmail,
          JSON.stringify({
            idempotencyKey: next.idempotencyKey,
            createdAt: next.createdAt,
          }),
          keychainOptions(),
        );
        return next;
      });
    },

    complete(email, idempotencyKey) {
      return exclusive(async () => {
        const current = await read();
        if (
          !current ||
          current.email !== normalizeEmail(email) ||
          current.idempotencyKey !== idempotencyKey
        ) {
          return false;
        }
        await Keychain.resetGenericPassword({ service: SERVICE });
        return true;
      });
    },
  };

async function read(): Promise<PendingMagicLinkRequest | null> {
  const value = await Keychain.getGenericPassword({ service: SERVICE });
  if (!value) return null;
  try {
    const parsed = JSON.parse(value.password) as {
      idempotencyKey?: unknown;
      createdAt?: unknown;
    };
    const createdAt = Number(parsed.createdAt);
    const candidate = {
      email: normalizeEmail(value.username),
      idempotencyKey: String(parsed.idempotencyKey ?? ''),
      createdAt,
    };
    if (
      !IDEMPOTENCY_PATTERN.test(candidate.idempotencyKey) ||
      !Number.isFinite(createdAt) ||
      createdAt > Date.now() + MAX_FUTURE_SKEW_MS ||
      Date.now() - createdAt > MAX_AGE_MS
    ) {
      await Keychain.resetGenericPassword({ service: SERVICE });
      return null;
    }
    return candidate;
  } catch {
    await Keychain.resetGenericPassword({ service: SERVICE });
    return null;
  }
}

function normalizeEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  if (
    normalized.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
  ) {
    throw new Error('Invalid email');
  }
  return normalized;
}

function keychainOptions() {
  return {
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    service: SERVICE,
  };
}

function exclusive<Result>(work: () => Promise<Result>): Promise<Result> {
  const result = tail.then(work, work);
  tail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
