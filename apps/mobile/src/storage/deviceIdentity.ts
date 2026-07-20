import * as Keychain from 'react-native-keychain';
import {
  assertMutationStreamIdentity,
  discardUnboundMutationStreamIdentity,
  getOrCreateMutationStreamIdentity,
  initializeMutationStreamIdentities,
  recoverSequenceFailureStreams,
  SequenceFailureRecoveryDeferredError,
  type SqlDatabase,
  type SqlExecutor,
} from '@crew/mobile-data';
import { secureUuidV4 } from './secureRandom';

const DEVICE_ID_SERVICE = 'app.crew.next.device-id.v1';
const DEVICE_ID_USERNAME = 'device';
const DEVICE_ID_PATTERN =
  /^dvc_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface DeviceIdCredentials {
  get(): Promise<{ username: string; password: string } | null>;
}

const keychainCredentials: DeviceIdCredentials = {
  async get() {
    const value = await Keychain.getGenericPassword({
      service: DEVICE_ID_SERVICE,
    });
    return value
      ? { username: value.username, password: value.password }
      : null;
  },
};

export class SecureDeviceIdStore {
  readonly #credentials: DeviceIdCredentials;
  readonly #newUuid: () => string;

  constructor(
    credentials: DeviceIdCredentials = keychainCredentials,
    newUuid: () => string = secureUuidV4,
  ) {
    this.#credentials = credentials;
    this.#newUuid = newUuid;
  }

  getOrCreate(
    database: SqlDatabase,
    accountUserId: string,
    rootEventId: string,
  ): Promise<string> {
    return getOrCreateMutationStreamIdentity(
      database,
      accountUserId,
      rootEventId,
      () => this.#legacyDeviceId(),
      () => this.#newDeviceId(),
    );
  }

  async initializeExisting(
    database: SqlDatabase,
    accountUserId: string,
  ): Promise<void> {
    await initializeMutationStreamIdentities(
      database,
      accountUserId,
      () => this.#legacyDeviceId(),
      () => this.#newDeviceId(),
    );
    try {
      await recoverSequenceFailureStreams(database, accountUserId, {
        newDeviceId: () => this.#newDeviceId(),
        randomUUID: this.#newUuid,
      });
    } catch (error) {
      if (!(error instanceof SequenceFailureRecoveryDeferredError)) throw error;
      // Keep private reads available and the untouched dead letter visible.
    }
  }

  discardIfUnbound(
    database: SqlDatabase,
    accountUserId: string,
    rootEventId: string,
  ): Promise<void> {
    return discardUnboundMutationStreamIdentity(
      database,
      accountUserId,
      rootEventId,
    );
  }

  assertCurrent(
    executor: SqlExecutor,
    accountUserId: string,
    rootEventId: string,
    deviceId: string,
  ): Promise<void> {
    return assertMutationStreamIdentity(
      executor,
      accountUserId,
      rootEventId,
      deviceId,
    );
  }

  async #legacyDeviceId(): Promise<string | null> {
    try {
      const existing = await this.#credentials.get();
      return existing?.username === DEVICE_ID_USERNAME &&
        DEVICE_ID_PATTERN.test(existing.password)
        ? existing.password
        : null;
    } catch {
      return null;
    }
  }

  #newDeviceId(): string {
    const deviceId = `dvc_${this.#newUuid()}`;
    if (!DEVICE_ID_PATTERN.test(deviceId)) {
      throw new Error('Secure device ID generation failed');
    }
    return deviceId;
  }
}

export const secureDeviceIdStore = new SecureDeviceIdStore();
