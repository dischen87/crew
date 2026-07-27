import { GatewayClientError } from '@crew/mobile-client';
import {
  CommunityFeedbackAccountChangedError,
  CommunityFeedbackDuplicateTargetUnavailableError,
  CommunityFeedbackManagerUnavailableError,
  FeedbackDuplicateSuggestionAccessDeniedError,
  FeedbackDuplicateSuggestionAccountChangedError,
  MobileSyncAccountChangedError,
  MobileSyncRootAccessDeniedError,
  type CommunityFeedbackResolution,
  type CommunityFeedbackManagerStatus,
  type CommunityFeedbackManagerWriteOutcome,
  normalizeFeedbackDuplicateQuery,
} from '@crew/mobile-data';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isSessionFailure } from '../app/flowErrors';
import { useGatewayClient } from '../app/GatewayProvider';
import {
  usePrivateDatabase,
  usePrivateSessionLifecycle,
} from '../app/PrivateBootstrapGate';
import { secureUuidV4 } from '../storage/secureRandom';
import { statusLabel } from './CommunityFeedbackListView';
import {
  CommunityFeedbackItemView,
  type CommunityFeedbackItemAction,
  type CommunityFeedbackItemViewModel,
} from './CommunityFeedbackItemView';
import { CommunityFeedbackRuntime } from './CommunityFeedbackRuntime';
import { useOnlineState } from './useOnlineState';

export type CommunityFeedbackItemScreenProps = {
  feedbackId: string;
  onBack(): void;
  onCanonicalFeedback?(feedbackId: string): void;
  rootEventId: string;
};

type ScopedItemState = CommunityFeedbackItemViewModel & { key: string };

