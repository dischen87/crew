import type { Session } from '@crew/mobile-client';
import React from 'react';
import { View } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import {
  bootstrapPrivateDatabase,
  type ClosableSqlDatabase,
  PrivateBootstrapGate,
  type PrivateBootstrapDependencies,
  usePrivateSessionLifecycle,
} from '../src/app/PrivateBootstrapGate';
import { DatabaseKeyStorageUnavailableError } from '../src/storage/databaseKey';

const accountId = `usr_${'a'.repeat(32)}`;
const session: Session = {
  accessToken: 'access-token',
  expiresInSeconds: 300,
  refreshToken: 'refresh-token',
  tokenType: 'Bearer',
  user: {
    email: 'crew@example.test',
    id: accountId,
    profile: {
      avatarUrl: null,
      displayName: 'Crew',
      eventReminders: true,
      locale: 'de-CH',
      productUpdates: false,
      reduceMotion: false,
      timeZone: 'Europe/Zurich',
      updatedAt: '2026-07-18T12:00:00Z',
      version: 1,
    },
  },
};

function fakeDatabase() {
  return {
    close: jest.fn(async () => undefined),
  } as unknown as ClosableSqlDatabase;
}

function dependencies(
  storedSession: Session | null,
  database = fakeDatabase(),
): PrivateBootstrapDependencies {
  return {
    sessionStore: {
      get: jest.fn(async () => storedSession),
      compareAndSet: jest.fn(async () => true),
    },
    getDatabaseKey: jest.fn(async () => 'f'.repeat(64)),
    openDatabase: jest.fn(() => database),
    migrateDatabase: jest.fn(async () => undefined),
    purgeDeniedRoots: jest.fn(async () => undefined),
    purgeFeedbackSubmissions: jest.fn(async () => undefined),
    listFeedbackScreenshotFileKeys: jest.fn(async () => []),
    purgeRetainedFeedbackScreenshots: jest.fn(async () => undefined),
    reconcileAttachments: jest.fn(async () => undefined),
    clearPrivateState: jest.fn(async () => undefined),
  };
}

test('keeps key generation, SQLCipher open and migration off signed-out boot', async () => {
  const deps = dependencies(null);

  await expect(bootstrapPrivateDatabase(deps)).resolves.toEqual({
    status: 'signedOut',
  });
  expect(deps.getDatabaseKey).not.toHaveBeenCalled();
  expect(deps.openDatabase).not.toHaveBeenCalled();
  expect(deps.migrateDatabase).not.toHaveBeenCalled();
  expect(deps.purgeDeniedRoots).not.toHaveBeenCalled();
  expect(deps.purgeFeedbackSubmissions).not.toHaveBeenCalled();
  expect(deps.reconcileAttachments).not.toHaveBeenCalled();
});

test('fails closed when the protected session cannot be read', async () => {
  const deps = dependencies(null);
  jest
    .mocked(deps.sessionStore.get)
    .mockRejectedValueOnce(new Error('keychain unavailable'));

  await expect(bootstrapPrivateDatabase(deps)).resolves.toEqual({
    accountId: null,
    reason: 'secureStorage',
    status: 'unavailable',
  });
  expect(deps.getDatabaseKey).not.toHaveBeenCalled();
  expect(deps.openDatabase).not.toHaveBeenCalled();
  expect(deps.migrateDatabase).not.toHaveBeenCalled();
  expect(deps.purgeDeniedRoots).not.toHaveBeenCalled();
  expect(deps.purgeFeedbackSubmissions).not.toHaveBeenCalled();
  expect(deps.reconcileAttachments).not.toHaveBeenCalled();
});

