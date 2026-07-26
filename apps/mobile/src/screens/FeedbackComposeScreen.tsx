import {
  FeedbackDuplicateSuggestionAccountChangedError,
  FeedbackSubmissionAccountChangedError,
  FeedbackSubmissionAuthenticationError,
  normalizeFeedbackDuplicateQuery,
  type FeedbackSubmissionDiagnostics,
  type FeedbackSubmissionFailure,
  type FeedbackSubmissionReceipt,
} from '@crew/mobile-data';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGatewayClient } from '../app/GatewayProvider';
import {
  usePrivateDatabase,
  usePrivateSessionLifecycle,
} from '../app/PrivateBootstrapGate';
import { runtimeFeedbackDiagnostics } from '../app/runtimeConfig';
import { runAttachmentMediaOperation } from '../media/attachmentMedia';
import { secureUuidV4 } from '../storage/secureRandom';
import {
  FeedbackComposeRuntime,
  type FeedbackComposeScreenshot,
} from './FeedbackComposeRuntime';
import {
  FeedbackComposeView,
  type FeedbackDuplicateSuggestionsViewState,
  type FeedbackDiagnosticsPreview,
  type FeedbackComposeViewState,
  type FeedbackComposeVisibility,
} from './FeedbackComposeView';
import { useOnlineState } from './useOnlineState';

export type FeedbackComposeSource = {
  eventId?: string | null;
  feedbackId?: string | null;
  rootEventId?: string | null;
  screenKey: string;
  sourceLabel: string;
};

export type FeedbackComposeScreenProps = {
  availableDiagnostics?: FeedbackSubmissionDiagnostics | null;
  onOpenDuplicateSuggestion?(feedbackId: string): void;
  onReturn(): void;
  source: FeedbackComposeSource;
};

