import {
  GatewayClientError,
  type GatewaySessionSubject,
  type components,
} from '@crew/mobile-client';
import {
  MobileDataStore,
  type InvitationRecord,
  type MembershipRecord,
} from '@crew/mobile-data';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import type { MobileGatewayClient } from '../app/GatewayProvider';
import { useGatewayClient } from '../app/GatewayProvider';
import {
  usePrivateDatabase,
  usePrivateSessionLifecycle,
} from '../app/PrivateBootstrapGate';
import { Button, Card, StatusChip } from '../design/primitives';
import { colors, spacing, typography } from '../design/theme';
import type { RootStackParamList } from '../navigation/types';
import { secureUuidV4 } from '../storage/secureRandom';
import { ScreenFrame, ScreenIcon } from './ScreenFrame';
import { useOnlineState } from './useOnlineState';

const icons = {
  arrowRight: require('../assets/icons/arrow-right.png'),
  cloudOffline: require('../assets/icons/cloud-offline.png'),
  crew: require('../assets/icons/crew.png'),
} as const;
const INVITE_PAGE_LIMIT = 200;
const MAX_INVITE_PAGES = 25;

export type InviteManagerRole = 'organizer' | 'owner';
export type InvitationSummary =
  components['schemas']['EventServiceEventInvitationAdminSummary'];

type Props = NativeStackScreenProps<RootStackParamList, 'Invites'>;

type ReadyState = {
  activeMemberCount: number;
  busyInvitationId: string | null;
  items: InvitationSummary[];
  key: string;
  message: string | null;
  phase: 'ready';
  refreshFailed: boolean;
  refreshing: boolean;
  role: InviteManagerRole;
  source: 'cache' | 'server';
};

type State =
  | ReadyState
  | { key: string; phase: 'concealed' }
  | { key: string; phase: 'loading' }
  | { key: string; phase: 'offline' };

type RevokeAttempt = {
  idempotencyKey: string;
  inputKey: string;
};

export class InviteManagerAccessError extends Error {
  constructor() {
    super('Invite manager unavailable');
    this.name = 'InviteManagerAccessError';
  }
}

export async function inviteManagerSession(
  client: MobileGatewayClient,
  accountUserId: string,
  rootEventId: string,
): Promise<{
  activeMemberCount: number;
  role: InviteManagerRole;
  subject: GatewaySessionSubject;
}> {
  const subject = await client.sessionSubject();
  if (!subject || subject.userId !== accountUserId) {
    throw new InviteManagerAccessError();
  }

  let cursor: string | undefined;
  let role: InviteManagerRole | null = null;
  const activeMemberIds = new Set<string>();
  const seen = new Set<string>();
  let complete = false;
  for (let page = 0; page < MAX_INVITE_PAGES; page += 1) {
    const response = await client.requestAsUser(
      subject,
      'eventMembershipsList',
      {
        path: { rootEventId },
        query: { cursor, limit: INVITE_PAGE_LIMIT },
      },
    );
    for (const membership of response.data.items) {
      if (membership.status !== 'active') continue;
      activeMemberIds.add(membership.userId);
      if (
        membership.userId === accountUserId &&
        (membership.role === 'owner' || membership.role === 'organizer')
      ) {
        role = membership.role;
      }
    }
    const next = checkedNextCursor(response.data.pageInfo, seen);
    if (!next) {
      complete = true;
      break;
    }
    cursor = next;
  }

  if (!complete) throw new InvitePaginationError();
  if (!role) throw new InviteManagerAccessError();
  return { activeMemberCount: activeMemberIds.size, role, subject };
}

