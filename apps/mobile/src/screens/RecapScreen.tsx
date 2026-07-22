import {
  EventRecapAccountChangedError,
  EventRecapController,
  EventRecapExternalApprovalsRequiredError,
  EventRecapManagerRequiredError,
  EventRecapOnlineRequiredError,
  EventRecapRootAccessDeniedError,
  EventRecapUnavailableError,
  type EventRecapExternalField,
  type EventRecapExternalShare,
  type EventRecapRole,
  type EventRecapShare,
  type EventRecapSnapshot,
} from '@crew/mobile-data';
import { buildRecapShareUrl } from '@crew/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { onlineManager } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Share } from 'react-native';
import { useGatewayClient } from '../app/GatewayProvider';
import {
  usePrivateDatabase,
  usePrivateSessionLifecycle,
} from '../app/PrivateBootstrapGate';
import type { RootStackParamList } from '../navigation/types';
import { secureUuidV4 } from '../storage/secureRandom';
import {
  RecapView,
  type RecapViewAction,
  type RecapViewModel,
} from './RecapView';

type Props = NativeStackScreenProps<RootStackParamList, 'RecapInbound'>;

type ActiveRecapShare =
  | {
      kind: 'exact-body';
      scopeKey: string;
      selectedExternalFieldIds: readonly string[];
      share: EventRecapExternalShare;
    }
  | {
      kind: 'title-only';
      scopeKey: string;
      share: EventRecapShare;
    };

type RecapOperation = {
  identity: symbol;
  recapVersion: number | undefined;
  scopeKey: string;
};

type RecapScreenState = {
  activeShare: ActiveRecapShare | null;
  busyAction: RecapViewAction | null;
  busyExternalAuthority: 'author' | 'manager' | null;
  busyExternalDecision: 'grant' | 'withdraw' | null;
  busyExternalFieldId: string | null;
  message: string | null;
  online: boolean;
  phase: 'concealed' | 'loading' | 'ready';
  role: EventRecapRole | null;
  selectedExternalFieldIds: readonly string[];
  snapshot: EventRecapSnapshot | null;
  scopeKey: string | null;
};

const initialState: RecapScreenState = {
  activeShare: null,
  busyAction: null,
  busyExternalAuthority: null,
  busyExternalDecision: null,
  busyExternalFieldId: null,
  message: null,
  online: true,
  phase: 'loading',
  role: null,
  selectedExternalFieldIds: [],
  snapshot: null,
  scopeKey: null,
};