test('distinguishes transient database-key storage access from private-data failure', async () => {
  const transient = dependencies(session);
  jest
    .mocked(transient.getDatabaseKey)
    .mockRejectedValueOnce(new DatabaseKeyStorageUnavailableError());
  await expect(bootstrapPrivateDatabase(transient)).resolves.toEqual({
    accountId,
    reason: 'secureStorage',
    status: 'unavailable',
  });

  const invalid = dependencies(session);
  jest
    .mocked(invalid.getDatabaseKey)
    .mockRejectedValueOnce(new Error('Invalid database encryption key'));
  await expect(bootstrapPrivateDatabase(invalid)).resolves.toEqual({
    accountId,
    reason: 'privateData',
    status: 'unavailable',
  });
  expect(transient.openDatabase).not.toHaveBeenCalled();
  expect(invalid.openDatabase).not.toHaveBeenCalled();
});

test('opens the account database and migrates before reporting ready', async () => {
  const calls: string[] = [];
  const database = fakeDatabase();
  const deps = dependencies(session, database);
  jest.mocked(deps.getDatabaseKey).mockImplementation(async id => {
    calls.push(`key:${id}`);
    return 'f'.repeat(64);
  });
  jest.mocked(deps.openDatabase).mockImplementation((id, key) => {
    calls.push(`open:${id}:${key.length}`);
    return database;
  });
  jest.mocked(deps.migrateDatabase).mockImplementation(async opened => {
    expect(opened).toBe(database);
    calls.push('migrate');
  });
  jest.mocked(deps.purgeDeniedRoots).mockImplementation(async (id, opened) => {
    expect(opened).toBe(database);
    calls.push(`purge:${id}`);
  });
  jest
    .mocked(deps.reconcileAttachments)
    .mockImplementation(async (id, opened) => {
      expect(opened).toBe(database);
      calls.push(`reconcile:${id}`);
    });

  const result = await bootstrapPrivateDatabase(deps);

  expect(result).toMatchObject({ status: 'ready', accountId, database });
  expect(calls).toEqual([
    `key:${accountId}`,
    `open:${accountId}:64`,
    'migrate',
    `purge:${accountId}`,
    `reconcile:${accountId}`,
  ]);
});

test('closes an opened database when migration fails', async () => {
  const database = fakeDatabase();
  const deps = dependencies(session, database);
  jest
    .mocked(deps.migrateDatabase)
    .mockRejectedValueOnce(new Error('migration failed'));

  await expect(bootstrapPrivateDatabase(deps)).resolves.toEqual({
    accountId,
    reason: 'privateData',
    status: 'unavailable',
  });
  expect(database.close).toHaveBeenCalledTimes(1);
  expect(deps.purgeDeniedRoots).not.toHaveBeenCalled();
  expect(deps.reconcileAttachments).not.toHaveBeenCalled();
});

test('keeps navigation unavailable when a recorded denial cannot purge on restart', async () => {
  const database = fakeDatabase();
  const deps = dependencies(session, database);
  jest
    .mocked(deps.purgeDeniedRoots)
    .mockRejectedValueOnce(new Error('closed database'));

  await expect(bootstrapPrivateDatabase(deps)).resolves.toEqual({
    accountId,
    reason: 'privateData',
    status: 'unavailable',
  });
  expect(database.close).toHaveBeenCalledTimes(1);
  expect(deps.reconcileAttachments).not.toHaveBeenCalled();
});

test('keeps private navigation gated until migration completes and closes on unmount', async () => {
  let finishMigration: () => void = () => {};
  const database = fakeDatabase();
  const deps = dependencies(session, database);
  jest.mocked(deps.migrateDatabase).mockImplementation(
    () =>
      new Promise<void>(resolve => {
        finishMigration = resolve;
      }),
  );
  const renderNavigation = jest.fn((status: string) => (
    <View testID={`navigation-${status}`} />
  ));

  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <PrivateBootstrapGate dependencies={deps}>
        {renderNavigation}
      </PrivateBootstrapGate>,
    );
    await Promise.resolve();
  });
  expect(
    renderer!.root.findByProps({ testID: 'navigation-loading' }),
  ).toBeTruthy();
  expect(renderNavigation).not.toHaveBeenCalledWith('ready');

  await ReactTestRenderer.act(async () => {
    finishMigration();
    await Promise.resolve();
  });
  expect(
    renderer!.root.findByProps({ testID: 'navigation-ready' }),
  ).toBeTruthy();

  await ReactTestRenderer.act(async () => {
    renderer!.unmount();
  });
  expect(database.close).toHaveBeenCalledTimes(1);
});

