/* global fetch */

import 'react-native-get-random-values';

import React, { useEffect } from 'react';
import { AppRegistry, Settings } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PrivateBootstrapGate } from '../src/app/PrivateBootstrapGate';
import {
  PrivateAccessView,
  PrivateLoadingScreen,
  PrivateUnavailableScreen,
} from '../src/screens/PrivateAccessScreen';

const mode =
  Settings.get('CrewEvidenceState') === 'private-unavailable-secure-storage'
    ? 'unknown-secure-storage'
    : 'known-private-data';
const proofEnabled =
  Settings.get('CrewEvidencePrivateUnavailableProof') === 'enabled';
const fixture = createFixture(mode);

function PrivateUnavailableEvidenceApp() {
  return (
    <SafeAreaProvider>
      <PrivateBootstrapGate dependencies={fixture.dependencies}>
        {status => <EvidenceSurface status={status} />}
      </PrivateBootstrapGate>
    </SafeAreaProvider>
  );
}

function EvidenceSurface({ status }) {
  useEffect(() => {
    if (status === 'signedOut') {
      fixture.publish('signedOut').catch(() => undefined);
    }
  }, [status]);

  if (status === 'loading') return <PrivateLoadingScreen />;
  if (status === 'unavailable') return <PrivateUnavailableScreen />;
  return (
    <PrivateAccessView onAction={() => undefined} state="sessionRequired" />
  );
}

function createFixture(fixtureMode) {
  const knownSession = {
    accessToken: 'synthetic-evidence-session',
    expiresInSeconds: 300,
    refreshToken: 'synthetic-evidence-refresh',
    tokenType: 'Bearer',
    user: {
      email: 'evidence@example.test',
      id: `usr_${'a'.repeat(32)}`,
      profile: {
        avatarUrl: null,
        displayName: 'Evidence',
        eventReminders: false,
        locale: 'de-CH',
        productUpdates: false,
        reduceMotion: false,
        timeZone: 'Europe/Zurich',
        updatedAt: '2026-07-19T12:00:00.000Z',
        version: 1,
      },
    },
  };
  let storedSession =
    fixtureMode === 'known-private-data' ? knownSession : null;
  const published = new Set();
  const counters = {
    accountScopedClearCalls: 0,
    accountScopedClearGuardMatched: null,
    attachmentReconciliationCalls: 0,
    compareAndSetCalls: 0,
    databaseKeyReads: 0,
    databaseOpenCalls: 0,
    deniedRootPurgeCalls: 0,
    feedbackFileListCalls: 0,
    feedbackFilePurgeCalls: 0,
    feedbackSubmissionPurgeCalls: 0,
    guardedCasMatched: null,
    migrationCalls: 0,
    sessionReads: 0,
    sessionReplacementWasNull: null,
  };

  async function publish(phase) {
    if (!proofEnabled || published.has(phase)) return;
    const proof = {
      ...counters,
      mode: fixtureMode,
      phase,
      reason:
        fixtureMode === 'known-private-data' ? 'privateData' : 'secureStorage',
      signedOut: phase === 'signedOut',
    };
    const response = await fetch('http://127.0.0.1:3197/proof', {
      body: JSON.stringify(proof),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    if (!response.ok) throw new Error('Private recovery proof rejected');
    published.add(phase);
  }

  const dependencies = {
    sessionStore: {
      async get() {
        counters.sessionReads += 1;
        if (fixtureMode === 'unknown-secure-storage') {
          throw new Error('Synthetic protected-storage outage');
        }
        return storedSession;
      },
      async compareAndSet(expected, replacement) {
        counters.compareAndSetCalls += 1;
        counters.guardedCasMatched = expected === storedSession;
        counters.sessionReplacementWasNull = replacement === null;
        if (
          !counters.guardedCasMatched ||
          !counters.sessionReplacementWasNull
        ) {
          return false;
        }
        storedSession = replacement;
        return true;
      },
    },
    async getDatabaseKey() {
      counters.databaseKeyReads += 1;
      if (counters.databaseKeyReads > 1) await publish('retry');
      throw new Error('Synthetic private-data outage');
    },
    openDatabase() {
      counters.databaseOpenCalls += 1;
      throw new Error('Evidence must not open a database');
    },
    async migrateDatabase() {
      counters.migrationCalls += 1;
    },
    async purgeDeniedRoots() {
      counters.deniedRootPurgeCalls += 1;
    },
    async purgeFeedbackSubmissions() {
      counters.feedbackSubmissionPurgeCalls += 1;
    },
    async listFeedbackScreenshotFileKeys() {
      counters.feedbackFileListCalls += 1;
      return [];
    },
    async purgeRetainedFeedbackScreenshots() {
      counters.feedbackFilePurgeCalls += 1;
    },
    async reconcileAttachments() {
      counters.attachmentReconciliationCalls += 1;
    },
    async clearPrivateState(accountId) {
      counters.accountScopedClearCalls += 1;
      counters.accountScopedClearGuardMatched =
        accountId === knownSession.user.id;
      await publish('signedOut');
    },
  };

  return {
    dependencies,
    publish,
  };
}

AppRegistry.registerComponent('CrewNext', () => PrivateUnavailableEvidenceApp);
