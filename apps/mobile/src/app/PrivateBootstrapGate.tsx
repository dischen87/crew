import {
  listFeedbackScreenshotFileKeysForPurge,
  LocalAttachmentStore,
  migrate,
  MobileDataStore,
  type SqlDatabase,
} from '@crew/mobile-data';
import type { Session, SessionStore } from '@crew/mobile-client';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  DatabaseKeyStorageUnavailableError,
  getOrCreateDatabaseKey,
} from '../storage/databaseKey';
import {
  purgeRetainedAttachmentFiles,
  quiesceAttachmentMedia,
  reconcileRetainedAttachmentFiles,
  resumeAttachmentMedia,
} from '../media/attachmentMedia';
import { openAccountDatabase } from '../storage/opSqliteAdapter';
import { deniedRootRegistry } from '../storage/deniedRoots';
import { secureDeviceIdStore } from '../storage/deviceIdentity';
import { secureSessionStore } from '../storage/secureSession';
import { queryClient } from './queryClient';

export type PrivateNavigationStatus =
  | 'loading'
  | 'signedOut'
  | 'unavailable'
  | 'ready';

export type PrivateUnavailableReason = 'privateData' | 'secureStorage';

export type ClosableSqlDatabase = SqlDatabase & {
  close(): Promise<void>;
};

export type PrivateBootstrapDependencies = {
  sessionStore: Pick<SessionStore, 'get' | 'compareAndSet'>;
  getDatabaseKey(accountId: string): Promise<string>;
  openDatabase(accountId: string, encryptionKey: string): ClosableSqlDatabase;
  migrateDatabase(database: SqlDatabase): Promise<void>;
  initializeDeviceIdentities(
    accountId: string,
    database: SqlDatabase,
  ): Promise<void>;
  purgeDeniedRoots(accountId: string, database: SqlDatabase): Promise<void>;
  purgePrivateData(accountId: string, database: SqlDatabase): Promise<void>;
  listRetainedFileKeysForPurge(
    accountId: string,
    database: SqlDatabase,
  ): Promise<readonly string[]>;
  purgeRetainedFiles(
    accountId: string,
    retainedFileKeys: readonly string[],
  ): Promise<void>;
  quiesceAttachmentMedia(accountId: string): Promise<void>;
  reconcileAttachments(accountId: string, database: SqlDatabase): Promise<void>;
  resumeAttachmentMedia(accountId: string): void;
  clearPrivateState(accountId: string): Promise<void> | void;
};

type PrivateBootstrapResult =
  | { status: 'signedOut' }
  | {
      status: 'unavailable';
      accountId: string | null;
      reason: PrivateUnavailableReason;
    }
  | {
      status: 'ready';
      accountId: string;
      database: ClosableSqlDatabase;
    };

type PrivateDatabaseContextValue = {
  accountId: string;
  database: ClosableSqlDatabase;
};

const PrivateDatabaseContext =
  createContext<PrivateDatabaseContextValue | null>(null);

type PrivateSessionLifecycleContextValue = {
  status: PrivateNavigationStatus;
  accountId: string | null;
  unavailableReason: PrivateUnavailableReason | null;
  continueSignedOut(): Promise<void>;
  replaceSession(
    session: Session | null,
    expectedCurrentAccountId?: string,
  ): Promise<void>;
  reloadSession(): Promise<void>;
};

const PrivateSessionLifecycleContext =
  createContext<PrivateSessionLifecycleContextValue | null>(null);

const defaultDependencies: PrivateBootstrapDependencies = {
  sessionStore: secureSessionStore,
  getDatabaseKey: getOrCreateDatabaseKey,
  openDatabase: openAccountDatabase,
  migrateDatabase: migrate,
  initializeDeviceIdentities(accountId, database) {
    return secureDeviceIdStore.initializeExisting(database, accountId);
  },
  purgeDeniedRoots(accountId, database) {
    return deniedRootRegistry.purgeRecorded(accountId, database);
  },
  purgePrivateData(accountId, database) {
    return new MobileDataStore(database).clearUserData(accountId);
  },
  async listRetainedFileKeysForPurge(accountId, database) {
    const [attachments, feedbackScreenshots] = await Promise.all([
      new LocalAttachmentStore(database).listRetainedFileKeys(accountId),
      listFeedbackScreenshotFileKeysForPurge(database, accountId),
    ]);
    return [...attachments, ...feedbackScreenshots];
  },
  purgeRetainedFiles(accountId, retainedFileKeys) {
    return purgeRetainedAttachmentFiles(accountId, retainedFileKeys);
  },
  quiesceAttachmentMedia,
  reconcileAttachments(accountId, database) {
    return reconcileRetainedAttachmentFiles(
      new LocalAttachmentStore(database),
      accountId,
    );
  },
  resumeAttachmentMedia,
  clearPrivateState(accountId) {
    queryClient.removeQueries({ queryKey: ['private', accountId] });
  },
};