test('closes old private state before atomically replacing the account session', async () => {
  const secondAccountId = `usr_${'b'.repeat(32)}`;
  const secondSession: Session = {
    ...session,
    accessToken: 'access-token-b',
    refreshToken: 'refresh-token-b',
    user: {
      ...session.user,
      id: secondAccountId,
      email: 'second@example.test',
    },
  };
  const calls: string[] = [];
  let storedSession: Session | null = session;
  const firstDatabase = {
    close: jest.fn(async () => {
      calls.push(`close:${accountId}`);
    }),
  } as unknown as ClosableSqlDatabase;
  const secondDatabase = {
    close: jest.fn(async () => {
      calls.push(`close:${secondAccountId}`);
    }),
  } as unknown as ClosableSqlDatabase;
  const deps: PrivateBootstrapDependencies = {
    sessionStore: {
      get: jest.fn(async () => {
        calls.push(`get:${storedSession?.user.id ?? 'none'}`);
        return storedSession;
      }),
      compareAndSet: jest.fn(async (expected, replacement) => {
        calls.push(
          `cas:${expected?.user.id ?? 'none'}->${
            replacement?.user.id ?? 'none'
          }`,
        );
        if (expected?.accessToken !== storedSession?.accessToken) return false;
        storedSession = replacement;
        return true;
      }),
    },
    getDatabaseKey: jest.fn(async id => {
      calls.push(`key:${id}`);
      return 'f'.repeat(64);
    }),
    openDatabase: jest.fn(id => {
      calls.push(`open:${id}`);
      return id === accountId ? firstDatabase : secondDatabase;
    }),
    migrateDatabase: jest.fn(async database => {
      calls.push(
        `migrate:${database === firstDatabase ? accountId : secondAccountId}`,
      );
    }),
    purgeDeniedRoots: jest.fn(async id => {
      calls.push(`purge:${id}`);
    }),
    purgeFeedbackSubmissions: jest.fn(async id => {
      calls.push(`purge-feedback:${id}`);
    }),
    listFeedbackScreenshotFileKeys: jest.fn(async id => {
      calls.push(`list-feedback-files:${id}`);
      return [`${'7'.repeat(64)}.png`];
    }),
    purgeRetainedFeedbackScreenshots: jest.fn(async (id, retainedFileKeys) => {
      calls.push(`purge-feedback-files:${id}:${retainedFileKeys.length}`);
    }),
    reconcileAttachments: jest.fn(async id => {
      calls.push(`reconcile:${id}`);
    }),
    clearPrivateState: jest.fn(async id => {
      calls.push(`clear:${id}`);
    }),
  };
  let lifecycle!: ReturnType<typeof usePrivateSessionLifecycle>;

  function Probe() {
    lifecycle = usePrivateSessionLifecycle();
    return (
      <View testID={`account-${lifecycle.accountId ?? lifecycle.status}`} />
    );
  }

  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <PrivateBootstrapGate dependencies={deps}>
        {() => <Probe />}
      </PrivateBootstrapGate>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(
    renderer!.root.findByProps({ testID: `account-${accountId}` }),
  ).toBeTruthy();

  calls.length = 0;
  await ReactTestRenderer.act(async () => {
    await lifecycle.replaceSession(secondSession);
  });

  expect(calls).toEqual([
    `get:${accountId}`,
    `close:${accountId}`,
    `clear:${accountId}`,
    `cas:${accountId}->${secondAccountId}`,
    `get:${secondAccountId}`,
    `key:${secondAccountId}`,
    `open:${secondAccountId}`,
    `migrate:${secondAccountId}`,
    `purge:${secondAccountId}`,
    `reconcile:${secondAccountId}`,
  ]);
  expect(
    renderer!.root.findByProps({ testID: `account-${secondAccountId}` }),
  ).toBeTruthy();

  calls.length = 0;
  await ReactTestRenderer.act(async () => {
    await lifecycle.replaceSession(null);
  });
  expect(calls).toEqual([
    `get:${secondAccountId}`,
    `list-feedback-files:${secondAccountId}`,
    `purge-feedback-files:${secondAccountId}:1`,
    `purge-feedback:${secondAccountId}`,
    `close:${secondAccountId}`,
    `clear:${secondAccountId}`,
    `cas:${secondAccountId}->none`,
    'get:none',
  ]);
  expect(
    renderer!.root.findByProps({ testID: 'account-signedOut' }),
  ).toBeTruthy();

  await ReactTestRenderer.act(async () => {
    renderer!.unmount();
  });
});