export function RecapScreen({ navigation, route }: Props) {
  const client = useGatewayClient();
  const privateDatabase = usePrivateDatabase();
  const lifecycle = usePrivateSessionLifecycle();
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<RecapScreenState>(initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const rootEventId = route.params.rootEventId;
  const requestedVersion = parseRecapVersion(route.params.version);
  const scopeKey =
    lifecycle.status === 'ready' &&
    lifecycle.accountId === privateDatabase.accountId
      ? `${privateDatabase.accountId}:${rootEventId}:${
          requestedVersion ?? 'current'
        }`
      : null;
  const activeScopeRef = useRef<string | null>(scopeKey);
  activeScopeRef.current = scopeKey;
  const activeOperationRef = useRef<RecapOperation | null>(null);
  if (activeOperationRef.current?.scopeKey !== scopeKey) {
    activeOperationRef.current = null;
  }
  const controller = useMemo(
    () =>
      client && scopeKey && requestedVersion !== 'invalid'
        ? new EventRecapController(privateDatabase.database, client, {
            idempotencyKey: secureUuidV4,
            isOnline: isOnline,
          })
        : null,
    [client, privateDatabase.database, requestedVersion, scopeKey],
  );

  useEffect(() => {
    let cancelled = false;
    if (!controller || !scopeKey || requestedVersion === 'invalid') {
      setState({
        ...initialState,
        online: isOnline(),
        phase: 'concealed',
        scopeKey,
      });
      return () => {
        cancelled = true;
      };
    }

    setState(current => ({
      ...initialState,
      activeShare:
        current.activeShare?.scopeKey === scopeKey ? current.activeShare : null,
      online: isOnline(),
      scopeKey,
    }));
    ignore(
      loadRecap(controller, rootEventId, requestedVersion).then(
        result => {
          if (
            cancelled ||
            !isCurrentRecapScope(scopeKey, activeScopeRef.current)
          )
            return;
          setState(current => ({
            ...current,
            ...result,
            activeShare:
              current.activeShare &&
              recapShareBelongsToScope(
                current.activeShare.scopeKey,
                scopeKey,
                current.activeShare.share.shareLink.recapVersion,
                result.snapshot?.recap.version,
              )
                ? current.activeShare
                : null,
            busyAction: null,
            busyExternalAuthority: null,
            busyExternalDecision: null,
            busyExternalFieldId: null,
            scopeKey,
          }));
        },
        error => {
          if (
            cancelled ||
            !isCurrentRecapScope(scopeKey, activeScopeRef.current)
          )
            return;
          setState(current => ({
            ...current,
            activeShare: null,
            busyAction: null,
            busyExternalAuthority: null,
            busyExternalDecision: null,
            busyExternalFieldId: null,
            message: safeRecapMessage(error),
            online: isOnline(),
            phase: 'concealed',
            role: null,
            scopeKey,
            snapshot: null,
          }));
        },
      ),
    );
    return () => {
      cancelled = true;
    };
  }, [controller, reload, requestedVersion, rootEventId, scopeKey]);

  const beginOperation = (
    operationScope: string,
    operationRecapVersion?: number,
  ): RecapOperation | null => {
    if (
      activeOperationRef.current ||
      !isCurrentRecapScope(operationScope, activeScopeRef.current) ||
      (operationRecapVersion !== undefined &&
        stateRef.current.snapshot?.recap.version !== operationRecapVersion)
    ) {
      return null;
    }
    const operation = {
      identity: Symbol('recap-operation'),
      recapVersion: operationRecapVersion,
      scopeKey: operationScope,
    };
    activeOperationRef.current = operation;
    return operation;
  };
  const isActiveOperation = (operation: RecapOperation) =>
    activeOperationRef.current?.identity === operation.identity &&
    isCurrentRecapScope(operation.scopeKey, activeScopeRef.current) &&
    (operation.recapVersion === undefined ||
      stateRef.current.snapshot?.recap.version === operation.recapVersion);
  const finishOperation = (operation: RecapOperation) => {
    if (activeOperationRef.current?.identity === operation.identity) {
      activeOperationRef.current = null;
    }
  };
  const clearOperationBusy = (operation: RecapOperation) => {
    if (!isActiveOperation(operation)) return;
    setState(current =>
      current.scopeKey === operation.scopeKey &&
      (operation.recapVersion === undefined ||
        current.snapshot?.recap.version === operation.recapVersion)
        ? {
            ...current,
            busyAction: null,
            busyExternalAuthority: null,
            busyExternalDecision: null,
            busyExternalFieldId: null,
          }
        : current,
    );
  };
  const mutate = async (
    action: RecapViewAction,
    operationScope: string,
    work: () => Promise<EventRecapSnapshot | null>,
    operationRecapVersion?: number,
  ) => {
    const operation = beginOperation(operationScope, operationRecapVersion);
    if (!operation) return;
    try {
      setState(current =>
        current.scopeKey === operationScope &&
        (operationRecapVersion === undefined ||
          current.snapshot?.recap.version === operationRecapVersion)
          ? {
              ...current,
              busyAction: action,
              busyExternalAuthority: null,
              busyExternalDecision: null,
              busyExternalFieldId: null,
              message: null,
              online: isOnline(),
            }
          : current,
      );
      const snapshot = await work();
      if (!isActiveOperation(operation)) return;
      setState(current =>
        current.scopeKey === operationScope &&
        (operationRecapVersion === undefined ||
          current.snapshot?.recap.version === operationRecapVersion)
          ? {
              ...current,
              activeShare:
                action === 'remove' || action === 'revoke'
                  ? null
                  : current.activeShare,
              busyAction: null,
              message: null,
              online: isOnline(),
              phase: 'ready',
              role: snapshot?.role ?? current.role,
              snapshot,
            }
          : current,
      );
    } catch (error) {
      if (!isActiveOperation(operation)) return;
      setState(current => {
        if (
          current.scopeKey !== operationScope ||
          (operationRecapVersion !== undefined &&
            current.snapshot?.recap.version !== operationRecapVersion)
        )
          return current;
        const concealed = concealsRecap(error);
        return {
          ...current,
          activeShare: concealed ? null : current.activeShare,
          busyAction: null,
          busyExternalAuthority: null,
          message: safeRecapMessage(error),
          online: isOnline(),
          phase: concealed ? 'concealed' : current.phase,
          role: concealed ? null : current.role,
          selectedExternalFieldIds: concealed
            ? []
            : current.selectedExternalFieldIds,
          snapshot: concealed ? null : current.snapshot,
        };
      });
    } finally {
      clearOperationBusy(operation);
      finishOperation(operation);
    }
  };

  const onBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('EventInbound', { rootEventId });
  };
  const onRefresh = () => {
    if (activeOperationRef.current) return;
    setReload(value => value + 1);
  };
  const onGenerate = () => {
    if (!controller || !scopeKey) return;
    ignore(
      mutate('generate', scopeKey, () => controller.generate(rootEventId)),
    );
  };
  const onPublish = () => {
    const liveState = stateRef.current;
    if (!controller || !scopeKey || !liveState.snapshot) return;
    const { lifecycleVersion, version } = liveState.snapshot.recap;
    ignore(
      mutate(
        'publish',
        scopeKey,
        () => controller.publish(rootEventId, version, lifecycleVersion),
        version,
      ),
    );
  };
  const onRemove = () => {
    const liveState = stateRef.current;
    if (
      activeOperationRef.current ||
      !controller ||
      !scopeKey ||
      !liveState.snapshot ||
      !liveState.online ||
      !isOnline() ||
      liveState.scopeKey !== scopeKey
    )
      return;
    const { lifecycleVersion, version: recapVersion } =
      liveState.snapshot.recap;
    Alert.alert(
      'Rückblick entfernen?',
      'Der veröffentlichte Rückblick und aktive Freigaben sind danach nicht mehr verfügbar.',
      [
        { style: 'cancel', text: 'Abbrechen' },
        {
          onPress: () =>
            ignore(
              mutate(
                'remove',
                scopeKey,
                async () => {
                  await controller.remove(rootEventId, lifecycleVersion);
                  return null;
                },
                recapVersion,
              ),
            ),
          style: 'destructive',
          text: 'Entfernen',
        },
      ],
    );
  };
  const setActionError = (
    error: unknown,
    operation: RecapOperation,
    forgetExternalConsent = false,
  ) => {
    if (!isActiveOperation(operation)) return;
    setState(current => {
      if (
        current.scopeKey !== operation.scopeKey ||
        current.snapshot?.recap.version !== operation.recapVersion
      )
        return current;
      const concealed = concealsRecap(error);
      return {
        ...current,
        activeShare:
          concealed || forgetExternalConsent ? null : current.activeShare,
        busyAction: null,
        busyExternalAuthority: null,
        busyExternalDecision: null,
        busyExternalFieldId: null,
        message:
          forgetExternalConsent && !concealed
            ? 'Der aktuelle Freigabestatus konnte nicht bestätigt werden. Prüfe ihn erneut online.'
            : safeRecapMessage(error),
        online: isOnline(),
        phase: concealed ? 'concealed' : current.phase,
        role: concealed ? null : current.role,
        selectedExternalFieldIds: concealed
          ? []
          : current.selectedExternalFieldIds,
        snapshot: concealed
          ? null
          : forgetExternalConsent && current.snapshot
          ? { ...current.snapshot, externalConsent: null }
          : current.snapshot,
      };
    });
  };
  const presentShare = async (
    activeShare: ActiveRecapShare,
    operation: RecapOperation,
    failureMessage: string,
  ) => {
    const liveState = stateRef.current;
    if (
      !liveState.snapshot ||
      liveState.scopeKey !== operation.scopeKey ||
      activeShare.scopeKey !== operation.scopeKey ||
      !isActiveOperation(operation) ||
      activeShare.share.shareLink.recapVersion !== operation.recapVersion
    )
      return;
    try {
      await Share.share({
        message: `${liveState.snapshot.recap.title}\n${buildRecapShareUrl(
          activeShare.share.token,
        )}`,
        title: liveState.snapshot.recap.title,
      });
    } catch {
      if (!isActiveOperation(operation)) return;
      setState(current =>
        current.scopeKey === operation.scopeKey &&
        current.snapshot?.recap.version === operation.recapVersion
          ? { ...current, message: failureMessage }
          : current,
      );
    }
  };
  const onShare = async () => {
    const liveState = stateRef.current;
    if (!controller || !scopeKey || !liveState.snapshot) return;
    const operationScope = scopeKey;
    const operationRecapVersion = liveState.snapshot.recap.version;
    let activeShare =
      liveState.activeShare &&
      recapShareBelongsToScope(
        liveState.activeShare.scopeKey,
        operationScope,
        liveState.activeShare.share.shareLink.recapVersion,
        operationRecapVersion,
      )
        ? liveState.activeShare
        : null;
    if (activeShare?.kind === 'exact-body') return;
    const operation = beginOperation(operationScope, operationRecapVersion);
    if (!operation) return;
    setState(current =>
      current.scopeKey === operationScope &&
      current.snapshot?.recap.version === operationRecapVersion
        ? {
            ...current,
            activeShare: activeShare ? current.activeShare : null,
            busyAction: 'share',
            busyExternalAuthority: null,
            busyExternalDecision: null,
            busyExternalFieldId: null,
            message: null,
            online: isOnline(),
          }
        : current,
    );
    try {
      if (!activeShare) {
        activeShare = {
          kind: 'title-only',
          scopeKey: operationScope,
          share: await controller.createShareLink(
            rootEventId,
            operationRecapVersion,
          ),
        };
        if (!isActiveOperation(operation)) return;
        setState(current =>
          current.scopeKey === operationScope &&
          current.snapshot?.recap.version === operationRecapVersion
            ? {
                ...current,
                activeShare,
                message: null,
                online: isOnline(),
              }
            : current,
        );
      }
      await presentShare(
        activeShare,
        operation,
        'Der Titel-Link wurde erstellt, aber Teilen konnte nicht geöffnet werden. Du kannst ihn erneut teilen oder widerrufen.',
      );
    } catch (error) {
      setActionError(error, operation);
    } finally {
      clearOperationBusy(operation);
      finishOperation(operation);
    }
  };
  const onExternalSelectionToggle = (itemId: string) => {
    const liveState = stateRef.current;
    if (
      activeOperationRef.current ||
      !scopeKey ||
      !liveState.snapshot ||
      !isCurrentRecapScope(scopeKey, activeScopeRef.current)
    ) {
      return;
    }
    const operationScope = scopeKey;
    const operationRecapVersion = liveState.snapshot.recap.version;
    setState(current => {
      if (
        current.scopeKey !== operationScope ||
        current.snapshot?.recap.version !== operationRecapVersion ||
        current.activeShare?.kind === 'exact-body'
      )
        return current;
      const selected = current.selectedExternalFieldIds.includes(itemId);
      return {
        ...current,
        selectedExternalFieldIds: selected
          ? current.selectedExternalFieldIds.filter(id => id !== itemId)
          : [...current.selectedExternalFieldIds, itemId],
      };
    });
  };
  const onExternalDecision = (
    itemId: string,
    authority: 'author' | 'manager',
    decision: 'grant' | 'withdraw',
  ) => {
    const liveState = stateRef.current;
    if (
      !controller ||
      !scopeKey ||
      !liveState.snapshot ||
      liveState.scopeKey !== scopeKey
    )
      return;
    const operationScope = scopeKey;
    const operationRecapVersion = liveState.snapshot.recap.version;
    const target = externalDecisionTarget(liveState.snapshot, itemId);
    if (!target?.consent.actorCanDecide.includes(authority)) return;
    const operation = beginOperation(operationScope, operationRecapVersion);
    if (!operation) return;
    setState(current =>
      current.scopeKey === operationScope &&
      current.snapshot?.recap.version === operationRecapVersion
        ? {
            ...current,
            busyAction: null,
            busyExternalAuthority: authority,
            busyExternalDecision: decision,
            busyExternalFieldId: itemId,
            message: null,
            online: isOnline(),
          }
        : current,
    );
    ignore(
      (async () => {
        try {
          await controller.decideExternalBody(
            rootEventId,
            operationRecapVersion,
            target.field,
            authority,
            decision,
          );
          if (!isActiveOperation(operation)) return;
          const snapshot = await controller.refresh(
            rootEventId,
            operationRecapVersion,
          );
          if (!isActiveOperation(operation)) return;
          setState(current => {
            if (
              current.scopeKey !== operationScope ||
              current.snapshot?.recap.version !== operationRecapVersion
            )
              return current;
            const invalidatedExactShare =
              decision === 'withdraw' &&
              current.activeShare?.kind === 'exact-body';
            return {
              ...current,
              activeShare:
                invalidatedExactShare || !snapshot ? null : current.activeShare,
              message: invalidatedExactShare
                ? 'Eine erforderliche Freigabe wurde widerrufen. Der erstellte Text-Link gilt nicht mehr.'
                : snapshot
                ? null
                : 'Dieser Rückblick ist nicht mehr verfügbar.',
              online: isOnline(),
              phase: snapshot ? 'ready' : 'concealed',
              role: snapshot?.role ?? current.role,
              selectedExternalFieldIds: snapshot
                ? current.selectedExternalFieldIds
                : [],
              snapshot,
            };
          });
        } catch (error) {
          setActionError(error, operation, true);
        } finally {
          clearOperationBusy(operation);
          finishOperation(operation);
        }
      })(),
    );
  };
  const onShareExact = async () => {
    const liveState = stateRef.current;
    if (!controller || !scopeKey || !liveState.snapshot) return;
    const operationScope = scopeKey;
    const operationRecapVersion = liveState.snapshot.recap.version;
    let activeShare =
      liveState.activeShare &&
      recapShareBelongsToScope(
        liveState.activeShare.scopeKey,
        operationScope,
        liveState.activeShare.share.shareLink.recapVersion,
        operationRecapVersion,
      )
        ? liveState.activeShare
        : null;
    if (activeShare?.kind === 'title-only') return;
    const selection = activeShare ? null : selectedExternalSelection(liveState);
    if (!activeShare && selection?.fields.length === 0) return;
    const operation = beginOperation(operationScope, operationRecapVersion);
    if (!operation) return;
    setState(current =>
      current.scopeKey === operationScope &&
      current.snapshot?.recap.version === operationRecapVersion
        ? {
            ...current,
            activeShare: activeShare ? current.activeShare : null,
            busyAction: 'shareExact',
            busyExternalAuthority: null,
            busyExternalDecision: null,
            busyExternalFieldId: null,
            message: null,
            online: isOnline(),
          }
        : current,
    );
    try {
      if (!activeShare && selection) {
        activeShare = {
          kind: 'exact-body',
          scopeKey: operationScope,
          selectedExternalFieldIds: [...selection.fieldIds],
          share: await controller.createExactBodyShareLink(
            rootEventId,
            operationRecapVersion,
            selection.fields,
          ),
        };
        if (!isActiveOperation(operation)) return;
        setState(current =>
          current.scopeKey === operationScope &&
          current.snapshot?.recap.version === operationRecapVersion
            ? {
                ...current,
                activeShare,
                message: null,
                online: isOnline(),
              }
            : current,
        );
      }
      if (!activeShare) return;
      await presentShare(
        activeShare,
        operation,
        'Der Text-Link wurde erstellt, aber Teilen konnte nicht geöffnet werden. Du kannst ihn erneut teilen oder widerrufen.',
      );
    } catch (error) {
      setActionError(error, operation);
    } finally {
      clearOperationBusy(operation);
      finishOperation(operation);
    }
  };
  const onRevoke = () => {
    const liveState = stateRef.current;
    if (
      !controller ||
      !scopeKey ||
      !liveState.activeShare ||
      liveState.scopeKey !== scopeKey
    )
      return;
    if (
      !liveState.snapshot ||
      !recapShareBelongsToScope(
        liveState.activeShare.scopeKey,
        scopeKey,
        liveState.activeShare.share.shareLink.recapVersion,
        liveState.snapshot.recap.version,
      )
    )
      return;
    const shareLinkId = liveState.activeShare.share.shareLink.id;
    ignore(
      mutate(
        'revoke',
        scopeKey,
        async () => {
          await controller.revokeShareLink(rootEventId, shareLinkId);
          return liveState.snapshot;
        },
        liveState.snapshot.recap.version,
      ),
    );
  };

  return (
    <RecapView
      model={recapViewModel(state, scopeKey)}
      onBack={onBack}
      onExternalDecision={onExternalDecision}
      onExternalSelectionToggle={onExternalSelectionToggle}
      onGenerate={onGenerate}
      onPublish={onPublish}
      onRefresh={onRefresh}
      onRemove={onRemove}
      onRevoke={onRevoke}
      onShare={() => ignore(onShare())}
      onShareExact={() => ignore(onShareExact())}
    />
  );
}