export function CommunityFeedbackItemScreen({
  feedbackId,
  onBack,
  onCanonicalFeedback,
  rootEventId,
}: CommunityFeedbackItemScreenProps) {
  const client = useGatewayClient();
  const privateDatabase = usePrivateDatabase();
  const lifecycle = usePrivateSessionLifecycle();
  const online = useOnlineState();
  const activeAccountRef = useRef(lifecycle.accountId);
  activeAccountRef.current = lifecycle.accountId;
  const scopeKey =
    lifecycle.status === 'ready' &&
    lifecycle.accountId === privateDatabase.accountId
      ? `${privateDatabase.accountId}:${rootEventId}:${feedbackId}`
      : null;
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const [refreshRequest, setRefreshRequest] = useState(0);
  const [state, setState] = useState<ScopedItemState>(() =>
    initialState(scopeKey ?? '', online),
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const actionFlightRef = useRef<Promise<void> | null>(null);
  const idempotencyRef = useRef(new Map<string, string>());
  const commentIdsRef = useRef(new Map<string, string>());
  const redirectRef = useRef<string | null>(null);
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

  useEffect(() => {
    actionFlightRef.current = null;
    redirectRef.current = null;
    idempotencyRef.current.clear();
    commentIdsRef.current.clear();
  }, [scopeKey]);

  const publish = useCallback(
    (next: ScopedItemState) => {
      if (!scopeKey || next.key !== scopeKey) return;
      if (scopeRef.current !== scopeKey) return;
      if (activeAccountRef.current !== privateDatabase.accountId) return;
      stateRef.current = next;
      setState(next);
    },
    [privateDatabase.accountId, scopeKey],
  );

  const showResolution = useCallback(
    (resolution: CommunityFeedbackResolution, message: string | null) => {
      if (
        !scopeKey ||
        scopeRef.current !== scopeKey ||
        activeAccountRef.current !== privateDatabase.accountId
      ) {
        return;
      }
      const redirected = resolution.feedback.id !== feedbackId;
      publish({
        commentBody:
          message === 'Kommentar gesendet.' ? '' : stateRef.current.commentBody,
        commentError: null,
        feedback: resolution.feedback,
        key: scopeKey,
        manager: stateRef.current.manager,
        managerWriteState: 'ready',
        message,
        messageKind: message ? 'info' : null,
        online,
        phase: 'ready',
        redirected,
        working: null,
      });
      if (
        redirected &&
        scopeRef.current === scopeKey &&
        activeAccountRef.current === privateDatabase.accountId &&
        redirectRef.current !== resolution.feedback.id &&
        onCanonicalFeedback
      ) {
        redirectRef.current = resolution.feedback.id;
        onCanonicalFeedback(resolution.feedback.id);
      }
    },
    [
      feedbackId,
      onCanonicalFeedback,
      online,
      privateDatabase.accountId,
      publish,
      scopeKey,
    ],
  );

  useEffect(() => {
    if (!scopeKey || !runtime) {
      setState(unavailableState(scopeKey ?? '', online));
      return;
    }
    let cancelled = false;
    const accountUserId = privateDatabase.accountId;
    const previous =
      stateRef.current.key === scopeKey ? stateRef.current : null;
    let durableManagerWriteState =
      previous?.managerWriteState ?? ('ready' as const);
    publish({
      ...(previous ?? initialState(scopeKey, online)),
      key: scopeKey,
      online,
      working: previous?.phase === 'ready' && online ? 'refresh' : null,
    });

    const load = async () => {
      let cached = previous?.feedback ?? null;
      try {
        if (!(await runtime.hasCachedMembership(accountUserId, rootEventId))) {
          publish(unavailableState(scopeKey, online));
          return;
        }
        cached = await runtime.controller.getCached(rootEventId, feedbackId);
        durableManagerWriteState =
          (await runtime.controller.managerWritePending(
            rootEventId,
            feedbackId,
          ))
            ? 'refresh_required'
            : 'ready';
        if (cancelled) return;
        if (cached) {
          publish({
            commentBody: previous?.commentBody ?? '',
            commentError: null,
            feedback: cached,
            key: scopeKey,
            manager: previous?.manager ?? null,
            managerWriteState: durableManagerWriteState,
            message: online
              ? null
              : 'Offline. Du siehst den sicher gespeicherten Stand.',
            messageKind: online ? null : 'info',
            online,
            phase: 'ready',
            redirected: false,
            working: online ? 'refresh' : null,
          });
        }
      } catch (error) {
        if (handleSessionError(error, lifecycle.reloadSession)) return;
      }

      if (!online || cancelled) {
        if (!cached) publish(unavailableState(scopeKey, online));
        return;
      }
      try {
        await runtime.verifyRoot(accountUserId, rootEventId);
        if (cancelled) return;
        if (!(await runtime.hasCachedMembership(accountUserId, rootEventId))) {
          publish(unavailableState(scopeKey, online));
          return;
        }
        const resolution = await runtime.controller.refresh(
          rootEventId,
          feedbackId,
        );
        if (!cancelled) showResolution(resolution, null);
      } catch (error) {
        if (cancelled) return;
        if (error instanceof MobileSyncRootAccessDeniedError) {
          publish(unavailableState(scopeKey, online));
          return;
        }
        if (handleSessionError(error, lifecycle.reloadSession)) return;
        if (isItemMissing(error) || isRootBoundary(error)) {
          const itemMissing = isItemMissing(error);
          let rootConfirmed = false;
          try {
            await runtime.verifyRoot(accountUserId, rootEventId, true);
            if (
              !(await runtime.hasCachedMembership(accountUserId, rootEventId))
            ) {
              publish(unavailableState(scopeKey, online));
              return;
            }
            rootConfirmed = true;
          } catch (verificationError) {
            if (verificationError instanceof MobileSyncRootAccessDeniedError) {
              publish(unavailableState(scopeKey, online));
              return;
            }
            if (
              handleSessionError(verificationError, lifecycle.reloadSession)
            ) {
              return;
            }
          }
          if (itemMissing && rootConfirmed) {
            publish(removedState(scopeKey, online));
            return;
          }
          if (cached) {
            publish({
              commentBody: previous?.commentBody ?? '',
              commentError: null,
              feedback: cached,
              key: scopeKey,
              manager: previous?.manager ?? null,
              managerWriteState: durableManagerWriteState,
              message: rootConfirmed
                ? 'Eventzugriff bestätigt, aber dieses Feedback konnte nicht aktualisiert werden. Der gespeicherte Stand bleibt sichtbar.'
                : 'Der Inhalt konnte nicht aktualisiert werden. Der gespeicherte Stand bleibt sichtbar.',
              messageKind: 'error',
              online,
              phase: 'ready',
              redirected: false,
              working: null,
            });
          } else {
            publish(unavailableState(scopeKey, online));
          }
          return;
        }
        if (cached) {
          publish({
            commentBody: previous?.commentBody ?? '',
            commentError: null,
            feedback: cached,
            key: scopeKey,
            manager: previous?.manager ?? null,
            managerWriteState: durableManagerWriteState,
            message:
              'Aktualisierung nicht möglich. Der gespeicherte Stand bleibt sichtbar.',
            messageKind: 'error',
            online,
            phase: 'ready',
            redirected: false,
            working: null,
          });
        } else {
          publish(unavailableState(scopeKey, online));
        }
      }
    };
    load().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [
    feedbackId,
    lifecycle.reloadSession,
    online,
    privateDatabase.accountId,
    publish,
    refreshRequest,
    rootEventId,
    runtime,
    scopeKey,
    showResolution,
  ]);

  const managerFeedbackId =
    state.key === scopeKey && state.phase === 'ready'
      ? state.feedback?.id ?? null
      : null;
  const managerFeedbackTitle =
    state.key === scopeKey && state.phase === 'ready'
      ? state.feedback?.title ?? null
      : null;
  const managerFeedbackBody =
    state.key === scopeKey && state.phase === 'ready'
      ? state.feedback?.body ?? null
      : null;
  const managerFeedbackVersion =
    state.key === scopeKey && state.phase === 'ready'
      ? state.feedback?.version ?? null
      : null;
  const managerWriteState =
    state.key === scopeKey && state.phase === 'ready'
      ? state.managerWriteState
      : 'ready';

  useEffect(() => {
    if (
      !scopeKey ||
      !runtime ||
      !managerFeedbackId ||
      !managerFeedbackTitle ||
      managerFeedbackBody === null ||
      managerWriteState !== 'ready'
    ) {
      return;
    }
    let cancelled = false;
    const accountUserId = privateDatabase.accountId;
    const publishManager = (
      manager: CommunityFeedbackItemViewModel['manager'],
    ) => {
      if (cancelled) return;
      const current = stateRef.current;
      if (
        current.key !== scopeKey ||
        current.phase !== 'ready' ||
        current.feedback?.id !== managerFeedbackId ||
        current.managerWriteState !== 'ready'
      ) {
        return;
      }
      publish({ ...current, manager });
    };
    const loadManager = async () => {
      try {
        const role = await runtime.controller.managerRole(rootEventId);
        if (cancelled) return;
        if (!role) {
          publishManager(null);
          return;
        }
        const previous = stateRef.current.manager;
        publishManager({
          candidates: previous?.candidates ?? [],
          candidatesState: 'loading',
          note: previous?.note ?? '',
          role,
          selectedDuplicateId: previous?.selectedDuplicateId ?? null,
        });
        const query = normalizeFeedbackDuplicateQuery(
          managerFeedbackTitle,
          managerFeedbackBody,
        );
        const result = query
          ? await runtime.duplicateSuggestions.search(
              accountUserId,
              rootEventId,
              query,
              online,
            )
          : { items: [] as const };
        if (cancelled) return;
        const currentRole = await runtime.controller.managerRole(rootEventId);
        if (cancelled) return;
        if (!currentRole) {
          publishManager(null);
          return;
        }
        const items = result.items.filter(
          item => item.id !== managerFeedbackId,
        );
        const current = stateRef.current.manager;
        publishManager({
          candidates: items,
          candidatesState: 'ready',
          note: current?.note ?? '',
          role: currentRole,
          selectedDuplicateId: items.some(
            item => item.id === current?.selectedDuplicateId,
          )
            ? current?.selectedDuplicateId ?? null
            : null,
        });
      } catch (error) {
        if (cancelled) return;
        if (handleSessionError(error, lifecycle.reloadSession)) return;
        if (
          error instanceof FeedbackDuplicateSuggestionAccessDeniedError ||
          error instanceof CommunityFeedbackManagerUnavailableError
        ) {
          publishManager(null);
          return;
        }
        const current = stateRef.current.manager;
        if (current) {
          publishManager({ ...current, candidatesState: 'error' });
        }
      }
    };
    loadManager().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [
    lifecycle.reloadSession,
    managerFeedbackBody,
    managerFeedbackId,
    managerFeedbackTitle,
    managerFeedbackVersion,
    managerWriteState,
    online,
    privateDatabase.accountId,
    publish,
    refreshRequest,
    rootEventId,
    runtime,
    scopeKey,
  ]);

  const runAction = useCallback(
    (
      action: Exclude<CommunityFeedbackItemAction, 'refresh'>,
      signature: string,
      request: (
        idempotencyKey: string,
      ) => Promise<
        CommunityFeedbackResolution | CommunityFeedbackManagerWriteOutcome
      >,
      successMessage: string,
    ) => {
      if (actionFlightRef.current) return actionFlightRef.current;
      const current = stateRef.current;
      if (
        !scopeKey ||
        !runtime ||
        !client ||
        !online ||
        current.phase !== 'ready' ||
        !current.feedback ||
        current.managerWriteState !== 'ready' ||
        current.working !== null
      ) {
        return Promise.resolve();
      }
      const key =
        idempotencyRef.current.get(signature) ?? `community-${secureUuidV4()}`;
      idempotencyRef.current.set(signature, key);
      publish({
        ...current,
        commentError: null,
        message: null,
        messageKind: null,
        working: action,
      });
      const flight = request(key)
        .then(async result => {
          if (scopeRef.current !== scopeKey) return;
          idempotencyRef.current.delete(signature);
          if ('kind' in result && result.kind === 'committed_refresh_failed') {
            try {
              await runtime.verifyRoot(
                privateDatabase.accountId,
                rootEventId,
                true,
              );
              if (
                !(await runtime.hasCachedMembership(
                  privateDatabase.accountId,
                  rootEventId,
                ))
              ) {
                if (scopeRef.current === scopeKey) {
                  publish(unavailableState(scopeKey, online));
                }
                return;
              }
            } catch (verificationError) {
              if (scopeRef.current !== scopeKey) return;
              if (
                verificationError instanceof MobileSyncRootAccessDeniedError
              ) {
                publish(unavailableState(scopeKey, online));
                return;
              }
              if (
                handleSessionError(verificationError, lifecycle.reloadSession)
              ) {
                return;
              }
            }
            if (scopeRef.current !== scopeKey) return;
            const latest = stateRef.current;
            if (latest.phase === 'ready') {
              publish({
                ...latest,
                manager: null,
                managerWriteState: 'refresh_required',
                message:
                  'Änderung bestätigt. Der aktuelle sichere Stand konnte nicht geladen werden. Bitte aktualisieren; sende die Änderung nicht erneut.',
                messageKind: 'error',
                working: null,
              });
            }
            return;
          }
          const resolution = 'kind' in result ? result.resolution : result;
          showResolution(resolution, successMessage);
          if (action === 'status' || action === 'duplicate') {
            const latest = stateRef.current;
            if (latest.phase === 'ready' && latest.manager) {
              publish({
                ...latest,
                manager: {
                  ...latest.manager,
                  note: '',
                  selectedDuplicateId: null,
                },
              });
            }
          }
        })
        .catch(async error => {
          if (!scopeKey) return;
          if (handleSessionError(error, lifecycle.reloadSession)) return;
          if (error instanceof MobileSyncRootAccessDeniedError) {
            publish(unavailableState(scopeKey, online));
            return;
          }
          if (
            error instanceof CommunityFeedbackManagerUnavailableError ||
            error instanceof CommunityFeedbackDuplicateTargetUnavailableError
          ) {
            const latest = stateRef.current;
            if (latest.phase === 'ready') {
              publish({
                ...latest,
                manager:
                  error instanceof CommunityFeedbackManagerUnavailableError
                    ? null
                    : latest.manager
                    ? {
                        ...latest.manager,
                        candidatesState: 'error',
                        selectedDuplicateId: null,
                      }
                    : null,
                message:
                  error instanceof CommunityFeedbackManagerUnavailableError
                    ? 'Manager-Zugriff nicht mehr verfügbar. Die Änderung wurde nicht gesendet.'
                    : 'Das ausgewählte Ziel ist nicht mehr verfügbar. Die Zusammenführung wurde nicht gesendet.',
                messageKind: 'error',
                working: null,
              });
            }
            return;
          }
          if (isItemMissing(error) || isRootBoundary(error)) {
            const itemMissing = isItemMissing(error);
            let rootConfirmed = false;
            try {
              await runtime.verifyRoot(
                privateDatabase.accountId,
                rootEventId,
                true,
              );
              if (
                !(await runtime.hasCachedMembership(
                  privateDatabase.accountId,
                  rootEventId,
                ))
              ) {
                publish(unavailableState(scopeKey, online));
                return;
              }
              rootConfirmed = true;
            } catch (verificationError) {
              if (
                verificationError instanceof MobileSyncRootAccessDeniedError
              ) {
                publish(unavailableState(scopeKey, online));
                return;
              }
              if (
                handleSessionError(verificationError, lifecycle.reloadSession)
              ) {
                return;
              }
            }
            if (itemMissing && rootConfirmed) {
              publish(removedState(scopeKey, online));
              return;
            }
            const latest = stateRef.current;
            if (latest.phase === 'ready' && latest.feedback) {
              publish({
                ...latest,
                commentError:
                  action === 'comment'
                    ? 'Kommentar nicht gesendet. Es wurde nichts vorgemerkt.'
                    : latest.commentError,
                message:
                  action === 'comment'
                    ? null
                    : rootConfirmed
                    ? 'Eventzugriff bestätigt, aber die Änderung wurde nicht gesendet. Es wurde nichts vorgemerkt.'
                    : 'Die Änderung wurde nicht gesendet. Es wurde nichts vorgemerkt.',
                messageKind: action === 'comment' ? null : 'error',
                working: null,
              });
            }
            return;
          }
          const latest = stateRef.current;
          if (latest.phase !== 'ready') return;
          publish({
            ...latest,
            commentError:
              action === 'comment'
                ? 'Kommentar nicht gesendet. Es wurde nichts vorgemerkt.'
                : latest.commentError,
            message:
              action === 'comment'
                ? null
                : 'Änderung nicht gesendet. Es wurde nichts vorgemerkt.',
            messageKind: action === 'comment' ? null : 'error',
            working: null,
          });
        })
        .finally(() => {
          if (actionFlightRef.current === flight) {
            actionFlightRef.current = null;
          }
        });
      actionFlightRef.current = flight;
      return flight;
    },
    [
      client,
      lifecycle.reloadSession,
      online,
      privateDatabase.accountId,
      publish,
      rootEventId,
      runtime,
      scopeKey,
      showResolution,
    ],
  );

  const setVote = useCallback(
    (present: boolean) => {
      if (!runtime) return Promise.resolve();
      return runAction(
        'vote',
        `vote:${feedbackId}:${present}`,
        key =>
          runtime.controller.setVote(rootEventId, feedbackId, present, key),
        present ? 'Stimme gesendet.' : 'Stimme entfernt.',
      );
    },
    [feedbackId, rootEventId, runAction, runtime],
  );

  const setFollowed = useCallback(
    (followed: boolean) => {
      if (!runtime) return Promise.resolve();
      return runAction(
        'follow',
        `follow:${feedbackId}:${followed}`,
        async key => {
          const follow = await runtime.controller.setFollowed(
            rootEventId,
            feedbackId,
            followed,
            key,
          );
          const feedback = await runtime.controller.getCached(
            rootEventId,
            follow.feedbackId,
          );
          if (!feedback) throw new Error('Canonical feedback is unavailable');
          return {
            feedback,
            redirectedFromFeedbackId:
              follow.feedbackId === feedbackId ? null : feedbackId,
          };
        },
        followed ? 'Status wird gefolgt.' : 'Status-Follow entfernt.',
      );
    },
    [feedbackId, rootEventId, runAction, runtime],
  );

  const submitComment = useCallback(() => {
    if (!runtime) return Promise.resolve();
    const body = stateRef.current.commentBody.trim();
    if (!body || body.length > 5_000) {
      const current = stateRef.current;
      if (current.phase === 'ready') {
        publish({
          ...current,
          commentError:
            body.length > 5_000
              ? 'Höchstens 5’000 Zeichen.'
              : 'Schreibe zuerst einen Kommentar.',
        });
      }
      return Promise.resolve();
    }
    const signature = `comment:${feedbackId}:${body}`;
    const commentId =
      commentIdsRef.current.get(signature) ?? `fbc_${secureUuidV4()}`;
    commentIdsRef.current.set(signature, commentId);
    return runAction(
      'comment',
      signature,
      key =>
        runtime.controller.addComment(
          rootEventId,
          feedbackId,
          { body, id: commentId },
          key,
        ),
      'Kommentar gesendet.',
    ).then(() => {
      const latest = stateRef.current;
      if (latest.message === 'Kommentar gesendet.') {
        commentIdsRef.current.delete(signature);
      }
    });
  }, [feedbackId, publish, rootEventId, runAction, runtime]);

  const setManagerStatus = useCallback(
    (status: CommunityFeedbackManagerStatus) => {
      if (!runtime) return Promise.resolve();
      const manager = stateRef.current.manager;
      if (!manager) return Promise.resolve();
      const note = manager.note.trim();
      return runAction(
        'status',
        `status:${feedbackId}:${status}:${note}`,
        async key => {
          await runtime.verifyRoot(
            privateDatabase.accountId,
            rootEventId,
            true,
          );
          if (
            !(await runtime.hasCachedMembership(
              privateDatabase.accountId,
              rootEventId,
            )) ||
            !(await runtime.controller.managerRole(rootEventId))
          ) {
            throw new CommunityFeedbackManagerUnavailableError();
          }
          return runtime.controller.setStatus(
            rootEventId,
            feedbackId,
            status,
            note,
            key,
          );
        },
        `Status auf „${statusLabel(status)}“ gesetzt.`,
      );
    },
    [feedbackId, privateDatabase.accountId, rootEventId, runAction, runtime],
  );

  const submitManagerDuplicate = useCallback(() => {
    if (!runtime) return Promise.resolve();
    const manager = stateRef.current.manager;
    const canonicalFeedbackId = manager?.selectedDuplicateId;
    if (
      !manager ||
      !canonicalFeedbackId ||
      !manager.candidates.some(item => item.id === canonicalFeedbackId)
    ) {
      return Promise.resolve();
    }
    const note = manager.note.trim();
    return runAction(
      'duplicate',
      `duplicate:${feedbackId}:${canonicalFeedbackId}:${note}`,
      async key => {
        await runtime.verifyRoot(privateDatabase.accountId, rootEventId, true);
        if (
          !(await runtime.hasCachedMembership(
            privateDatabase.accountId,
            rootEventId,
          )) ||
          !(await runtime.controller.managerRole(rootEventId))
        ) {
          throw new CommunityFeedbackManagerUnavailableError();
        }
        return runtime.controller.markDuplicate(
          rootEventId,
          feedbackId,
          canonicalFeedbackId,
          note,
          key,
        );
      },
      'Meldungen zusammengeführt.',
    );
  }, [feedbackId, privateDatabase.accountId, rootEventId, runAction, runtime]);

  const model: CommunityFeedbackItemViewModel = !scopeKey
    ? unavailableState('', online)
    : state.key === scopeKey
    ? state
    : { ...initialState(scopeKey ?? '', online), phase: 'loading' };

  return (
    <CommunityFeedbackItemView
      model={model}
      onBack={onBack}
      onCommentBodyChange={commentBody => {
        const current = stateRef.current;
        if (current.phase !== 'ready' || current.working !== null) return;
        publish({ ...current, commentBody, commentError: null });
      }}
      onFollowChange={setFollowed}
      onManagerDuplicateSelect={selectedDuplicateId => {
        const current = stateRef.current;
        if (
          current.phase !== 'ready' ||
          current.managerWriteState !== 'ready' ||
          current.working !== null ||
          !current.manager ||
          !current.manager.candidates.some(
            item => item.id === selectedDuplicateId,
          )
        ) {
          return;
        }
        publish({
          ...current,
          manager: { ...current.manager, selectedDuplicateId },
        });
      }}
      onManagerDuplicateSubmit={submitManagerDuplicate}
      onManagerNoteChange={note => {
        const current = stateRef.current;
        if (
          current.phase !== 'ready' ||
          current.managerWriteState !== 'ready' ||
          current.working !== null ||
          !current.manager
        ) {
          return;
        }
        publish({ ...current, manager: { ...current.manager, note } });
      }}
      onManagerStatusChange={setManagerStatus}
      onRefresh={() => setRefreshRequest(value => value + 1)}
      onSubmitComment={submitComment}
      onVoteChange={setVote}
    />
  );
}

function initialState(key: string, online: boolean): ScopedItemState {
  return {
    commentBody: '',
    commentError: null,
    feedback: null,
    key,
    manager: null,
    managerWriteState: 'ready',
    message: null,
    messageKind: null,
    online,
    phase: 'loading',
    redirected: false,
    working: null,
  };
}

function unavailableState(key: string, online: boolean): ScopedItemState {
  return {
    ...initialState(key, online),
    message: 'Dieser Inhalt ist nicht verfügbar.',
    messageKind: 'error',
    phase: 'unavailable',
  };
}

function removedState(key: string, online: boolean): ScopedItemState {
  return {
    ...initialState(key, online),
    phase: 'removed',
  };
}

function handleSessionError(
  error: unknown,
  reloadSession: () => Promise<void>,
): boolean {
  if (
    error instanceof CommunityFeedbackAccountChangedError ||
    error instanceof FeedbackDuplicateSuggestionAccountChangedError ||
    error instanceof MobileSyncAccountChangedError ||
    isSessionFailure(error)
  ) {
    reloadSession().catch(() => undefined);
    return true;
  }
  return false;
}

function isItemMissing(error: unknown): boolean {
  return error instanceof GatewayClientError && error.status === 404;
}

function isRootBoundary(error: unknown): boolean {
  return error instanceof GatewayClientError && error.status === 403;
}