test('never lets an A logout queued behind an A-to-B switch purge or replace B', async () => {
  const secondAccountId = `usr_${'b'.repeat(32)}`;
  const secondSession: Session = {
    ...session,
    accessToken: 'access-token-b',
    refreshToken: 'refresh-token-b',
    user: { ...session.user, id: secondAccountId },
  };
  const firstDatabase = fakeDatabase();
  const secondDatabase = fakeDatabase();
  const deps = dependencies(session, firstDatabase);
  let storedSession: Session | null = session;
  jest
    .mocked(deps.sessionStore.get)
    .mockImplementation(async () => storedSession);
  jest
    .mocked(deps.sessionStore.compareAndSet)
    .mockImplementation(async (expected, replacement) => {
      if (expected?.accessToken !== storedSession?.accessToken) return false;
      storedSession = replacement;
      return true;
    });
  jest
    .mocked(deps.openDatabase)
    .mockImplementation(id =>
      id === accountId ? firstDatabase : secondDatabase,
    );
  let lifecycle!: ReturnType<typeof usePrivateSessionLifecycle>;

  function Probe() {
    lifecycle = usePrivateSessionLifecycle();
    return (
      <View testID={`queued-${lifecycle.accountId ?? lifecycle.status}`} />
    );
  }

  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <PrivateBootstrapGate dependencies={deps}>
        {() => <Probe />}
      </PrivateBootstrapGate>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  let staleLogoutFailure: unknown;
  await ReactTestRenderer.act(async () => {
    const switchToB = lifecycle.replaceSession(secondSession);
    const staleLogout = lifecycle
      .replaceSession(null, accountId)
      .catch(error => error);
    await switchToB;
    staleLogoutFailure = await staleLogout;
  });

  expect(String(staleLogoutFailure)).toBe('Error: Session replacement failed');
  expect(storedSession).toBe(secondSession);
  expect(deps.listFeedbackScreenshotFileKeys).not.toHaveBeenCalled();
  expect(deps.purgeRetainedFeedbackScreenshots).not.toHaveBeenCalled();
  expect(deps.purgeFeedbackSubmissions).not.toHaveBeenCalled();
  expect(deps.sessionStore.compareAndSet).toHaveBeenCalledTimes(1);
  expect(deps.sessionStore.compareAndSet).toHaveBeenCalledWith(
    session,
    secondSession,
  );
  expect(secondDatabase.close).not.toHaveBeenCalled();
  expect(deps.clearPrivateState).not.toHaveBeenCalledWith(secondAccountId);
  expect(
    renderer!.root.findByProps({ testID: `queued-${secondAccountId}` }),
  ).toBeTruthy();

  await ReactTestRenderer.act(async () => {
    renderer!.unmount();
  });
});