export function parseRecapVersion(
  value: string | undefined,
): number | 'invalid' | undefined {
  if (value === undefined) return undefined;
  const normalized = value.startsWith('v') ? value.slice(1) : value;
  if (!/^[1-9][0-9]*$/.test(normalized)) return 'invalid';
  const version = Number(normalized);
  return Number.isSafeInteger(version) ? version : 'invalid';
}

export function isCurrentRecapScope(
  operationScope: string | null,
  currentScope: string | null,
) {
  return operationScope !== null && operationScope === currentScope;
}

export function isCurrentRecapOperation(
  operationScope: string | null,
  currentScope: string | null,
  operationRecapVersion: number,
  currentRecapVersion: number | undefined,
) {
  return (
    isCurrentRecapScope(operationScope, currentScope) &&
    currentRecapVersion !== undefined &&
    operationRecapVersion === currentRecapVersion
  );
}

export function recapShareBelongsToScope(
  shareScope: string,
  currentScope: string | null,
  shareRecapVersion: number,
  currentRecapVersion: number | undefined,
) {
  return isCurrentRecapOperation(
    shareScope,
    currentScope,
    shareRecapVersion,
    currentRecapVersion,
  );
}

async function loadRecap(
  controller: EventRecapController,
  rootEventId: string,
  version: number | undefined,
): Promise<
  Pick<RecapScreenState, 'message' | 'online' | 'phase' | 'role' | 'snapshot'>