export function FeedbackComposeScreen({
  availableDiagnostics = null,
  onOpenDuplicateSuggestion,
  onReturn,
  source,
}: FeedbackComposeScreenProps) {
  const client = useGatewayClient();
  const privateDatabase = usePrivateDatabase();
  const lifecycle = usePrivateSessionLifecycle();
  const online = useOnlineState();
  const safeSource = useMemo(() => safeFeedbackSource(source), [source]);
  const activeAccountRef = useRef(lifecycle.accountId);
  activeAccountRef.current = lifecycle.accountId;
  const scopeKey =
    lifecycle.status === 'ready' &&
    lifecycle.accountId === privateDatabase.accountId
      ? privateDatabase.accountId
      : null;
  const canShareWithEvent = Boolean(safeSource.rootEventId);
  const boundedDiagnostics = useMemo(
    () => runtimeFeedbackDiagnostics(availableDiagnostics),
    [availableDiagnostics],
  );
  const contextCategory = canShareWithEvent
    ? eventContextCategory
    : appContextCategory;
  const diagnosticsPreview = useMemo(
    () =>
      boundedDiagnostics
        ? {
            appVersion: boundedDiagnostics.appVersion,
            buildNumber: boundedDiagnostics.buildNumber,
            contextCategory: contextCategory.label,
            platform: boundedDiagnostics.platform === 'ios' ? 'iOS' : 'Android',
          }
        : null,
    [boundedDiagnostics, contextCategory.label],
  );
  const sourceBindingKey = [
    scopeKey ?? 'unavailable',
    safeSource.rootEventId ?? '',
    safeSource.eventId ?? '',
    safeSource.feedbackId ?? '',
    safeSource.screenKey,
  ].join('\u0000');
  const activeSourceBindingRef = useRef(sourceBindingKey);
  activeSourceBindingRef.current = sourceBindingKey;
  const consentResetKey = [
    sourceBindingKey,
    safeSource.sourceLabel,
    boundedDiagnostics?.appVersion ?? '',
    boundedDiagnostics?.buildNumber ?? '',
    boundedDiagnostics?.platform ?? '',
  ].join('\u0000');
  const sourceBindingKeyRef = useRef(sourceBindingKey);
  const consentResetKeyRef = useRef(consentResetKey);
  const [state, setState] = useState<FeedbackComposeViewState>(() =>
    editingState(
      safeSource.sourceLabel,
      online,
      canShareWithEvent,
      diagnosticsPreview,
      Boolean(safeSource.feedbackId && safeSource.rootEventId),
    ),
  );
  const [duplicateSuggestions, setDuplicateSuggestions] =
    useState<FeedbackDuplicateSuggestionsViewState>({ kind: 'idle' });
  const [duplicateSuggestionRetry, setDuplicateSuggestionRetry] = useState(0);
  const stateRef = useRef(state);
  const mountedRef = useRef(true);
  const submissionFlightRef = useRef<Promise<void> | null>(null);
  const screenshotActionFlightRef = useRef<Promise<boolean> | null>(null);
  const feedbackIdRef = useRef<string | null>(null);
  const screenshotRef = useRef<FeedbackComposeScreenshot | null>(null);
  const pendingScreenshotRef = useRef<{
    feedbackId: string;
    owned: boolean;
    runtime: FeedbackComposeRuntime;
  } | null>(null);
  const duplicateSearchSequenceRef = useRef(0);
  const runtime = useMemo(
    () =>
      scopeKey
        ? new FeedbackComposeRuntime({
            accountUserId: privateDatabase.accountId,
            activeAccountUserId: () => activeAccountRef.current,
            client,
            database: privateDatabase.database,
            randomUUID: secureUuidV4,
          })
        : null,
    [client, privateDatabase.accountId, privateDatabase.database, scopeKey],
  );
  const controller = runtime?.controller ?? null;

  const publish = useCallback(
    (next: FeedbackComposeViewState) => {
      if (!mountedRef.current) return;
      if (scopeKey && activeAccountRef.current !== scopeKey) return;
      stateRef.current = next;
      setState(next);
    },
    [scopeKey],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      deferPendingScreenshotCleanup(
        pendingScreenshotRef,
        submissionFlightRef.current,
      );
    };
  }, []);

  useEffect(() => {
    const current = stateRef.current;
    const sourceBindingChanged =
      sourceBindingKeyRef.current !== sourceBindingKey;
    const shouldResetConsent = consentResetKeyRef.current !== consentResetKey;
    sourceBindingKeyRef.current = sourceBindingKey;
    consentResetKeyRef.current = consentResetKey;
    if (sourceBindingChanged) {
      deferPendingScreenshotCleanup(
        pendingScreenshotRef,
        submissionFlightRef.current,
      );
      submissionFlightRef.current = null;
      feedbackIdRef.current = null;
      screenshotRef.current = null;
    }
    if (!scopeKey) {
      publish({ kind: 'unavailable' });
      return;
    }
    if (sourceBindingChanged || current.kind === 'unavailable') {
      publish(
        editingState(
          safeSource.sourceLabel,
          online,
          canShareWithEvent,
          diagnosticsPreview,
          Boolean(safeSource.feedbackId && safeSource.rootEventId),
        ),
      );
      return;
    }
    if (current.kind === 'editing') {
      publish({
        ...current,
        canShareWithEvent,
        diagnosticsConsented: shouldResetConsent
          ? false
          : current.diagnosticsConsented,
        diagnosticsPreview,
        online,
        sourceLabel: safeSource.sourceLabel,
        visibility: canShareWithEvent ? current.visibility : 'private',
      });
    } else if (current.kind === 'receipt') {
      publish({ ...current, online });
    }
  }, [
    canShareWithEvent,
    consentResetKey,
    diagnosticsPreview,
    online,
    publish,
    scopeKey,
    sourceBindingKey,
    safeSource.feedbackId,
    safeSource.rootEventId,
    safeSource.sourceLabel,
  ]);

  useEffect(() => {
    if (
      !runtime ||
      !scopeKey ||
      !safeSource.feedbackId ||
      !safeSource.rootEventId
    ) {
      return;
    }
    let cancelled = false;
    const expectedSourceBindingKey = sourceBindingKey;
    const feedbackId = safeSource.feedbackId;
    runtime
      .restore(feedbackId, safeSource.rootEventId)
      .then(screenshot => {
        if (
          cancelled ||
          activeSourceBindingRef.current !== expectedSourceBindingKey
        ) {
          if (screenshot) runtime.cleanup(feedbackId).catch(() => undefined);
          return;
        }
        const current = stateRef.current;
        if (current.kind !== 'editing') return;
        if (!screenshot) {
          publish({
            ...current,
            screenshot: { kind: 'unavailable' },
          });
          return;
        }
        feedbackIdRef.current = screenshot.feedbackId;
        screenshotRef.current = screenshot;
        pendingScreenshotRef.current = {
          feedbackId: screenshot.feedbackId,
          owned: false,
          runtime,
        };
        publish({
          ...current,
          screenshot: {
            busy: false,
            consented: false,
            kind: 'preview',
            previewDataUri: screenshot.previewDataUri,
          },
        });
      })
      .catch(() => {
        if (
          cancelled ||
          activeSourceBindingRef.current !== expectedSourceBindingKey
        ) {
          runtime.cleanup(feedbackId).catch(() => undefined);
          return;
        }
        feedbackIdRef.current = null;
        screenshotRef.current = null;
        pendingScreenshotRef.current = null;
        const current = stateRef.current;
        if (current.kind === 'editing') {
          publish({
            ...current,
            screenshot: { kind: 'unavailable' },
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    publish,
    runtime,
    scopeKey,
    safeSource.feedbackId,
    safeSource.rootEventId,
    sourceBindingKey,
  ]);

  const duplicateSearchTitle = state.kind === 'editing' ? state.title : '';
  const duplicateSearchBody = state.kind === 'editing' ? state.body : '';
  const duplicateSearchVisibility =
    state.kind === 'editing' ? state.visibility : 'private';
  const duplicateSearchSubmitting =
    state.kind !== 'editing' || state.submitting;

  useEffect(() => {
    const sequence = ++duplicateSearchSequenceRef.current;
    const rootEventId = safeSource.rootEventId;
    const query = normalizeFeedbackDuplicateQuery(
      duplicateSearchTitle,
      duplicateSearchBody,
    );
    if (
      !runtime ||
      !scopeKey ||
      !rootEventId ||
      !onOpenDuplicateSuggestion ||
      duplicateSearchSubmitting ||
      duplicateSearchVisibility !== 'event' ||
      !query
    ) {
      setDuplicateSuggestions({ kind: 'idle' });
      return;
    }

    const expectedSourceBindingKey = sourceBindingKey;
    const abortController = new AbortController();
    setDuplicateSuggestions({ kind: 'searching' });
    const timer = setTimeout(() => {
      runtime.duplicateSuggestions
        .search(scopeKey, rootEventId, query, online, abortController.signal)
        .then(result => {
          if (
            !mountedRef.current ||
            duplicateSearchSequenceRef.current !== sequence ||
            activeSourceBindingRef.current !== expectedSourceBindingKey ||
            activeAccountRef.current !== scopeKey
          ) {
            return;
          }
          if (result.items.length > 0) {
            setDuplicateSuggestions({
              items: result.items,
              kind: 'ready',
              source: result.source,
            });
          } else {
            setDuplicateSuggestions(
              result.source === 'cache'
                ? { kind: 'skipped' }
                : { kind: 'idle' },
            );
          }
        })
        .catch(error => {
          if (
            !mountedRef.current ||
            duplicateSearchSequenceRef.current !== sequence ||
            activeSourceBindingRef.current !== expectedSourceBindingKey ||
            activeAccountRef.current !== scopeKey ||
            abortController.signal.aborted
          ) {
            return;
          }
          if (error instanceof FeedbackDuplicateSuggestionAccountChangedError) {
            lifecycle.reloadSession().catch(() => undefined);
          }
          setDuplicateSuggestions({ kind: 'error' });
        });
    }, 450);

    return () => {
      clearTimeout(timer);
      abortController.abort();
    };
  }, [
    duplicateSearchBody,
    duplicateSearchTitle,
    duplicateSearchSubmitting,
    duplicateSearchVisibility,
    duplicateSuggestionRetry,
    lifecycle,
    onOpenDuplicateSuggestion,
    online,
    runtime,
    safeSource.rootEventId,
    scopeKey,
    sourceBindingKey,
  ]);

  const showReceipt = useCallback(
    async (
      receipt: FeedbackSubmissionReceipt,
      retrying = false,
      expectedSourceBindingKey = sourceBindingKey,
    ) => {
      if (activeSourceBindingRef.current !== expectedSourceBindingKey) return;
      const canSendWithoutScreenshot =
        receipt.state === 'attention' && runtime && screenshotRef.current
          ? await runtime
              .canSendWithoutScreenshot(receipt.feedbackId)
              .catch(() => false)
          : false;
      if (activeSourceBindingRef.current !== expectedSourceBindingKey) return;
      publish({
        canRetry: receipt.failure === 'auth_required',
        canSendWithoutScreenshot,
        deliveryState: receipt.state,
        failure: canSendWithoutScreenshot
          ? 'Der Screenshot konnte nicht zugestellt werden. Dein Text bleibt lokal gespeichert.'
          : failureCopy(receipt.failure),
        hasScreenshot: Boolean(screenshotRef.current),
        kind: 'receipt',
        online,
        retrying,
        title:
          stateRef.current.kind === 'editing'
            ? stateRef.current.title.trim()
            : stateRef.current.kind === 'receipt'
            ? stateRef.current.title
            : 'Dein Feedback',
      });
    },
    [online, publish, runtime, sourceBindingKey],
  );

  const drain = useCallback(
    (
      accountUserId: string,
      feedbackId: string,
      resume: boolean,
      expectedSourceBindingKey = sourceBindingKey,
    ) => {
      if (
        !controller ||
        activeSourceBindingRef.current !== expectedSourceBindingKey
      ) {
        return Promise.resolve();
      }
      const current = stateRef.current;
      if (current.kind === 'receipt') {
        publish({
          ...current,
          canRetry: false,
          deliveryState: 'sending',
          failure: null,
          retrying: resume,
        });
      }
      const delivery = runAttachmentMediaOperation(accountUserId, () =>
        resume
          ? controller.resumeAndDrain(accountUserId)
          : controller.drain(accountUserId),
      );
      return delivery
        .then(async receipts => {
          if (activeSourceBindingRef.current !== expectedSourceBindingKey) {
            return;
          }
          const receipt =
            receipts.find(item => item.feedbackId === feedbackId) ??
            (await controller.get(accountUserId, feedbackId));
          if (
            receipt &&
            activeSourceBindingRef.current === expectedSourceBindingKey
          ) {
            await showReceipt(receipt, false, expectedSourceBindingKey);
          }
        })
        .catch(async error => {
          if (
            error instanceof Error &&
            error.message === 'attachment_media_unavailable'
          ) {
            return;
          }
          if (activeSourceBindingRef.current !== expectedSourceBindingKey) {
            return;
          }
          if (
            error instanceof FeedbackSubmissionAccountChangedError ||
            error instanceof FeedbackSubmissionAuthenticationError
          ) {
            lifecycle.reloadSession().catch(() => undefined);
          }
          try {
            const receipt = await controller.get(accountUserId, feedbackId);
            if (
              receipt &&
              activeSourceBindingRef.current === expectedSourceBindingKey
            ) {
              await showReceipt(receipt, false, expectedSourceBindingKey);
            }
          } catch {
            // An account transition conceals the old account's receipt.
          }
        });
    },
    [controller, lifecycle, publish, showReceipt, sourceBindingKey],
  );

  const submit = useCallback(() => {
    if (screenshotActionFlightRef.current) {
      return screenshotActionFlightRef.current.then(() => undefined);
    }
    if (submissionFlightRef.current) return submissionFlightRef.current;
    const current = stateRef.current;
    if (!scopeKey || !controller || !runtime || current.kind !== 'editing') {
      return Promise.resolve();
    }
    const title = current.title.trim();
    const body = current.body.trim();
    const validation = validateDraft(title, body);
    if (validation) {
      publish({ ...current, error: validation, submitting: false });
      return Promise.resolve();
    }
    const screenshotChoice =
      current.screenshot.kind === 'preview' ? current.screenshot : null;
    const selectedScreenshot =
      screenshotChoice?.consented && screenshotRef.current
        ? screenshotRef.current
        : null;
    setDuplicateSuggestions({ kind: 'idle' });
    publish({
      ...current,
      error: null,
      screenshot: screenshotChoice
        ? { ...screenshotChoice, busy: true }
        : current.screenshot,
      submitting: true,
    });
    const accountUserId = scopeKey;
    const submittedSourceBindingKey = sourceBindingKey;
    const feedbackId =
      screenshotRef.current?.feedbackId ??
      feedbackIdRef.current ??
      `fbk_${secureUuidV4()}`;
    const visibility = feedbackVisibilityFor(
      current.visibility,
      canShareWithEvent,
    );
    const includeDiagnostics = Boolean(
      current.diagnosticsConsented && boundedDiagnostics,
    );
    const pendingScreenshot = pendingScreenshotRef.current;
    feedbackIdRef.current = feedbackId;
    const flight = (async () => {
      try {
        if (screenshotChoice && !selectedScreenshot) {
          await runtime.discard(feedbackId);
          if (activeSourceBindingRef.current !== submittedSourceBindingKey) {
            return;
          }
          screenshotRef.current = null;
          pendingScreenshotRef.current = null;
        }
        const receipt = await controller.enqueue(accountUserId, {
          ...(selectedScreenshot
            ? { attachmentId: selectedScreenshot.attachmentId }
            : {}),
          body,
          diagnostics: includeDiagnostics ? boundedDiagnostics : null,
          eventId: visibility === 'public' ? safeSource.eventId : null,
          id: feedbackId,
          rootEventId:
            visibility === 'public' || selectedScreenshot
              ? safeSource.rootEventId
              : null,
          screenKey: includeDiagnostics ? contextCategory.key : null,
          title,
          visibility,
        });
        if (
          selectedScreenshot &&
          pendingScreenshot?.feedbackId === feedbackId
        ) {
          pendingScreenshot.owned = true;
        }
        if (pendingScreenshotRef.current === pendingScreenshot) {
          pendingScreenshotRef.current = null;
        }
        if (activeSourceBindingRef.current !== submittedSourceBindingKey) {
          return;
        }
        await showReceipt(receipt, false, submittedSourceBindingKey);
        if (client && online) {
          drain(
            accountUserId,
            feedbackId,
            false,
            submittedSourceBindingKey,
          ).catch(() => undefined);
        }
      } catch (error) {
        if (activeSourceBindingRef.current !== submittedSourceBindingKey) {
          if (screenshotChoice && !selectedScreenshot) {
            runtime.cleanup(feedbackId).catch(() => undefined);
          }
          return;
        }
        if (
          error instanceof FeedbackSubmissionAccountChangedError ||
          error instanceof FeedbackSubmissionAuthenticationError
        ) {
          lifecycle.reloadSession().catch(() => undefined);
        }
        const latest = stateRef.current;
        if (latest.kind === 'editing') {
          publish({
            ...latest,
            error:
              'Feedback konnte nicht lokal gespeichert werden. Dein Text bleibt in diesem Formular.',
            screenshot:
              latest.screenshot.kind === 'preview'
                ? { ...latest.screenshot, busy: false }
                : latest.screenshot,
            submitting: false,
          });
        }
      }
    })().finally(() => {
      if (submissionFlightRef.current === flight) {
        submissionFlightRef.current = null;
      }
    });
    submissionFlightRef.current = flight;
    return flight;
  }, [
    boundedDiagnostics,
    canShareWithEvent,
    client,
    controller,
    contextCategory.key,
    drain,
    lifecycle,
    online,
    publish,
    runtime,
    scopeKey,
    showReceipt,
    safeSource.eventId,
    safeSource.rootEventId,
    sourceBindingKey,
  ]);

  const retry = useCallback(() => {
    if (submissionFlightRef.current) return submissionFlightRef.current;
    const feedbackId = feedbackIdRef.current;
    const current = stateRef.current;
    if (
      !scopeKey ||
      !client ||
      !online ||
      !feedbackId ||
      current.kind !== 'receipt' ||
      !current.canRetry ||
      current.canSendWithoutScreenshot
    ) {
      return Promise.resolve();
    }
    const flight = drain(scopeKey, feedbackId, true).finally(() => {
      if (submissionFlightRef.current === flight) {
        submissionFlightRef.current = null;
      }
    });
    submissionFlightRef.current = flight;
    return flight;
  }, [client, drain, online, scopeKey]);

  const discardScreenshot = useCallback((): Promise<boolean> => {
    if (screenshotActionFlightRef.current) {
      return screenshotActionFlightRef.current;
    }
    const current = stateRef.current;
    const screenshot = screenshotRef.current;
    if (
      !runtime ||
      !scopeKey ||
      current.kind !== 'editing' ||
      current.screenshot.kind !== 'preview' ||
      !screenshot ||
      current.submitting
    ) {
      return Promise.resolve(!screenshot);
    }
    const expectedSourceBindingKey = sourceBindingKey;
    publish({
      ...current,
      error: null,
      screenshot: { ...current.screenshot, busy: true },
    });
    const flight = runtime
      .discard(screenshot.feedbackId)
      .then(() => {
        if (activeSourceBindingRef.current !== expectedSourceBindingKey) {
          return false;
        }
        screenshotRef.current = null;
        pendingScreenshotRef.current = null;
        const latest = stateRef.current;
        if (latest.kind === 'editing') {
          publish({ ...latest, screenshot: { kind: 'none' } });
        }
        return true;
      })
      .catch(error => {
        if (
          error instanceof FeedbackSubmissionAccountChangedError ||
          error instanceof FeedbackSubmissionAuthenticationError
        ) {
          lifecycle.reloadSession().catch(() => undefined);
        }
        if (activeSourceBindingRef.current !== expectedSourceBindingKey) {
          return false;
        }
        const latest = stateRef.current;
        if (latest.kind === 'editing') {
          publish({
            ...latest,
            error:
              'Der Screenshot konnte nicht entfernt werden. Dein Text bleibt erhalten; versuche es erneut.',
            screenshot:
              latest.screenshot.kind === 'preview'
                ? { ...latest.screenshot, busy: false }
                : latest.screenshot,
          });
        }
        return false;
      })
      .finally(() => {
        if (screenshotActionFlightRef.current === flight) {
          screenshotActionFlightRef.current = null;
        }
      });
    screenshotActionFlightRef.current = flight;
    return flight;
  }, [lifecycle, publish, runtime, scopeKey, sourceBindingKey]);

  const returnToSource = useCallback(() => {
    const current = stateRef.current;
    if (current.kind === 'editing' && current.submitting) {
      return Promise.resolve();
    }
    if (current.kind === 'editing' && current.screenshot.kind === 'preview') {
      return discardScreenshot().then(discarded => {
        if (discarded) onReturn();
      });
    }
    onReturn();
    return Promise.resolve();
  }, [discardScreenshot, onReturn]);

  const sendWithoutScreenshot = useCallback(() => {
    if (submissionFlightRef.current) return submissionFlightRef.current;
    const current = stateRef.current;
    const feedbackId = feedbackIdRef.current;
    if (
      !runtime ||
      !scopeKey ||
      !feedbackId ||
      current.kind !== 'receipt' ||
      !current.canSendWithoutScreenshot
    ) {
      return Promise.resolve();
    }
    const expectedSourceBindingKey = sourceBindingKey;
    publish({ ...current, retrying: true });
    const flight = (async () => {
      try {
        const receipt = await runtime.sendWithoutScreenshot(feedbackId);
        if (activeSourceBindingRef.current !== expectedSourceBindingKey) return;
        screenshotRef.current = null;
        pendingScreenshotRef.current = null;
        await showReceipt(receipt, false, expectedSourceBindingKey);
        if (client && online) {
          drain(scopeKey, feedbackId, false, expectedSourceBindingKey).catch(
            () => undefined,
          );
        }
      } catch (error) {
        if (
          error instanceof FeedbackSubmissionAccountChangedError ||
          error instanceof FeedbackSubmissionAuthenticationError
        ) {
          lifecycle.reloadSession().catch(() => undefined);
        }
        if (activeSourceBindingRef.current !== expectedSourceBindingKey) return;
        const latest = stateRef.current;
        if (latest.kind === 'receipt') {
          publish({
            ...latest,
            failure:
              'Ohne Screenshot konnte die Zustellung noch nicht fortgesetzt werden. Dein Text bleibt lokal gespeichert.',
            retrying: false,
          });
        }
      }
    })().finally(() => {
      if (submissionFlightRef.current === flight) {
        submissionFlightRef.current = null;
      }
    });
    submissionFlightRef.current = flight;
    return flight;
  }, [
    client,
    drain,
    lifecycle,
    online,
    publish,
    runtime,
    scopeKey,
    showReceipt,
    sourceBindingKey,
  ]);

  const presentedState: FeedbackComposeViewState = !scopeKey
    ? { kind: 'unavailable' }
    : sourceBindingKeyRef.current === sourceBindingKey
    ? state
    : editingState(
        safeSource.sourceLabel,
        online,
        canShareWithEvent,
        diagnosticsPreview,
        Boolean(safeSource.feedbackId && safeSource.rootEventId),
      );
  const presentedDuplicateSuggestions: FeedbackDuplicateSuggestionsViewState =
    scopeKey && sourceBindingKeyRef.current === sourceBindingKey
      ? duplicateSuggestions
      : { kind: 'idle' };

  const openDuplicateSuggestion = useCallback(
    (feedbackId: string) => {
      const current = stateRef.current;
      if (
        current.kind !== 'editing' ||
        current.submitting ||
        !scopeKey ||
        !safeSource.rootEventId ||
        sourceBindingKeyRef.current !== sourceBindingKey ||
        !onOpenDuplicateSuggestion ||
        duplicateSuggestions.kind !== 'ready' ||
        !duplicateSuggestions.items.some(item => item.id === feedbackId)
      ) {
        return;
      }
      onOpenDuplicateSuggestion(feedbackId);
    },
    [
      duplicateSuggestions,
      onOpenDuplicateSuggestion,
      safeSource.rootEventId,
      scopeKey,
      sourceBindingKey,
    ],
  );

  return (
    <FeedbackComposeView
      duplicateSuggestions={presentedDuplicateSuggestions}
      onBodyChange={body => {
        setDuplicateSuggestions({ kind: 'idle' });
        updateEditing(publish, stateRef.current, { body });
      }}
      onDiagnosticsConsentChange={diagnosticsConsented =>
        updateEditing(publish, stateRef.current, {
          diagnosticsConsented:
            diagnosticsConsented &&
            stateRef.current.kind === 'editing' &&
            stateRef.current.diagnosticsPreview !== null,
        })
      }
      onOpenDuplicateSuggestion={openDuplicateSuggestion}
      onReturn={returnToSource}
      onRetry={retry}
      onRetryDuplicateSuggestions={() =>
        setDuplicateSuggestionRetry(value => value + 1)
      }
      onScreenshotConsentChange={consented => {
        const current = stateRef.current;
        if (
          current.kind !== 'editing' ||
          current.submitting ||
          current.screenshot.kind !== 'preview' ||
          current.screenshot.busy
        ) {
          return;
        }
        publish({
          ...current,
          error: null,
          screenshot: { ...current.screenshot, consented },
        });
      }}
      onScreenshotRemove={discardScreenshot}
      onSendWithoutScreenshot={sendWithoutScreenshot}
      onSubmit={submit}
      onTitleChange={title => {
        setDuplicateSuggestions({ kind: 'idle' });
        updateEditing(publish, stateRef.current, { title });
      }}
      onVisibilityChange={visibility => {
        setDuplicateSuggestions({ kind: 'idle' });
        updateEditing(publish, stateRef.current, { visibility });
      }}
      state={presentedState}
    />
  );
}

export function feedbackVisibilityFor(
  visibility: FeedbackComposeVisibility,
  canShareWithEvent: boolean,
): 'private' | 'public' {
  return canShareWithEvent && visibility === 'event' ? 'public' : 'private';
}

function deferPendingScreenshotCleanup(
  ref: {
    current: {
      feedbackId: string;
      owned: boolean;
      runtime: FeedbackComposeRuntime;
    } | null;
  },
  flight: Promise<void> | null,
) {
  const pending = ref.current;
  ref.current = null;
  if (!pending) return;
  const cleanup = () => {
    if (!pending.owned) {
      pending.runtime.cleanup(pending.feedbackId).catch(() => undefined);
    }
  };
  if (flight) flight.finally(cleanup).catch(() => undefined);
  else cleanup();
}

function editingState(
  sourceLabel: string,
  online: boolean,
  canShareWithEvent: boolean,
  diagnosticsPreview: FeedbackDiagnosticsPreview | null,
  hasScreenshotIntent: boolean,
): Extract<FeedbackComposeViewState, { kind: 'editing' }> {
  return {
    body: '',
    canShareWithEvent,
    diagnosticsConsented: false,
    diagnosticsPreview,
    error: null,
    kind: 'editing',
    online,
    screenshot: hasScreenshotIntent ? { kind: 'loading' } : { kind: 'none' },
    sourceLabel,
    submitting: false,
    title: '',
    visibility: canShareWithEvent ? 'event' : 'private',
  };
}

function updateEditing(
  publish: (next: FeedbackComposeViewState) => void,
  current: FeedbackComposeViewState,
  update: Partial<
    Pick<
      Extract<FeedbackComposeViewState, { kind: 'editing' }>,
      'body' | 'diagnosticsConsented' | 'title' | 'visibility'
    >
  >,
) {
  if (current.kind !== 'editing' || current.submitting) return;
  publish({ ...current, ...update, error: null });
}

const eventContextCategory = {
  key: 'event-context',
  label: 'Event-Kontext',
} as const;

const appContextCategory = {
  key: 'app-context',
  label: 'Allgemeiner App-Kontext',
} as const;

const eventIdPattern = /^evt_[A-Za-z0-9._:-]{1,96}$/;
const feedbackIdPattern = /^fbk_[A-Za-z0-9._:-]{1,96}$/;
const screenKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

function safeFeedbackSource(source: FeedbackComposeSource) {
  const rootEventId = validEventId(source.rootEventId);
  const sourceLabel = Array.from(
    stripControlCharacters(source.sourceLabel).replace(/\s+/g, ' ').trim(),
  )
    .slice(0, 120)
    .join('');
  return {
    eventId: rootEventId ? validEventId(source.eventId) : null,
    feedbackId:
      rootEventId &&
      typeof source.feedbackId === 'string' &&
      feedbackIdPattern.test(source.feedbackId)
        ? source.feedbackId
        : null,
    rootEventId,
    screenKey: screenKeyPattern.test(source.screenKey)
      ? source.screenKey
      : 'app-context',
    sourceLabel: sourceLabel || 'Aktuelle Ansicht',
  };
}

function stripControlCharacters(value: string): string {
  return Array.from(value, character => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127 ? ' ' : character;
  }).join('');
}

function validEventId(value: string | null | undefined): string | null {
  return typeof value === 'string' && eventIdPattern.test(value) ? value : null;
}

function validateDraft(title: string, body: string): string | null {
  if (!title || !body) return 'Titel und Beschreibung sind erforderlich.';
  if (title.length > 160) return 'Der Titel darf höchstens 160 Zeichen haben.';
  if (body.length > 10_000) {
    return 'Die Beschreibung darf höchstens 10’000 Zeichen haben.';
  }
  return null;
}

function failureCopy(failure: FeedbackSubmissionFailure | null): string | null {
  switch (failure) {
    case null:
      return null;
    case 'auth_required':
      return 'Deine Anmeldung muss erneut geprüft werden. Der Text bleibt lokal gespeichert.';
    case 'denied':
      return 'Der gewählte Eventbereich ist nicht mehr verfügbar. Der Text bleibt lokal gespeichert.';
    case 'invalid':
      return 'Der Server konnte dieses Feedback nicht annehmen. Der Text bleibt lokal gespeichert.';
    case 'retry_exhausted':
      return 'Die automatische Zustellung wurde nach mehreren Versuchen beendet.';
    case 'rate_limited':
      return 'Crew versucht die Zustellung nach der Server-Wartezeit erneut.';
    case 'network':
    case 'service_unavailable':
    case 'unknown':
      return 'Die Zustellung wird bei verfügbarer Verbindung erneut versucht.';
    case 'invalid_response':
      return 'Die Serverbestätigung war unvollständig. Crew versucht die Zustellung erneut.';
  }
}
