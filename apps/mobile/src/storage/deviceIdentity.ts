import * as Keychain from 'react-native-keychain';
import { secureUuidV4 } from './secureRandom';

const DEVICE_ID_SERVICE = 'app.crew.next.device-id.v1';
const DEVICE_ID_USERNAME = 'device';
const DEVICE_ID_PATTERN =
  /^dvc_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface DeviceIdCredentials {
  get(): Promise<{ username: string; password: string } | null>;
  set(username: string, password: string): Promise<void>;
  reset(): Promise<void>;
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
  async set(username, password) {
    await Keychain.setGenericPassword(username, password, {
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      service: DEVICE_ID_SERVICE,
    });
  },
  async reset() {
    await Keychain.resetGenericPassword({ service: DEVICE_ID_SERVICE });
  },
};

export class SecureDeviceIdStore {
  readonly #credentials: DeviceIdCredentials;
  readonly #newUuid: () => string;
  #pending: Promise<string> | null = null;

  constructor(
    credentials: DeviceIdCredentials = keychainCredentials,
    newUuid: () => string = secureUuidV4,
  ) {
    this.#credentials = credentials;
    this.#newUuid = newUuid;
  }

  getOrCreate(): Promise<string> {
    if (this.#pending) return this.#pending;
    const pending = this.#getOrCreate().finally(() => {
      if (this.#pending === pending) this.#pending = null;
    });
    this.#pending = pending;
    return pending;
  }

  async #getOrCreate(): Promise<string> {
    const existing = await this.#credentials.get();
    if (
      existing?.username === DEVICE_ID_USERNAME &&
      DEVICE_ID_PATTERN.test(existing.password)
    ) {
      return existing.password;
    }
    if (existing) await this.#credentials.reset();
    const deviceId = `dvc_${this.#newUuid()}`;
    if (!DEVICE_ID_PATTERN.test(deviceId)) {
      throw new Error('Secure device ID generation failed');
    }
    await this.#credentials.set(DEVICE_ID_USERNAME, deviceId);
    return deviceId;
  }
}

export const secureDeviceIdStore = new SecureDeviceIdStore();