> {
  const role = await controller.getRole(rootEventId);
  const cached = await controller.getCached(rootEventId, version);
  if (!isOnline()) {
    return {
      message: null,
      online: false,
      phase: 'ready',
      role,
      snapshot: cached,
    };
  }
  try {
    const snapshot = await controller.refresh(rootEventId, version);
    return {
      message: null,
      online: true,
      phase: 'ready',
      role,
      snapshot,
    };
  } catch (error) {
    if (!cached) throw error;
    return {
      message: safeRecapMessage(error),
      online: false,
      phase: 'ready',
      role,
      snapshot: cached,
    };
  }
}

function recapViewModel(
  state: RecapScreenState,
  currentScope: string | null,
): RecapViewModel {
  const scoped = isCurrentRecapScope(state.scopeKey, currentScope);
  const snapshot = scoped ? state.snapshot : null;
  const recap = snapshot?.recap;
  const role = scoped ? state.role : null;
  const activeShare =
    scoped &&
    state.activeShare &&
    recapShareBelongsToScope(
      state.activeShare.scopeKey,
      currentScope,
      state.activeShare.share.shareLink.recapVersion,
      recap?.version,
    )
      ? state.activeShare
      : null;
  const selectedExternalFieldIds =
    activeShare?.kind === 'exact-body'
      ? activeShare.selectedExternalFieldIds
      : state.selectedExternalFieldIds;
  const externalEntries =
    state.online && snapshot ? externalFieldEntries(snapshot) : [];
  return {
    activeShareExpiresAt: activeShare?.share.shareLink.expiresAt ?? null,
    activeShareKind: activeShare?.kind ?? null,
    busyAction: scoped ? state.busyAction : null,
    busyExternalAuthority: scoped ? state.busyExternalAuthority : null,
    busyExternalDecision: scoped ? state.busyExternalDecision : null,
    busyExternalFieldId: scoped ? state.busyExternalFieldId : null,
    eventTitle: recap?.title ?? 'Dein Event',
    items:
      recap?.items.map(item => {
        const id = externalFieldId(item.ordinal);
        const requiredAuthorities =
          item.provenance.sourceType === 'event'
            ? (['manager'] as const)
            : (['author', 'manager'] as const);
        const bodyEntry = externalEntries.find(
          entry =>
            entry.consent.ordinal === item.ordinal &&
            entry.consent.field === 'body',
        );
        const captions = externalEntries.filter(
          entry =>
            entry.consent.ordinal === item.ordinal &&
            entry.consent.field === 'caption',
        );
        return {
          body: item.sourceBody,
          externalBody:
            recap.state === 'published' && item.sourceBody !== null
              ? externalViewState(
                  bodyEntry?.consent,
                  requiredAuthorities,
                  selectedExternalFieldIds.includes(id),
                )
              : null,
          externalCaptions:
            recap.state === 'published'
              ? captions.flatMap(entry => {
                  if (entry.consent.field !== 'caption') return [];
                  return [
                    {
                      ...externalViewState(
                        entry.consent,
                        ['author', 'manager'],
                        selectedExternalFieldIds.includes(entry.id),
                      ),
                      attachmentOrdinal: entry.consent.attachmentOrdinal,
                      caption: entry.consent.caption,
                      id: entry.id,
                    },
                  ];
                })
              : [],
          id,
          title: item.sourceTitle,
        };
      }) ?? [],
    message: scoped ? state.message : null,
    online: state.online,
    phase: !scoped
      ? currentScope
        ? 'loading'
        : 'concealed'
      : state.phase === 'loading' || state.phase === 'concealed'
      ? state.phase
      : recap
      ? recap.state
      : 'empty',
    refreshedAt: scoped ? state.snapshot?.refreshedAt ?? null : null,
    role,
  };
}