test('keeps logout retries fail-closed after a native file purge failure', async () => {
  const database = fakeDatabase();
  const deps = dependencies(session, database);
  const retainedFileKey = `${'7'.repeat(64)}.png`;
  jest
    .mocked(deps.listFeedbackScreenshotFileKeys)
    .mockResolvedValueOnce([retainedFileKey]);
  jest
    .mocked(deps.purgeRetainedFeedbackScreenshots)
    .mockRejectedValueOnce(new Error(`/private/${retainedFileKey}`));
  let lifecycle!: ReturnType<typeof usePrivateSessionLifecycle>;

  function Probe() {
    lifecycle = usePrivateSessionLifecycle();
    return <View testID={`logout-${lifecycle.status}`} />;
  }

  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <PrivateBootstrapGate dependencies={deps}>
        {() => <Probe />}
      </PrivateBootstrapGate>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  let failure: unknown;
  await ReactTestRenderer.act(async () => {
    failure = await lifecycle.replaceSession(null).catch(error => error);
  });

  expect(String(failure)).toBe('Error: Session replacement failed');
  expect(deps.listFeedbackScreenshotFileKeys).toHaveBeenCalledWith(
    accountId,
    database,
  );
  expect(deps.purgeRetainedFeedbackScreenshots).toHaveBeenCalledWith(
    accountId,
    [retainedFileKey],
  );
  expect(deps.purgeFeedbackSubmissions).not.toHaveBeenCalled();
  expect(database.close).toHaveBeenCalledTimes(1);
  expect(deps.clearPrivateState).toHaveBeenCalledWith(accountId);
  expect(deps.sessionStore.compareAndSet).not.toHaveBeenCalled();
  expect(
    renderer!.root.findByProps({ testID: 'logout-unavailable' }),
  ).toBeTruthy();

  await ReactTestRenderer.act(async () => {
    failure = await lifecycle.replaceSession(null).catch(error => error);
  });
  expect(String(failure)).toBe('Error: Session replacement failed');
  expect(deps.listFeedbackScreenshotFileKeys).toHaveBeenCalledTimes(1);
  expect(deps.purgeRetainedFeedbackScreenshots).toHaveBeenCalledTimes(1);
  expect(database.close).toHaveBeenCalledTimes(1);
  expect(deps.sessionStore.compareAndSet).not.toHaveBeenCalled();
  await expect(deps.sessionStore.get()).resolves.toBe(session);

  await ReactTestRenderer.act(async () => {
    renderer!.unmount();
  });
});

test('blocks logout before purge when the protected session belongs to a newer account', async () => {
  const secondSession: Session = {
    ...session,
    accessToken: 'access-token-b',
    refreshToken: 'refresh-token-b',
    user: { ...session.user, id: `usr_${'b'.repeat(32)}` },
  };
  const database = fakeDatabase();
  const deps = dependencies(session, database);
  let lifecycle!: ReturnType<typeof usePrivateSessionLifecycle>;

  function Probe() {
    lifecycle = usePrivateSessionLifecycle();
    return <View />;
  }

  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <PrivateBootstrapGate dependencies={deps}>
        {() => <Probe />}
      </PrivateBootstrapGate>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  jest.mocked(deps.sessionStore.get).mockResolvedValue(secondSession);
  await ReactTestRenderer.act(async () => {
    await expect(lifecycle.replaceSession(null)).rejects.toThrow(
      'Session replacement failed',
    );
  });

  expect(deps.listFeedbackScreenshotFileKeys).not.toHaveBeenCalled();
  expect(deps.purgeRetainedFeedbackScreenshots).not.toHaveBeenCalled();
  expect(deps.purgeFeedbackSubmissions).not.toHaveBeenCalled();
  expect(deps.sessionStore.compareAndSet).not.toHaveBeenCalled();
  expect(database.close).toHaveBeenCalledTimes(1);
  expect(deps.clearPrivateState).toHaveBeenCalledWith(accountId);

  await ReactTestRenderer.act(async () => {
    renderer!.unmount();
  });
});