export async function bootstrapPrivateDatabase(
  dependencies: PrivateBootstrapDependencies,
): Promise<PrivateBootstrapResult> {
  let session: Session | null;
  try {
    session = await dependencies.sessionStore.get();
  } catch {
    return unavailable('secureStorage');
  }
  if (!session) return { status: 'signedOut' };

  const accountId = session.user.id;
  let key: string;
  try {
    key = await dependencies.getDatabaseKey(accountId);
  } catch (error) {
    return unavailable(
      isDatabaseKeyStorageUnavailable(error) ? 'secureStorage' : 'privateData',
      accountId,
    );
  }

  let database: ClosableSqlDatabase | undefined;
  try {
    database = dependencies.openDatabase(accountId, key);
    await dependencies.migrateDatabase(database);
    await dependencies.initializeDeviceIdentities(accountId, database);
    await dependencies.purgeDeniedRoots(accountId, database);
    await dependencies.reconcileAttachments(accountId, database);
    dependencies.resumeAttachmentMedia(accountId);
    return { status: 'ready', accountId, database };
  } catch {
    if (database) await closeQuietly(database);
    return unavailable('privateData', accountId);
  }
}

type PrivateBootstrapGateProps = {
  children(status: PrivateNavigationStatus): ReactNode;
  dependencies?: PrivateBootstrapDependencies;
};

