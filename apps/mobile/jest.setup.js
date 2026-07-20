import 'react-native-gesture-handler/jestSetup';

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(() => jest.fn()),
  },
}));

jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WhenUnlockedThisDeviceOnly' },
  STORAGE_TYPE: { AES_GCM_NO_AUTH: 'KeystoreAESGCM_NoAuth' },
  getGenericPassword: jest.fn(async () => false),
  resetGenericPassword: jest.fn(async () => true),
  setGenericPassword: jest.fn(async () => true),
}));

jest.mock('@op-engineering/op-sqlite', () => ({
  isSQLCipher: jest.fn(() => true),
  open: jest.fn(),
}));