test('never purges or replaces a newer account when the session races A to B', async () => {
  const secondAccountId = `usr_${'b'.repeat(32)}`;
  const secondSession: Session = {
    ...session,
    accessToken: 'access-token-b',
    refreshToken: 'refresh-token-b',
    user: { ...session.user, id: secondAccountId },
  };
  const database = fakeDatabase();
  const deps = dependencies(session, database);
  let storedSession: Session | null = session;
  let raceOnRead = false;
  jest.mocked(deps.sessionStore.get).mockImplementation(async () => {
    const snapshot = storedSession;
    if (raceOnRead) {
      raceOnRead = false;
      storedSession = secondSession;
    }
    return snapshot;
  });
  jest
    .mocked(deps.sessionStore.compareAndSet)
    .mockImplementation(async (expected, replacement) => {
      if (expected?.accessToken !== storedSession?.accessToken) return false;
      storedSession = replacement;
      return true;
    });
  let lifecycle!: ReturnType<typeof usePrivateSessionLifecycle>;

  function Probe() {
    lifecycle = usePrivateSessionLifecycle();
    return <View />;
  }

  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <PrivateBootstrapGate dependencies={deps}>
        {() => <Probe />}
      </PrivateBootstrapGate>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  raceOnRead = true;
  await ReactTestRenderer.act(async () => {
    await expect(lifecycle.replaceSession(null)).rejects.toThrow(
      'Session replacement failed',
    );
  });

  expect(storedSession).toBe(secondSession);
  expect(deps.listFeedbackScreenshotFileKeys).toHaveBeenCalledWith(
    accountId,
    database,
  );
  expect(deps.purgeRetainedFeedbackScreenshots).toHaveBeenCalledWith(
    accountId,
    [],
  );
  expect(deps.purgeFeedbackSubmissions).toHaveBeenCalledWith(
    accountId,
    database,
  );
  expect(deps.sessionStore.compareAndSet).toHaveBeenCalledWith(session, null);

  await ReactTestRenderer.act(async () => {
    renderer!.unmount();
  });
});

test('clears private state but blocks logout CAS when the database cannot close', async () => {
  const calls: string[] = [];
  const database = {
    close: jest.fn(async () => {
      calls.push('close');
      throw new Error('/private/database');
    }),
  } as unknown as ClosableSqlDatabase;
  const deps = dependencies(session, database);
  jest.mocked(deps.sessionStore.get).mockImplementation(async () => {
    calls.push('get');
    return session;
  });
  jest
    .mocked(deps.listFeedbackScreenshotFileKeys)
    .mockImplementation(async () => {
      calls.push('list');
      return [];
    });
  jest
    .mocked(deps.purgeRetainedFeedbackScreenshots)
    .mockImplementation(async () => {
      calls.push('purge-files');
    });
  jest.mocked(deps.purgeFeedbackSubmissions).mockImplementation(async () => {
    calls.push('purge-db');
  });
  jest.mocked(deps.clearPrivateState).mockImplementation(async () => {
    calls.push('clear');
  });
  let lifecycle!: ReturnType<typeof usePrivateSessionLifecycle>;

  function Probe() {
    lifecycle = usePrivateSessionLifecycle();
    return <View />;
  }

  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <PrivateBootstrapGate dependencies={deps}>
        {() => <Probe />}
      </PrivateBootstrapGate>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  calls.length = 0;
  await ReactTestRenderer.act(async () => {
    await expect(lifecycle.replaceSession(null)).rejects.toThrow(
      'Session replacement failed',
    );
  });

  expect(calls).toEqual([
    'get',
    'list',
    'purge-files',
    'purge-db',
    'close',
    'clear',
  ]);
  expect(deps.sessionStore.compareAndSet).not.toHaveBeenCalled();

  await ReactTestRenderer.act(async () => {
    renderer!.unmount();
  });
});