function selectedExternalSelection(state: RecapScreenState): {
  fieldIds: string[];
  fields: EventRecapExternalField[];
} {
  if (!state.online || !state.snapshot) return { fieldIds: [], fields: [] };
  const selected = new Set(state.selectedExternalFieldIds);
  const selection = {
    fieldIds: [] as string[],
    fields: [] as EventRecapExternalField[],
  };
  for (const entry of externalFieldEntries(state.snapshot)) {
    if (!selected.has(entry.id)) continue;
    selection.fieldIds.push(entry.id);
    selection.fields.push(entry.field);
  }
  return selection;
}

function externalDecisionTarget(
  snapshot: EventRecapSnapshot,
  itemId: string,
): {
  consent: NonNullable<EventRecapSnapshot['externalConsent']>['fields'][number];
  field: EventRecapExternalField;
} | null {
  const entry = externalFieldEntries(snapshot).find(
    candidate => candidate.id === itemId,
  );
  return entry ? { consent: entry.consent, field: entry.field } : null;
}

type ExternalFieldEntry = {
  consent: NonNullable<EventRecapSnapshot['externalConsent']>['fields'][number];
  field: EventRecapExternalField;
  id: string;
};

function externalFieldEntries(
  snapshot: EventRecapSnapshot,
): ExternalFieldEntry[] {
  if (!snapshot.externalConsent) return [];
  const items = new Map(snapshot.recap.items.map(item => [item.ordinal, item]));
  const entries: ExternalFieldEntry[] = [];
  for (const consent of snapshot.externalConsent.fields) {
    const item = items.get(consent.ordinal);
    if (!item) continue;
    if (consent.field === 'body') {
      const field = externalFieldFromItem(item);
      if (field) {
        entries.push({
          consent,
          field,
          id: externalFieldId(consent.ordinal),
        });
      }
      continue;
    }
    if (item.provenance.sourceType !== 'feedEntry') continue;
    entries.push({
      consent,
      field: {
        field: 'caption',
        fieldRef: consent.fieldRef,
        sourceId: item.provenance.sourceId,
        sourceType: 'feedEntry',
        sourceVersion: item.provenance.sourceVersion,
      },
      id: `caption:${consent.fieldRef}`,
    });
  }
  return entries;
}

