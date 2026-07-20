import { GatewayClientError } from '@crew/mobile-client';
import {
  CommunityFeedbackAccountChangedError,
  FeedbackSubmissionAccountChangedError,
  MobileSyncAccountChangedError,
  MobileSyncRootAccessDeniedError,
  type CommunityFeedbackSummary,
  type CommunityFeedbackUpdate,
} from '@crew/mobile-data';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isSessionFailure } from '../app/flowErrors';
import { useGatewayClient } from '../app/GatewayProvider';
import {
  usePrivateDatabase,
  usePrivateSessionLifecycle,
} from '../app/PrivateBootstrapGate';
import {
  CommunityFeedbackListView,
  type CommunityFeedbackListMode,
  type CommunityFeedbackListViewModel,
  type CommunityFeedbackStatusFilter,
} from './CommunityFeedbackListView';
import { CommunityFeedbackRuntime } from './CommunityFeedbackRuntime';
import { FeedbackComposeRuntime } from './FeedbackComposeRuntime';
import { useOnlineState } from './useOnlineState';

export type CommunityFeedbackListScreenProps = {
  onBack(): void;
  onCompose(): void;
  onComposeWithScreenshot(feedbackId: string): void;
  onOpenFeedback(feedbackId: string): void;
  rootEventId: string;
};

type ContentState = {
  items: readonly CommunityFeedbackSummary[];
  key: string;
  message: string | null;
  phase: CommunityFeedbackListViewModel['phase'];
  refreshing: boolean;
  updates: readonly CommunityFeedbackUpdate[];
};

