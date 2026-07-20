/* global require */

import { Alert, Linking, Settings, StatusBar } from 'react-native';

const sha256Pattern = /^[a-f0-9]{64}$/;

let evidenceState = null;
Linking.getInitialURL().then(
  url => {
    if (url === 'crewnext://evidence/create-offline') {
      evidenceState = 'create-offline';
    } else if (url === 'crewnext://evidence/online') {
      evidenceState = 'online';
    }
  },
  () => undefined,
);

const platformGet = Settings.get.bind(Settings);
Settings.get = key => {
  if (key === 'CrewEvidenceState') return evidenceState;
  if (key === 'CrewEvidenceCryptoProof') return null;
  return platformGet(key);
};

const platformInfo = console.info.bind(console);
console.info = (...values) => {
  platformInfo(...values);
  if (
    values[0] !== '[crew-release-root-create-proof]' ||
    typeof values[1] !== 'string'
  ) {
    return;
  }
  const proof = JSON.parse(values[1]);
  if (
    !sha256Pattern.test(proof.bodySha256) ||
    !sha256Pattern.test(proof.idempotencyKeySha256) ||
    proof.releaseCryptoShape?.randomUuidAbsent !== true ||
    proof.releaseCryptoShape?.secureRandomPresent !== true ||
    proof.releaseCryptoShape?.subtleAbsent !== true ||
    proof.secureIds !== true
  ) {
    throw new Error('Invalid sanitized Release crypto proof');
  }
  Alert.alert(
    'Sanitized Release crypto proof',
    JSON.stringify({
      bodySha256: proof.bodySha256,
      idempotencyKeySha256: proof.idempotencyKeySha256,
      phase:
        evidenceState === 'create-offline'
          ? 'offline-enqueue'
          : 'process-restart-replay',
      releaseCryptoShape: {
        randomUuidAbsent: true,
        secureRandomPresent: true,
        subtleAbsent: true,
      },
      secureIds: true,
    }),
  );
};

StatusBar.setBarStyle('dark-content', false);

require('./event-creation-production-entry');