function externalViewState(
  consent:
    | NonNullable<EventRecapSnapshot['externalConsent']>['fields'][number]
    | undefined,
  requiredAuthorities: readonly ('author' | 'manager')[],
  selected: boolean,
) {
  return {
    actorCanDecide: consent?.actorCanDecide ?? [],
    authorDecision: requiredAuthorities.includes('author')
      ? consent?.authorDecision ?? ('unknown' as const)
      : ('unknown' as const),
    managerDecision: consent?.managerDecision ?? ('unknown' as const),
    requiredAuthorities,
    selected,
  };
}

function externalFieldFromItem(
  item: EventRecapSnapshot['recap']['items'][number],
): EventRecapExternalField | null {
  if (item.sourceBody === null) return null;
  const field = {
    field: 'body' as const,
    sourceId: item.provenance.sourceId,
    sourceVersion: item.provenance.sourceVersion,
  };
  return item.provenance.sourceType === 'event'
    ? { ...field, sourceType: 'event' }
    : { ...field, sourceType: 'feedEntry' };
}

function externalFieldId(ordinal: number) {
  return `moment-${ordinal}`;
}

function isOnline() {
  return onlineManager.isOnline() !== false;
}

function safeRecapMessage(error: unknown) {
  if (error instanceof EventRecapOnlineRequiredError) {
    return 'Für diese Aktion brauchst du eine Verbindung. Es wurde nichts vorgemerkt.';
  }
  if (error instanceof EventRecapExternalApprovalsRequiredError) {
    return 'Die erforderlichen Freigaben konnten nicht sicher bestätigt werden. Es wurde kein Text-Link erstellt.';
  }
  if (
    error instanceof EventRecapManagerRequiredError ||
    error instanceof EventRecapRootAccessDeniedError ||
    error instanceof EventRecapUnavailableError ||
    error instanceof EventRecapAccountChangedError
  ) {
    return 'Dieser Rückblick ist nicht verfügbar.';
  }
  return 'Keine Änderung wurde bestätigt. Bitte versuche es erneut.';
}

function concealsRecap(error: unknown) {
  return (
    error instanceof EventRecapRootAccessDeniedError ||
    error instanceof EventRecapUnavailableError ||
    error instanceof EventRecapAccountChangedError
  );
}

function ignore(promise: Promise<unknown>) {
  promise.catch(() => undefined);
}