test('keeps Retry primary recovery non-destructive and reopens the same account', async () => {
  const firstDatabase = fakeDatabase();
  const recoveredDatabase = fakeDatabase();
  const deps = dependencies(session, firstDatabase);
  jest
    .mocked(deps.openDatabase)
    .mockReturnValueOnce(firstDatabase)
    .mockReturnValueOnce(recoveredDatabase);
  jest
    .mocked(deps.migrateDatabase)
    .mockRejectedValueOnce(new Error('private data unavailable'))
    .mockResolvedValue(undefined);
  let lifecycle!: ReturnType<typeof usePrivateSessionLifecycle>;

  function Probe() {
    lifecycle = usePrivateSessionLifecycle();
    return (
      <View
        testID={`retry-${lifecycle.status}-${
          lifecycle.unavailableReason ?? 'none'
        }`}
      />
    );
  }

  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <PrivateBootstrapGate dependencies={deps}>
        {() => <Probe />}
      </PrivateBootstrapGate>,
    );
    await flushPromises();
  });
  expect(
    renderer!.root.findByProps({ testID: 'retry-unavailable-privateData' }),
  ).toBeTruthy();
  expect(lifecycle.accountId).toBeNull();

  await ReactTestRenderer.act(async () => {
    await lifecycle.reloadSession();
  });
  expect(
    renderer!.root.findByProps({ testID: 'retry-ready-none' }),
  ).toBeTruthy();
  expect(lifecycle.accountId).toBe(accountId);
  expect(deps.sessionStore.compareAndSet).not.toHaveBeenCalled();
  expect(deps.purgeFeedbackSubmissions).not.toHaveBeenCalled();
  expect(firstDatabase.close).toHaveBeenCalledTimes(1);

  await ReactTestRenderer.act(async () => renderer!.unmount());
});

test('continues signed-out exactly once for known A and defers unopened private-data cleanup', async () => {
  let storedSession: Session | null = session;
  const deps = dependencies(session);
  jest
    .mocked(deps.sessionStore.get)
    .mockImplementation(async () => storedSession);
  jest
    .mocked(deps.sessionStore.compareAndSet)
    .mockImplementation(async (expected, replacement) => {
      if (expected?.accessToken !== storedSession?.accessToken) return false;
      storedSession = replacement;
      return true;
    });
  jest
    .mocked(deps.migrateDatabase)
    .mockRejectedValueOnce(new Error('private data unavailable'));
  let lifecycle!: ReturnType<typeof usePrivateSessionLifecycle>;

  function Probe() {
    lifecycle = usePrivateSessionLifecycle();
    return <View testID={`known-${lifecycle.status}`} />;
  }

  let renderer = await renderGate(deps, <Probe />);
  expect(
    renderer.root.findByProps({ testID: 'known-unavailable' }),
  ).toBeTruthy();

  let outcomes!: PromiseSettledResult<void>[];
  await ReactTestRenderer.act(async () => {
    outcomes = await Promise.allSettled([
      lifecycle.continueSignedOut(),
      lifecycle.continueSignedOut(),
    ]);
  });
  expect(outcomes.map(outcome => outcome.status)).toEqual([
    'fulfilled',
    'rejected',
  ]);
  expect(storedSession).toBeNull();
  expect(deps.sessionStore.compareAndSet).toHaveBeenCalledTimes(1);
  expect(deps.sessionStore.compareAndSet).toHaveBeenCalledWith(session, null);
  expect(deps.clearPrivateState).toHaveBeenCalledTimes(1);
  expect(deps.clearPrivateState).toHaveBeenCalledWith(accountId);
  expect(deps.listFeedbackScreenshotFileKeys).not.toHaveBeenCalled();
  expect(deps.purgeRetainedFeedbackScreenshots).not.toHaveBeenCalled();
  expect(deps.purgeFeedbackSubmissions).not.toHaveBeenCalled();
  expect(renderer.root.findByProps({ testID: 'known-signedOut' })).toBeTruthy();

  await ReactTestRenderer.act(async () => renderer.unmount());
  renderer = await renderGate(deps, <Probe />);
  expect(renderer.root.findByProps({ testID: 'known-signedOut' })).toBeTruthy();
  expect(deps.sessionStore.compareAndSet).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(async () => renderer.unmount());
});