export function PrivateBootstrapGate({
  children,
  dependencies = defaultDependencies,
}: PrivateBootstrapGateProps) {
  const [result, setResult] = useState<
    PrivateBootstrapResult | { status: 'loading' }
  >({ status: 'loading' });
  const resultRef = useRef(result);
  const mountedRef = useRef(true);
  const transitionTailRef = useRef<Promise<void>>(Promise.resolve());

  const publish = useCallback(
    (next: typeof result) => {
      if (!mountedRef.current) {
        if (next.status === 'ready') {
          ignore(
            dependencies
              .quiesceAttachmentMedia(next.accountId)
              .then(() => closeQuietly(next.database))
              .then(() => dependencies.clearPrivateState(next.accountId)),
          );
        }
        return;
      }
      resultRef.current = next;
      setResult(next);
    },
    [dependencies],
  );

  const concealAndClose = useCallback(
    async (purgeFeedback: boolean, expectedAccountId?: string) => {
      const previous = resultRef.current;
      if (
        purgeFeedback &&
        (previous.status !== 'ready' ||
          previous.accountId !== expectedAccountId)
      ) {
        throw new Error('Private logout state changed');
      }
      publish({ status: 'loading' });
      if (previous.status !== 'ready') return;
      await dependencies.quiesceAttachmentMedia(previous.accountId);
      if (!purgeFeedback) {
        await closeQuietly(previous.database);
        await dependencies.clearPrivateState(previous.accountId);
        return;
      }

      let failed = false;
      try {
        const retainedFileKeys =
          await dependencies.listRetainedFileKeysForPurge(
            previous.accountId,
            previous.database,
          );
        await dependencies.purgeRetainedFiles(
          previous.accountId,
          retainedFileKeys,
        );
        await dependencies.purgePrivateData(
          previous.accountId,
          previous.database,
        );
      } catch {
        failed = true;
      }
      try {
        await previous.database.close();
      } catch {
        failed = true;
      }
      try {
        await dependencies.clearPrivateState(previous.accountId);
      } catch {
        failed = true;
      }
      if (failed) throw new Error('Private logout failed');
    },
    [dependencies, publish],
  );

  const enqueue = useCallback((transition: () => Promise<void>) => {
    const resultPromise = transitionTailRef.current.then(
      transition,
      transition,
    );
    transitionTailRef.current = resultPromise.then(
      () => undefined,
      () => undefined,
    );
    return resultPromise;
  }, []);

  const reloadSession = useCallback(
    () =>
      enqueue(async () => {
        const previous = resultRef.current;
        try {
          await concealAndClose(false);
          publish(await bootstrapPrivateDatabase(dependencies));
        } catch {
          publish(
            unavailable(
              'privateData',
              previous.status === 'ready' || previous.status === 'unavailable'
                ? previous.accountId
                : undefined,
            ),
          );
        }
      }),
    [concealAndClose, dependencies, enqueue, publish],
  );

  const replaceSession = useCallback(
    (replacement: Session | null, expectedCurrentAccountId?: string) =>
      enqueue(async () => {
        let newerAccountIsReady = false;
        const previous = resultRef.current;
        const recoveryAccountId =
          previous.status === 'ready' || previous.status === 'unavailable'
            ? previous.accountId
            : null;
        try {
          const expected = await dependencies.sessionStore.get();
          const current = resultRef.current;
          if (
            replacement === null &&
            expectedCurrentAccountId !== undefined &&
            (expected?.user.id !== expectedCurrentAccountId ||
              current.status !== 'ready' ||
              current.accountId !== expectedCurrentAccountId)
          ) {
            newerAccountIsReady =
              expected !== null &&
              current.status === 'ready' &&
              expected.user.id === current.accountId &&
              current.accountId !== expectedCurrentAccountId;
            throw new Error('Session changed');
          }
          if (replacement === null && !expected) {
            throw new Error('Session changed');
          }
          await concealAndClose(
            replacement === null,
            replacement === null
              ? expectedCurrentAccountId ?? expected?.user.id
              : undefined,
          );
          const replaced = await dependencies.sessionStore.compareAndSet(
            expected,
            replacement,
          );
          if (!replaced) throw new Error('Session changed');
          const next = await bootstrapPrivateDatabase(dependencies);
          publish(next);
          if (replacement && next.status !== 'ready') {
            throw new Error('Private bootstrap failed');
          }
        } catch {
          if (newerAccountIsReady) {
            throw new Error('Session replacement failed');
          }
          try {
            await concealAndClose(false);
          } catch {
            // The transition already failed; cleanup remains best-effort here.
          }
          publish(unavailable('privateData', recoveryAccountId));
          throw new Error('Session replacement failed');
        }
      }),
    [concealAndClose, dependencies, enqueue, publish],
  );

  const continueSignedOut = useCallback(
    () =>
      enqueue(async () => {
        const failed = resultRef.current;
        if (failed.status !== 'unavailable') {
          throw new Error('Private recovery state changed');
        }

        publish({ status: 'loading' });
        if (!failed.accountId) {
          // Identity is unknown, so touching protected storage could affect a
          // different account. Keep it intact and expose only signed-out UI.
          publish({ status: 'signedOut' });
          return;
        }

        let current: Session | null;
        try {
          current = await dependencies.sessionStore.get();
        } catch {
          publish(failed);
          throw new Error('Private recovery failed');
        }

        if (!current || current.user.id !== failed.accountId) {
          const next = await bootstrapPrivateDatabase(dependencies);
          publish(next);
          if (next.status === 'unavailable') {
            throw new Error('Private recovery failed');
          }
          return;
        }

        const replaced = await dependencies.sessionStore.compareAndSet(
          current,
          null,
        );
        if (!replaced) {
          const next = await bootstrapPrivateDatabase(dependencies);
          publish(next);
          if (next.status === 'unavailable') {
            throw new Error('Private recovery failed');
          }
          return;
        }

        try {
          await dependencies.clearPrivateState(failed.accountId);
        } catch {
          // The account-scoped in-memory cache is already concealed.
        }
        // Persistent private data cannot be opened safely here. Defer its
        // account-scoped cleanup; never broaden this into a blind purge.
        publish({ status: 'signedOut' });
      }),
    [dependencies, enqueue, publish],
  );

  useEffect(() => {
    mountedRef.current = true;
    ignore(reloadSession());

    return () => {
      mountedRef.current = false;
      const previous = resultRef.current;
      resultRef.current = { status: 'loading' };
      if (previous.status === 'ready') {
        ignore(
          dependencies
            .quiesceAttachmentMedia(previous.accountId)
            .then(() => closeQuietly(previous.database))
            .then(() => dependencies.clearPrivateState(previous.accountId)),
        );
      }
    };
  }, [dependencies, reloadSession]);

  const lifecycle = useMemo<PrivateSessionLifecycleContextValue>(
    () => ({
      status: result.status,
      accountId: result.status === 'ready' ? result.accountId : null,
      unavailableReason: result.status === 'unavailable' ? result.reason : null,
      continueSignedOut,
      replaceSession,
      reloadSession,
    }),
    [continueSignedOut, reloadSession, replaceSession, result],
  );

  return (
    <PrivateSessionLifecycleContext.Provider value={lifecycle}>
      <PrivateDatabaseContext.Provider
        value={
          result.status === 'ready'
            ? { accountId: result.accountId, database: result.database }
            : null
        }
      >
        {children(result.status)}
      </PrivateDatabaseContext.Provider>
    </PrivateSessionLifecycleContext.Provider>
  );
}

export function usePrivateDatabase(): PrivateDatabaseContextValue {
  const value = useContext(PrivateDatabaseContext);
  if (!value) throw new Error('Private database is unavailable');
  return value;
}

export function usePrivateSessionLifecycle(): PrivateSessionLifecycleContextValue {
  const value = useContext(PrivateSessionLifecycleContext);
  if (!value) throw new Error('Private session lifecycle is unavailable');
  return value;
}

async function closeQuietly(database: ClosableSqlDatabase) {
  try {
    await database.close();
  } catch {
    // The connection is already unusable; never expose key or session details.
  }
}

function unavailable(
  reason: PrivateUnavailableReason,
  accountId?: string | null,
): PrivateBootstrapResult {
  return { status: 'unavailable', accountId: accountId ?? null, reason };
}

function isDatabaseKeyStorageUnavailable(error: unknown) {
  return error instanceof DatabaseKeyStorageUnavailableError;
}

function ignore(promise: Promise<unknown>) {
  promise.catch(() => undefined);
}