export async function listInvitations(
  client: MobileGatewayClient,
  accountUserId: string,
  rootEventId: string,
): Promise<{
  activeMemberCount: number;
  items: InvitationSummary[];
  role: InviteManagerRole;
}> {
  const { activeMemberCount, role, subject } = await inviteManagerSession(
    client,
    accountUserId,
    rootEventId,
  );
  const items: InvitationSummary[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  let complete = false;
  for (let page = 0; page < MAX_INVITE_PAGES; page += 1) {
    const response = await client.requestAsUser(
      subject,
      'eventInvitationsList',
      {
        path: { rootEventId },
        query: { cursor, limit: INVITE_PAGE_LIMIT },
      },
    );
    items.push(...response.data.items);
    const next = checkedNextCursor(response.data.pageInfo, seen);
    if (!next) {
      complete = true;
      break;
    }
    cursor = next;
  }
  if (!complete) throw new InvitePaginationError();
  return { activeMemberCount, items, role };
}

export function InviteManagerScreen({ navigation, route }: Props) {
  const client = useGatewayClient();
  const privateDatabase = usePrivateDatabase();
  const lifecycle = usePrivateSessionLifecycle();
  const online = useOnlineState();
  const rootEventId = route.params.rootEventId;
  const scopeKey =
    lifecycle.status === 'ready' &&
    lifecycle.accountId === privateDatabase.accountId
      ? `${privateDatabase.accountId}:${rootEventId}`
      : null;
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const operationEpochRef = useRef(0);
  const revokeAttemptRef = useRef<RevokeAttempt | null>(null);
  const serverConfirmedRef = useRef<ReadyState | null>(null);
  const [refreshRequest, setRefreshRequest] = useState(0);
  const [state, setState] = useState<State>({
    key: scopeKey ?? '',
    phase: 'loading',
  });
  const stateRef = useRef(state);
  stateRef.current = state;

  const publish = useCallback(
    (next: State) => {
      if (!scopeKey || next.key !== scopeKey || scopeRef.current !== scopeKey) {
        return;
      }
      stateRef.current = next;
      setState(next);
    },
    [scopeKey],
  );

  useEffect(() => {
    operationEpochRef.current += 1;
    revokeAttemptRef.current = null;
    serverConfirmedRef.current = null;
  }, [scopeKey]);

  useEffect(() => {
    if (!scopeKey) {
      setState({ key: '', phase: 'concealed' });
      return;
    }

    let cancelled = false;
    const operationEpoch = ++operationEpochRef.current;
    const operationIsCurrent = () =>
      !cancelled &&
      operationEpochRef.current === operationEpoch &&
      scopeRef.current === scopeKey;
    const load = async () => {
      if (online && client) {
        const confirmed =
          serverConfirmedRef.current?.key === scopeKey
            ? serverConfirmedRef.current
            : null;
        if (confirmed) {
          publish({
            ...confirmed,
            message: null,
            refreshing: true,
          });
        } else {
          publish({ key: scopeKey, phase: 'loading' });
        }
        try {
          const result = await listInvitations(
            client,
            privateDatabase.accountId,
            rootEventId,
          );
          if (operationIsCurrent()) {
            const next: ReadyState = {
              activeMemberCount: result.activeMemberCount,
              busyInvitationId: null,
              items: result.items,
              key: scopeKey,
              message: null,
              phase: 'ready',
              refreshFailed: false,
              refreshing: false,
              role: result.role,
              source: 'server',
            };
            serverConfirmedRef.current = next;
            publish(next);
          }
        } catch (error) {
          if (operationIsCurrent()) {
            if (concealsInvites(error)) {
              serverConfirmedRef.current = null;
              publish({ key: scopeKey, phase: 'concealed' });
            } else if (confirmed) {
              publish({
                ...confirmed,
                message:
                  'Der Serverstand konnte nicht aktualisiert werden. Der in dieser Sitzung bestätigte Stand bleibt sichtbar.',
                refreshFailed: true,
                refreshing: false,
              });
            } else {
              publish({ key: scopeKey, phase: 'offline' });
            }
          }
        }
        return;
      }

      const store = new MobileDataStore(privateDatabase.database);
      try {
        const [memberships, invitations] = await Promise.all([
          store.listMemberships(privateDatabase.accountId, rootEventId),
          store.listInvitations(privateDatabase.accountId, rootEventId),
        ]);
        const role = localInviteManagerRole(
          memberships,
          privateDatabase.accountId,
          rootEventId,
        );
        if (role) {
          if (operationIsCurrent()) {
            publish({
              activeMemberCount: activeMembershipCount(
                memberships,
                rootEventId,
              ),
              busyInvitationId: null,
              items: invitations.map(safeInvitationSummary),
              key: scopeKey,
              message: null,
              phase: 'ready',
              refreshFailed: false,
              refreshing: false,
              role,
              source: 'cache',
            });
          }
          return;
        }
      } catch {
        // Fall through to the neutral unavailable state.
      }
      if (operationIsCurrent()) {
        publish({ key: scopeKey, phase: 'offline' });
      }
    };
    load().catch(() => {
      if (operationIsCurrent()) publish({ key: scopeKey, phase: 'offline' });
    });
    return () => {
      cancelled = true;
    };
  }, [
    client,
    online,
    privateDatabase.accountId,
    privateDatabase.database,
    publish,
    refreshRequest,
    rootEventId,
    scopeKey,
  ]);

  const revoke = useCallback(
    async (invitation: InvitationSummary) => {
      const current = stateRef.current;
      if (
        !client ||
        !online ||
        !scopeKey ||
        current.key !== scopeKey ||
        current.phase !== 'ready' ||
        current.busyInvitationId
      ) {
        return;
      }
      const operationEpoch = ++operationEpochRef.current;
      publish({
        ...current,
        busyInvitationId: invitation.id,
        message: null,
        refreshing: false,
      });
      try {
        const { subject } = await inviteManagerSession(
          client,
          privateDatabase.accountId,
          rootEventId,
        );
        const inputKey = `${rootEventId}:${invitation.id}:${invitation.version}`;
        const attempt =
          revokeAttemptRef.current?.inputKey === inputKey
            ? revokeAttemptRef.current
            : { idempotencyKey: secureUuidV4(), inputKey };
        revokeAttemptRef.current = attempt;
        const { invitation: revoked } = (
          await client.requestAsUser(subject, 'eventInvitationsRevoke', {
            body: { baseVersion: invitation.version },
            headers: { 'idempotency-key': attempt.idempotencyKey },
            path: { invitationId: invitation.id, rootEventId },
          })
        ).data;
        const latest = stateRef.current;
        if (
          operationEpochRef.current !== operationEpoch ||
          scopeRef.current !== scopeKey ||
          latest.key !== scopeKey ||
          latest.phase !== 'ready'
        ) {
          return;
        }
        revokeAttemptRef.current = null;
        const next: ReadyState = {
          ...latest,
          busyInvitationId: null,
          items: latest.items.map(item =>
            item.id === revoked.id
              ? {
                  createdAt: revoked.createdAt,
                  emailBound: revoked.normalizedEmailHint !== null,
                  expiresAt: revoked.expiresAt,
                  id: revoked.id,
                  maxUses: revoked.maxUses,
                  role: revoked.role,
                  rootEventId: revoked.rootEventId,
                  status: revoked.status,
                  updatedAt: revoked.updatedAt,
                  useCount: revoked.useCount,
                  version: revoked.version,
                }
              : item,
          ),
          message: 'Einladung widerrufen.',
          refreshFailed: false,
          refreshing: false,
          source: 'server',
        };
        serverConfirmedRef.current = next;
        publish(next);
      } catch (error) {
        const latest = stateRef.current;
        if (
          operationEpochRef.current !== operationEpoch ||
          scopeRef.current !== scopeKey ||
          latest.key !== scopeKey ||
          latest.phase !== 'ready'
        ) {
          return;
        }
        if (concealsInvites(error)) {
          revokeAttemptRef.current = null;
          serverConfirmedRef.current = null;
          publish({ key: scopeKey, phase: 'concealed' });
        } else {
          const inProgress = isRetryableIdempotencyInProgress(error);
          const terminalConflict =
            error instanceof GatewayClientError &&
            error.status === 409 &&
            !inProgress;
          if (
            terminalConflict ||
            (error instanceof GatewayClientError && error.status === 400)
          ) {
            revokeAttemptRef.current = null;
          }
          publish({
            ...latest,
            busyInvitationId: null,
            message:
              inProgress
                ? 'Der Widerruf wird noch verarbeitet. Versuche es gleich erneut.'
                : terminalConflict
                ? 'Der Widerruf kann mit diesem Serverstand nicht fortgesetzt werden. Lade die Liste neu.'
                : 'Die Einladung konnte nicht widerrufen werden. Es wurde nichts bestätigt.',
            refreshing: false,
          });
        }
      }
    },
    [
      client,
      online,
      privateDatabase.accountId,
      publish,
      rootEventId,
      scopeKey,
    ],
  );

  const visibleState =
    scopeKey && state.key === scopeKey
      ? state
      : scopeKey
      ? ({ key: scopeKey, phase: 'loading' } as const)
      : ({ key: '', phase: 'concealed' } as const);

  return (
    <InviteManagerView
      online={online && Boolean(client)}
      onBack={() => {
        if (navigation.canGoBack()) navigation.goBack();
        else navigation.navigate('EventInbound', { rootEventId });
      }}
      onCreate={() => navigation.navigate('InviteEditor', { rootEventId })}
      onRefresh={() => {
        const current = stateRef.current;
        if (current.phase === 'ready') {
          if (current.busyInvitationId || current.refreshing) return;
          publish({
            ...current,
            message: null,
            refreshing: true,
          });
        }
        setRefreshRequest(value => value + 1);
      }}
      onRevoke={invitation =>
        Alert.alert(
          'Einladung widerrufen?',
          'Der vorhandene Link kann danach nicht mehr verwendet werden.',
          [
            { style: 'cancel', text: 'Abbrechen' },
            {
              onPress: () => revoke(invitation),
              style: 'destructive',
              text: 'Widerrufen',
            },
          ],
        )
      }
      state={visibleState}
    />
  );
}

export function InviteManagerView({
  online,
  onBack,
  onCreate,
  onRefresh,
  onRevoke,
  state,
}: {
  online: boolean;
  onBack(): void;
  onCreate(): void;
  onRefresh(): void;
  onRevoke(invitation: InvitationSummary): void;
  state: State;
}) {
  if (state.phase === 'loading') {
    return (
      <ScreenFrame
        description="Crew prüft deine aktuelle Rolle und lädt nur sichere Einladungsübersichten."
        eyebrow="EINLADUNGEN"
        testID="invite-manager"
        title="Einladungen werden geladen"
      />
    );
  }
  if (state.phase === 'concealed') {
    return (
      <ScreenFrame
        description="Diese Einladungsverwaltung ist für dieses Konto nicht verfügbar."
        eyebrow="EINLADUNGEN"
        icon={icons.cloudOffline}
        liveRegion="polite"
        statusLabel="Sicher verborgen"
        testID="invite-manager"
        title="Einladungen nicht verfügbar"
        tone="brand"
      >
        <Button
          label="Zurück zum Event"
          onPress={onBack}
          testID="invite-manager-back"
          variant="surface"
        />
      </ScreenFrame>
    );
  }
  if (state.phase === 'offline') {
    return (
      <ScreenFrame
        description="Ohne aktuelle Serverprüfung zeigt Crew keine gespeicherten Einladungen an."
        eyebrow="EINLADUNGEN"
        icon={icons.cloudOffline}
        liveRegion="polite"
        statusLabel="Sicher verborgen"
        testID="invite-manager"
        title="Serverprüfung erforderlich"
        tone="brand"
      >
        <Button
          disabled={!online}
          label={online ? 'Erneut versuchen' : 'Verbindung abwarten'}
          onPress={onRefresh}
          testID="invite-manager-retry"
          variant="action"
        />
        <Button
          label="Zurück zum Event"
          onPress={onBack}
          testID="invite-manager-back"
          variant="surface"
        />
      </ScreenFrame>
    );
  }

  return (
    <ScreenFrame
      description="Erstelle persönliche oder mehrfach nutzbare Links und behalte Ablauf und Nutzung im Blick."
      eyebrow="EINLADUNGEN"
      icon={online ? icons.crew : icons.cloudOffline}
      liveRegion="polite"
      statusLabel={
        !online
          ? 'Offline · sicher gespeichert'
          : state.refreshing
          ? 'Serverstand wird aktualisiert'
          : state.source === 'server'
          ? 'Serverstand aktuell'
          : 'Lokal verfügbar · Server wird geladen'
      }
      testID="invite-manager"
      title="Einladungen"
      tone="action"
    >
      <View style={styles.meta}>
        <StatusChip
          label={
            state.role === 'owner' ? 'Eigentümer:in' : 'Organisator:in'
          }
          tone="lavender"
        />
        <StatusChip
          label={`${state.activeMemberCount} ${
            state.activeMemberCount === 1 ? 'Mitglied' : 'Mitglieder'
          }`}
          tone="surface"
        />
        <StatusChip
          label={`${state.items.length} ${
            state.items.length === 1 ? 'Einladung' : 'Einladungen'
          }`}
          tone="surface"
        />
      </View>

      <Button
        accessibilityHint="Öffnet ein Formular. Der neue Link wird nur einmal auf diesem Bildschirm bereitgestellt."
        disabled={
          !online || state.refreshing || state.busyInvitationId !== null
        }
        icon={<ScreenIcon source={icons.crew} />}
        label={online ? 'Einladung erstellen' : 'Verbindung abwarten'}
        onPress={onCreate}
        testID="invite-manager-create"
        variant="action"
      />

      <View accessibilityRole="list" style={styles.list}>
        {state.items.length === 0 ? (
          <Card tone="surface">
            <Text style={styles.cardTitle}>Noch keine Einladungen</Text>
            <Text style={styles.body}>
              Erstelle den ersten Link für deine Crew.
            </Text>
          </Card>
        ) : (
          state.items.map(invitation => {
            const presentation = invitationPresentation(invitation);
            const remainingUses = Math.max(
              invitation.maxUses - invitation.useCount,
              0,
            );
            const revocable =
              online &&
              !state.refreshing &&
              presentation.state === 'active' &&
              state.busyInvitationId === null;
            return (
              <Card
                key={invitation.id}
                style={styles.invitation}
                testID={`invite-manager-item-${invitation.id}`}
                tone={presentation.tone}
              >
                <View
                  accessible
                  accessibilityLabel={`${roleLabel(
                    invitation.role,
                  )}. ${presentation.label}. Ablauf: ${formatExpiry(
                    invitation.expiresAt,
                  )}. ${invitation.useCount} von ${
                    invitation.maxUses
                  } genutzt. ${remainingUses} ${
                    remainingUses === 1 ? 'Nutzung' : 'Nutzungen'
                  } verbleibend. ${
                    invitation.emailBound
                      ? 'An E-Mail gebunden.'
                      : 'Offener Link.'
                  }`}
                  accessibilityRole="summary"
                >
                  <View style={styles.meta}>
                    <StatusChip
                      label={roleLabel(invitation.role)}
                      tone="surface"
                    />
                    <StatusChip label={presentation.label} tone="lavender" />
                  </View>
                  <Text style={styles.cardTitle}>
                    {invitation.emailBound
                      ? 'An E-Mail gebunden'
                      : 'Für deine Crew'}
                  </Text>
                  <Text style={styles.body}>
                    {formatExpiry(invitation.expiresAt)} ·{' '}
                    {invitation.useCount} von {invitation.maxUses} genutzt ·{' '}
                    {remainingUses} übrig
                  </Text>
                </View>
                {presentation.state === 'active' ? (
                  <Button
                    accessibilityHint="Widerruft diesen Link nach einer Bestätigung dauerhaft."
                    disabled={!revocable}
                    label={
                      state.busyInvitationId === invitation.id
                        ? 'Wird widerrufen'
                        : online
                        ? 'Einladung widerrufen'
                        : 'Offline nicht möglich'
                    }
                    loading={state.busyInvitationId === invitation.id}
                    onPress={() => onRevoke(invitation)}
                    testID={`invite-manager-revoke-${invitation.id}`}
                    variant="surface"
                  />
                ) : null}
              </Card>
            );
          })
        )}
      </View>

      {state.message ? (
        <Card accessibilityLiveRegion="polite" tone="brand">
          <Text style={styles.body}>{state.message}</Text>
        </Card>
      ) : null}

      <View style={styles.actions}>
        <Button
          accessibilityHint="Lädt Rollen und Einladungen erneut vom Server."
          disabled={
            !online || state.refreshing || state.busyInvitationId !== null
          }
          icon={<ScreenIcon source={icons.cloudOffline} />}
          label={
            state.refreshing
              ? 'Wird aktualisiert'
              : state.refreshFailed
              ? 'Erneut versuchen'
              : 'Serverstand neu laden'
          }
          onPress={onRefresh}
          testID="invite-manager-refresh"
          variant="surface"
        />
        <Button
          icon={<ScreenIcon source={icons.arrowRight} />}
          label="Zurück zum Event"
          onPress={onBack}
          testID="invite-manager-back"
          variant="surface"
        />
      </View>
    </ScreenFrame>
  );
}

function invitationPresentation(invitation: InvitationSummary): {
  label: string;
  state: 'active' | 'expired' | 'revoked' | 'unknown' | 'used';
  tone: 'action' | 'brand' | 'surface';
} {
  if (invitation.status === 'revoked') {
    return { label: 'Widerrufen', state: 'revoked', tone: 'surface' };
  }
  const expiresAt = Date.parse(invitation.expiresAt);
  if (!Number.isFinite(expiresAt)) {
    return { label: 'Ablauf unklar', state: 'unknown', tone: 'surface' };
  }
  if (expiresAt <= Date.now()) {
    return { label: 'Abgelaufen', state: 'expired', tone: 'surface' };
  }
  if (invitation.useCount >= invitation.maxUses) {
    return { label: 'Vollständig genutzt', state: 'used', tone: 'surface' };
  }
  return { label: 'Aktiv', state: 'active', tone: 'action' };
}

function roleLabel(role: InvitationSummary['role']) {
  if (role === 'organizer') return 'Organisator:in';
  if (role === 'viewer') return 'Nur ansehen';
  return 'Teilnehmen';
}

function formatExpiry(expiresAt: string) {
  const value = Date.parse(expiresAt);
  if (!Number.isFinite(value)) return 'Datum nicht verfügbar';
  return new Intl.DateTimeFormat('de-CH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function checkedNextCursor(
  pageInfo: { hasMore: boolean; nextCursor?: string | null },
  seen: Set<string>,
) {
  const next = pageInfo.nextCursor;
  if (!pageInfo.hasMore) {
    if (next !== null && next !== undefined) throw new InvitePaginationError();
    return null;
  }
  if (!next || seen.has(next)) throw new InvitePaginationError();
  seen.add(next);
  return next;
}

class InvitePaginationError extends Error {
  constructor() {
    super('Invite pagination incomplete');
    this.name = 'InvitePaginationError';
  }
}

export function isRetryableIdempotencyInProgress(error: unknown) {
  return (
    error instanceof GatewayClientError &&
    error.status === 409 &&
    error.code === 'IDEMPOTENCY_IN_PROGRESS' &&
    error.retryable
  );
}

function concealsInvites(error: unknown) {
  return (
    error instanceof InviteManagerAccessError ||
    (error instanceof GatewayClientError &&
      (error.status === 401 ||
        error.status === 403 ||
        error.status === 404 ||
        error.code === 'session_changed' ||
        error.code === 'unauthenticated'))
  );
}

export function localInviteManagerRole(
  memberships: readonly MembershipRecord[],
  accountUserId: string,
  rootEventId: string,
): InviteManagerRole | null {
  const membership = memberships.find(
    item =>
      item.memberUserId === accountUserId &&
      item.rootEventId === rootEventId &&
      item.status === 'active',
  );
  return membership?.role === 'owner' || membership?.role === 'organizer'
    ? membership.role
    : null;
}

function safeInvitationSummary(
  invitation: InvitationRecord,
): InvitationSummary {
  return {
    createdAt: invitation.createdAt,
    emailBound: invitation.emailBound,
    expiresAt: invitation.expiresAt,
    id: invitation.id,
    maxUses: invitation.maxUses,
    role: invitation.role,
    rootEventId: invitation.rootEventId,
    status: invitation.status,
    updatedAt: invitation.updatedAt,
    useCount: invitation.useCount,
    version: invitation.version,
  };
}

function activeMembershipCount(
  memberships: readonly MembershipRecord[],
  rootEventId: string,
) {
  return new Set(
    memberships
      .filter(
        membership =>
          membership.rootEventId === rootEventId &&
          membership.status === 'active',
      )
      .map(membership => membership.memberUserId),
  ).size;
}

const styles = StyleSheet.create({
  actions: {
    gap: spacing.md,
  },
  body: {
    ...typography.body,
    color: colors.text,
  },
  cardTitle: {
    ...typography.subheading,
    color: colors.text,
  },
  invitation: {
    gap: spacing.md,
  },
  list: {
    gap: spacing.md,
  },
  meta: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