test('exposes a non-destructive signed-out surface when the account is unknown and retries protected storage after restart', async () => {
  const deps = dependencies(null);
  jest
    .mocked(deps.sessionStore.get)
    .mockRejectedValue(new Error('keychain entitlement unavailable'));
  let lifecycle!: ReturnType<typeof usePrivateSessionLifecycle>;

  function Probe() {
    lifecycle = usePrivateSessionLifecycle();
    return (
      <View
        testID={`unknown-${lifecycle.status}-${
          lifecycle.unavailableReason ?? 'none'
        }`}
      />
    );
  }

  let renderer = await renderGate(deps, <Probe />);
  expect(
    renderer.root.findByProps({
      testID: 'unknown-unavailable-secureStorage',
    }),
  ).toBeTruthy();
  await ReactTestRenderer.act(async () => lifecycle.continueSignedOut());
  expect(
    renderer.root.findByProps({ testID: 'unknown-signedOut-none' }),
  ).toBeTruthy();
  expect(deps.sessionStore.get).toHaveBeenCalledTimes(1);
  expect(deps.sessionStore.compareAndSet).not.toHaveBeenCalled();
  expect(deps.clearPrivateState).not.toHaveBeenCalled();
  expect(deps.listFeedbackScreenshotFileKeys).not.toHaveBeenCalled();
  expect(deps.purgeRetainedFeedbackScreenshots).not.toHaveBeenCalled();
  expect(deps.purgeFeedbackSubmissions).not.toHaveBeenCalled();

  await ReactTestRenderer.act(async () => renderer.unmount());
  renderer = await renderGate(deps, <Probe />);
  expect(
    renderer.root.findByProps({
      testID: 'unknown-unavailable-secureStorage',
    }),
  ).toBeTruthy();
  expect(deps.sessionStore.get).toHaveBeenCalledTimes(2);
  expect(deps.sessionStore.compareAndSet).not.toHaveBeenCalled();
  await ReactTestRenderer.act(async () => renderer.unmount());
});

test('never clears newer B when A changes during unavailable safe exit', async () => {
  const secondAccountId = `usr_${'b'.repeat(32)}`;
  const secondSession: Session = {
    ...session,
    accessToken: 'access-token-b',
    refreshToken: 'refresh-token-b',
    user: { ...session.user, id: secondAccountId },
  };
  let storedSession: Session | null = session;
  const firstDatabase = fakeDatabase();
  const secondDatabase = fakeDatabase();
  const deps = dependencies(session, firstDatabase);
  jest
    .mocked(deps.sessionStore.get)
    .mockImplementation(async () => storedSession);
  jest.mocked(deps.sessionStore.compareAndSet).mockImplementation(async () => {
    storedSession = secondSession;
    return false;
  });
  jest
    .mocked(deps.openDatabase)
    .mockImplementation(id =>
      id === accountId ? firstDatabase : secondDatabase,
    );
  jest
    .mocked(deps.migrateDatabase)
    .mockRejectedValueOnce(new Error('A private data unavailable'))
    .mockResolvedValue(undefined);
  let lifecycle!: ReturnType<typeof usePrivateSessionLifecycle>;

  function Probe() {
    lifecycle = usePrivateSessionLifecycle();
    return <View testID={`race-${lifecycle.accountId ?? lifecycle.status}`} />;
  }

  const renderer = await renderGate(deps, <Probe />);
  expect(
    renderer.root.findByProps({ testID: 'race-unavailable' }),
  ).toBeTruthy();
  await ReactTestRenderer.act(async () => lifecycle.continueSignedOut());

  expect(storedSession).toBe(secondSession);
  expect(deps.sessionStore.compareAndSet).toHaveBeenCalledTimes(1);
  expect(deps.sessionStore.compareAndSet).toHaveBeenCalledWith(session, null);
  expect(deps.clearPrivateState).not.toHaveBeenCalled();
  expect(deps.listFeedbackScreenshotFileKeys).not.toHaveBeenCalled();
  expect(deps.purgeRetainedFeedbackScreenshots).not.toHaveBeenCalled();
  expect(deps.purgeFeedbackSubmissions).not.toHaveBeenCalled();
  expect(
    renderer.root.findByProps({ testID: `race-${secondAccountId}` }),
  ).toBeTruthy();
  expect(secondDatabase.close).not.toHaveBeenCalled();

  await ReactTestRenderer.act(async () => renderer.unmount());
});

async function renderGate(
  deps: PrivateBootstrapDependencies,
  child: React.ReactElement,
) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <PrivateBootstrapGate dependencies={deps}>
        {() => child}
      </PrivateBootstrapGate>,
    );
    await flushPromises();
  });
  return renderer;
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