export function CommunityFeedbackListScreen({
  onBack,
  onCompose,
  onComposeWithScreenshot,
  onOpenFeedback,
  rootEventId,
}: CommunityFeedbackListScreenProps) {
  const client = useGatewayClient();
  const privateDatabase = usePrivateDatabase();
  const lifecycle = usePrivateSessionLifecycle();
  const online = useOnlineState();
  const activeAccountRef = useRef(lifecycle.accountId);
  activeAccountRef.current = lifecycle.accountId;
  const scopeKey =
    lifecycle.status === 'ready' &&
    lifecycle.accountId === privateDatabase.accountId
      ? `${privateDatabase.accountId}:${rootEventId}`
      : null;
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const captureSourceKey = `${scopeKey ?? 'unavailable'}\u0000${rootEventId}`;
  const captureSourceKeyRef = useRef(captureSourceKey);
  captureSourceKeyRef.current = captureSourceKey;
  const mountedRef = useRef(true);
  const captureEpochRef = useRef(0);
  const captureFlightRef = useRef<{
    key: string;
    promise: Promise<void>;
  } | null>(null);
  const pendingCaptureRef = useRef<{
    feedbackId: string;
    handedOff: boolean;
    runtime: FeedbackComposeRuntime;
  } | null>(null);
  const [captureState, setCaptureState] = useState({
    busy: false,
    key: captureSourceKey,
    message: null as string | null,
  });
  const [mode, setMode] = useState<CommunityFeedbackListMode>('feedback');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<CommunityFeedbackStatusFilter>('all');
  const [followedOnly, setFollowedOnly] = useState(false);
  const [refreshRequest, setRefreshRequest] = useState(0);
  const [content, setContent] = useState<ContentState>({
    items: [],
    key: scopeKey ?? '',
    message: null,
    phase: 'loading',
    refreshing: false,
    updates: [],
  });
  const contentRef = useRef(content);
  contentRef.current = content;
  const runtime = useMemo(
    () =>
      client && scopeKey
        ? new CommunityFeedbackRuntime({
            activeAccountUserId: () => activeAccountRef.current,
            client,
            database: privateDatabase.database,
          })
        : null,
    [client, privateDatabase.database, scopeKey],
  );
  const composeRuntime = useMemo(
    () =>
      scopeKey
        ? new FeedbackComposeRuntime({
            accountUserId: privateDatabase.accountId,
            activeAccountUserId: () => activeAccountRef.current,
            client,
            database: privateDatabase.database,
          })
        : null,
    [client, privateDatabase.accountId, privateDatabase.database, scopeKey],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(
    () => () => {
      captureEpochRef.current += 1;
      if (captureFlightRef.current?.key === captureSourceKey) {
        captureFlightRef.current = null;
      }
      const pending = pendingCaptureRef.current;
      pendingCaptureRef.current = null;
      if (pending && !pending.handedOff) {
        pending.runtime.cleanup(pending.feedbackId).catch(() => undefined);
      }
    },
    [captureSourceKey],
  );

  const publish = useCallback(
    (next: ContentState) => {
      if (!scopeKey || next.key !== scopeKey) return;
      if (scopeRef.current !== scopeKey) return;
      if (activeAccountRef.current !== privateDatabase.accountId) return;
      contentRef.current = next;
      setContent(next);
    },
    [privateDatabase.accountId, scopeKey],
  );

  useEffect(() => {
    if (!scopeKey || !runtime) {
      setContent({
        items: [],
        key: scopeKey ?? '',
        message: 'Dieser Inhalt ist nicht verfügbar.',
        phase: 'unavailable',
        refreshing: false,
        updates: [],
      });
      return;
    }
    let cancelled = false;
    const accountUserId = privateDatabase.accountId;
    const previous =
      contentRef.current.key === scopeKey ? contentRef.current : null;
    publish({
      items: previous?.items ?? [],
      key: scopeKey,
      message: previous?.message ?? null,
      phase: previous?.phase === 'ready' ? 'ready' : 'loading',
      refreshing: previous?.phase === 'ready',
      updates: previous?.updates ?? [],
    });

    const load = async () => {
      let hasMembership = false;
      let items: readonly CommunityFeedbackSummary[] = previous?.items ?? [];
      let updates: readonly CommunityFeedbackUpdate[] = previous?.updates ?? [];
      try {
        hasMembership = await runtime.hasCachedMembership(
          accountUserId,
          rootEventId,
        );
        if (!hasMembership) {
          publish(unavailableState(scopeKey));
          return;
        }
        [items, updates] = await Promise.all([
          runtime.controller.list(rootEventId),
          runtime.controller.changelog(rootEventId),
        ]);
        if (cancelled) return;
        publish({
          items,
          key: scopeKey,
          message: online
            ? null
            : 'Offline. Du siehst den sicher gespeicherten Stand.',
          phase: 'ready',
          refreshing: online,
          updates,
        });
      } catch (error) {
        if (handleSessionError(error, lifecycle.reloadSession)) return;
        if (!hasMembership) {
          publish(unavailableState(scopeKey));
          return;
        }
        publish({
          items,
          key: scopeKey,
          message:
            'Gespeicherte Meldungen konnten nicht gelesen werden. Versuche es erneut.',
          phase: 'ready',
          refreshing: false,
          updates,
        });
      }

      if (!online || cancelled) return;
      try {
        await runtime.verifyRoot(accountUserId, rootEventId);
        if (cancelled) return;
        if (!(await runtime.hasCachedMembership(accountUserId, rootEventId))) {
          publish(unavailableState(scopeKey));
          return;
        }
        const refresh = await refreshCommunityFeedback(runtime, rootEventId);
        if (cancelled) return;
        [items, updates] = await Promise.all([
          runtime.controller.list(rootEventId),
          runtime.controller.changelog(rootEventId),
        ]);
        if (cancelled) return;
        publish({
          items,
          key: scopeKey,
          message: refresh.partial
            ? 'Die neuesten 200 Einträge sind geladen. Weitere ältere Einträge sind in dieser Ansicht noch nicht verfügbar.'
            : null,
          phase: 'ready',
          refreshing: false,
          updates,
        });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof MobileSyncRootAccessDeniedError) {
          publish(unavailableState(scopeKey));
          return;
        }
        if (handleSessionError(error, lifecycle.reloadSession)) return;
        if (isRawCommunityBoundary(error)) {
          let rootConfirmed = false;
          try {
            await runtime.verifyRoot(accountUserId, rootEventId, true);
            if (
              !(await runtime.hasCachedMembership(accountUserId, rootEventId))
            ) {
              publish(unavailableState(scopeKey));
              return;
            }
            rootConfirmed = true;
          } catch (verificationError) {
            if (verificationError instanceof MobileSyncRootAccessDeniedError) {
              publish(unavailableState(scopeKey));
              return;
            }
            if (
              handleSessionError(verificationError, lifecycle.reloadSession)
            ) {
              return;
            }
          }
          publish({
            items,
            key: scopeKey,
            message: rootConfirmed
              ? 'Eventzugriff bestätigt, aber Feedback konnte nicht aktualisiert werden. Der gespeicherte Stand bleibt sichtbar.'
              : 'Feedback konnte nicht aktualisiert werden. Der gespeicherte Stand bleibt sichtbar.',
            phase: 'ready',
            refreshing: false,
            updates,
          });
          return;
        }
        publish({
          items,
          key: scopeKey,
          message:
            'Aktualisierung nicht möglich. Der gespeicherte Stand bleibt sichtbar.',
          phase: 'ready',
          refreshing: false,
          updates,
        });
      }
    };
    load().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [
    lifecycle.reloadSession,
    online,
    privateDatabase.accountId,
    publish,
    refreshRequest,
    rootEventId,
    runtime,
    scopeKey,
  ]);

  const viewModel = useMemo<CommunityFeedbackListViewModel>(() => {
    const scoped = Boolean(scopeKey && content.key === scopeKey);
    return {
      followedOnly,
      items: scoped
        ? filterFeedback(content.items, status, followedOnly, query)
        : [],
      message: scoped
        ? content.message
        : scopeKey
        ? null
        : 'Dieser Inhalt ist nicht verfügbar.',
      mode,
      online,
      phase: scoped ? content.phase : scopeKey ? 'loading' : 'unavailable',
      query,
      refreshing: scoped && content.refreshing,
      status,
      updates: scoped ? content.updates : [],
    };
  }, [content, followedOnly, mode, online, query, scopeKey, status]);

  const openTextCompose = useCallback(() => {
    captureEpochRef.current += 1;
    if (captureFlightRef.current?.key === captureSourceKey) {
      captureFlightRef.current = null;
    }
    const pending = pendingCaptureRef.current;
    pendingCaptureRef.current = null;
    if (pending && !pending.handedOff) {
      pending.runtime.cleanup(pending.feedbackId).catch(() => undefined);
    }
    setCaptureState({
      busy: false,
      key: captureSourceKey,
      message: null,
    });
    onCompose();
  }, [captureSourceKey, onCompose]);

  const openScreenshotCompose = useCallback((): Promise<void> => {
    const existing = captureFlightRef.current;
    if (existing?.key === captureSourceKey) return existing.promise;
    if (!composeRuntime || !scopeKey) {
      setCaptureState({
        busy: false,
        key: captureSourceKey,
        message: screenshotCaptureFailure,
      });
      return Promise.resolve();
    }

    const expectedEpoch = captureEpochRef.current;
    const expectedSourceKey = captureSourceKey;
    setCaptureState({ busy: true, key: expectedSourceKey, message: null });

    const isCurrent = () =>
      mountedRef.current &&
      captureEpochRef.current === expectedEpoch &&
      captureSourceKeyRef.current === expectedSourceKey &&
      activeAccountRef.current === privateDatabase.accountId;

    const run = async () => {
      try {
        const screenshot = await composeRuntime.capture(rootEventId);
        if (!isCurrent()) {
          await composeRuntime.cleanup(screenshot.feedbackId);
          return;
        }

        const pending = {
          feedbackId: screenshot.feedbackId,
          handedOff: false,
          runtime: composeRuntime,
        };
        pendingCaptureRef.current = pending;
        pending.handedOff = true;
        try {
          onComposeWithScreenshot(screenshot.feedbackId);
          if (pendingCaptureRef.current === pending) {
            pendingCaptureRef.current = null;
          }
        } catch {
          pending.handedOff = false;
          if (pendingCaptureRef.current === pending) {
            pendingCaptureRef.current = null;
          }
          await composeRuntime.cleanup(screenshot.feedbackId);
          if (isCurrent()) {
            setCaptureState({
              busy: false,
              key: expectedSourceKey,
              message: screenshotCaptureFailure,
            });
          }
        }
      } catch (error) {
        if (!isCurrent()) return;
        if (handleSessionError(error, lifecycle.reloadSession)) return;
        setCaptureState({
          busy: false,
          key: expectedSourceKey,
          message: screenshotCaptureFailure,
        });
      }
    };
    let flight: Promise<void>;
    flight = run().finally(() => {
      if (captureFlightRef.current?.promise === flight) {
        captureFlightRef.current = null;
      }
      if (!isCurrent()) return;
      setCaptureState(current =>
        current.key === expectedSourceKey
          ? { ...current, busy: false }
          : current,
      );
    });
    captureFlightRef.current = { key: expectedSourceKey, promise: flight };
    return flight;
  }, [
    captureSourceKey,
    composeRuntime,
    lifecycle.reloadSession,
    onComposeWithScreenshot,
    privateDatabase.accountId,
    rootEventId,
    scopeKey,
  ]);

  const scopedCaptureState =
    captureState.key === captureSourceKey
      ? captureState
      : { busy: false, message: null };

  return (
    <CommunityFeedbackListView
      model={viewModel}
      onBack={onBack}
      onCompose={openTextCompose}
      onComposeWithScreenshot={openScreenshotCompose}
      onFollowedOnlyChange={setFollowedOnly}
      onModeChange={setMode}
      onOpenFeedback={onOpenFeedback}
      onQueryChange={setQuery}
      onRefresh={() => setRefreshRequest(value => value + 1)}
      onStatusChange={setStatus}
      screenshotCaptureBusy={scopedCaptureState.busy}
      screenshotCaptureMessage={scopedCaptureState.message}
    />
  );
}

export async function refreshCommunityFeedback(
  runtime: Pick<CommunityFeedbackRuntime, 'controller'>,
  rootEventId: string,
): Promise<{ partial: boolean }> {
  const results = await Promise.all([
    refreshPages(cursor =>
      runtime.controller.refreshList(rootEventId, { cursor, limit: 50 }),
    ),
    refreshPages(cursor =>
      runtime.controller.refreshUpdates(rootEventId, { cursor, limit: 50 }),
    ),
  ]);
  return { partial: results.some(Boolean) };
}

async function refreshPages(
  refresh: (cursor?: string) => Promise<{
    pageInfo: { hasMore: boolean; nextCursor?: string | null };
  }>,
): Promise<boolean> {
  let cursor: string | undefined;
  const seen = new Set<string>();
  for (let pageNumber = 0; pageNumber < 4; pageNumber += 1) {
    const page = await refresh(cursor);
    const next = page.pageInfo.nextCursor ?? undefined;
    if (!page.pageInfo.hasMore) return false;
    if (!next || seen.has(next)) return true;
    seen.add(next);
    cursor = next;
  }
  return true;
}

export function filterFeedback(
  items: readonly CommunityFeedbackSummary[],
  status: CommunityFeedbackStatusFilter,
  followedOnly: boolean,
  query: string,
): readonly CommunityFeedbackSummary[] {
  const needle = query.trim().toLocaleLowerCase('de-CH');
  return items
    .filter(item => status === 'all' || item.status === status)
    .filter(item => !followedOnly || item.followed)
    .filter(
      item =>
        !needle ||
        item.title.toLocaleLowerCase('de-CH').includes(needle) ||
        item.body.toLocaleLowerCase('de-CH').includes(needle),
    );
}

function unavailableState(key: string): ContentState {
  return {
    items: [],
    key,
    message: 'Dieser Inhalt ist nicht verfügbar.',
    phase: 'unavailable',
    refreshing: false,
    updates: [],
  };
}

function handleSessionError(
  error: unknown,
  reloadSession: () => Promise<void>,
): boolean {
  if (
    error instanceof CommunityFeedbackAccountChangedError ||
    error instanceof FeedbackSubmissionAccountChangedError ||
    error instanceof MobileSyncAccountChangedError ||
    isSessionFailure(error)
  ) {
    reloadSession().catch(() => undefined);
    return true;
  }
  return false;
}

const screenshotCaptureFailure =
  'Screenshot konnte nicht hinzugefügt werden. Du kannst weiterhin Text-Feedback geben.';

function isRawCommunityBoundary(error: unknown): boolean {
  return (
    error instanceof GatewayClientError &&
    (error.status === 403 || error.status === 404)
  );
}
