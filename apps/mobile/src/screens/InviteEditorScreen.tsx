import { buildInviteUrl } from '@crew/shared';
import { GatewayClientError } from '@crew/mobile-client';
import { MobileDataStore, type DraftRecord } from '@crew/mobile-data';
import { usePreventRemove } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  findNodeHandle,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useGatewayClient } from '../app/GatewayProvider';
import {
  usePrivateDatabase,
  usePrivateSessionLifecycle,
} from '../app/PrivateBootstrapGate';
import { Button, Card, StatusChip, TextField } from '../design/primitives';
import {
  borders,
  colors,
  componentMetrics,
  elevations,
  motion,
  radii,
  spacing,
  typography,
} from '../design/theme';
import type { RootStackParamList } from '../navigation/types';
import NativeCrewInviteExpiry, {
  type NativeInviteExpirySelection,
} from '../specs/NativeCrewInviteExpiry';
import { secureUuidV4 } from '../storage/secureRandom';
import {
  InviteManagerAccessError,
  inviteManagerSession,
  isRetryableIdempotencyInProgress,
  localInviteManagerRole,
  type InviteManagerRole,
} from './InviteManagerScreen';
import { ScreenFrame, ScreenIcon } from './ScreenFrame';
import { useOnlineState } from './useOnlineState';

const icons = {
  arrowRight: require('../assets/icons/arrow-right.png'),
  cloudOffline: require('../assets/icons/cloud-offline.png'),
  crew: require('../assets/icons/crew.png'),
} as const;
const INVITE_EDITOR_DRAFT_TYPE = 'invite-editor';

export type InviteRole = 'organizer' | 'participant' | 'viewer';
export type InviteEditorForm = {
  email: string;
  expiresAt: string;
  maxUses: string;
  role: InviteRole;
  timeZone: string;
};
type InviteField = keyof InviteEditorForm;

type Props = NativeStackScreenProps<RootStackParamList, 'InviteEditor'>;

type ReadyState = {
  busy: boolean;
  errors: Partial<Record<InviteField, string>>;
  form: InviteEditorForm;
  key: string;
  message: string | null;
  phase: 'ready';
  restored: boolean;
  role: InviteManagerRole;
  roleSource: 'cache' | 'server';
  token: string | null;
};

type State =
  | ReadyState
  | { key: string; phase: 'concealed' }
  | { key: string; phase: 'loading' }
  | { key: string; phase: 'offline' };

type Attempt = {
  idempotencyKey: string;
  inputKey: string;
  invitationId: string;
};

export function InviteEditorScreen({ navigation, route }: Props) {
  const client = useGatewayClient();
  const privateDatabase = usePrivateDatabase();
  const lifecycle = usePrivateSessionLifecycle();
  const online = useOnlineState();
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const rootEventId = route.params.rootEventId;
  const scopeKey =
    lifecycle.status === 'ready' &&
    lifecycle.accountId === privateDatabase.accountId
      ? `${privateDatabase.accountId}:${rootEventId}`
      : null;
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const attemptRef = useRef<Attempt | null>(null);
  const draftWriteRef = useRef<Promise<void>>(Promise.resolve());
  const [authorityRequest, setAuthorityRequest] = useState(0);
  const draftStore = useMemo(
    () => (scopeKey ? new MobileDataStore(privateDatabase.database) : null),
    [privateDatabase.database, scopeKey],
  );
  const [state, setState] = useState<State>({
    key: scopeKey ?? '',
    phase: 'loading',
  });
  const stateRef = useRef(state);
  stateRef.current = state;
  const createBusy =
    state.phase === 'ready' && state.key === scopeKey && state.busy;
  usePreventRemove(createBusy, () => undefined);

  const publish = useCallback(
    (next: State) => {
      if (!scopeKey || scopeRef.current !== scopeKey || next.key !== scopeKey) {
        return;
      }
      stateRef.current = next;
      setState(next);
    },
    [scopeKey],
  );

  useEffect(() => {
    attemptRef.current = null;
    draftWriteRef.current = Promise.resolve();
    setState({
      key: scopeKey ?? '',
      phase: scopeKey ? 'loading' : 'concealed',
    });
  }, [scopeKey]);

  useEffect(() => {
    if (!scopeKey || !draftStore) {
      setState({ key: scopeKey ?? '', phase: 'concealed' });
      return;
    }
    const current = stateRef.current;
    if (
      current.key === scopeKey &&
      current.phase === 'ready' &&
      (current.token ||
        (online && client && current.roleSource === 'server') ||
        ((!online || !client) && current.roleSource === 'cache'))
    ) {
      return;
    }
    let cancelled = false;
    if (current.key !== scopeKey || current.phase !== 'ready') {
      publish({ key: scopeKey, phase: 'loading' });
    }
    const showReady = async (
      role: InviteManagerRole,
      roleSource: ReadyState['roleSource'],
      fallbackMessage: string | null = null,
    ) => {
      await draftWriteRef.current.catch(() => undefined);
      if (cancelled) return;
      const draft = await readInviteDraft(
        draftStore,
        privateDatabase.accountId,
        rootEventId,
      );
      if (!cancelled) {
        publish({
          busy: false,
          errors: validateInviteForm(draft.form, role).errors,
          form: draft.form,
          key: scopeKey,
          message: fallbackMessage ?? draft.message,
          phase: 'ready',
          restored: draft.restored,
          role,
          roleSource,
          token: null,
        });
      }
    };
    const showLocal = async (message: string | null = null) => {
      const memberships = await draftStore.listMemberships(
        privateDatabase.accountId,
        rootEventId,
      );
      const role = localInviteManagerRole(
        memberships,
        privateDatabase.accountId,
        rootEventId,
      );
      if (!role) {
        if (!cancelled) publish({ key: scopeKey, phase: 'offline' });
        return;
      }
      await showReady(role, 'cache', message);
    };
    const load = async () => {
      if (!online || !client) {
        await showLocal();
        return;
      }
      try {
        const { role } = await inviteManagerSession(
          client,
          privateDatabase.accountId,
          rootEventId,
        );
        await showReady(role, 'server');
      } catch (error) {
        if (concealsEditor(error)) {
          if (!cancelled) publish({ key: scopeKey, phase: 'concealed' });
          return;
        }
        await showLocal(
          'Der Serverstand ist gerade nicht erreichbar. Der lokal gespeicherte Entwurf bleibt erhalten.',
        );
      }
    };
    load().catch(() => {
      if (!cancelled) publish({ key: scopeKey, phase: 'offline' });
    });
    return () => {
      cancelled = true;
    };
  }, [
    authorityRequest,
    client,
    draftStore,
    online,
    privateDatabase.accountId,
    publish,
    rootEventId,
    scopeKey,
  ]);

  const persistDraft = useCallback(
    (form: InviteEditorForm) => {
      if (!draftStore || !scopeKey) return;
      const now = new Date().toISOString();
      const draft: DraftRecord = {
        accountUserId: privateDatabase.accountId,
        contentJson: JSON.stringify({
          email: form.email,
          expiresAt: form.expiresAt,
          maxUses: form.maxUses,
          role: form.role,
          schemaVersion: 2,
          timeZone: form.timeZone,
        }),
        createdAt: now,
        entityType: INVITE_EDITOR_DRAFT_TYPE,
        eventId: null,
        id: `${INVITE_EDITOR_DRAFT_TYPE}:${rootEventId}`,
        rootEventId,
        updatedAt: now,
      };
      draftWriteRef.current = draftWriteRef.current
        .catch(() => undefined)
        .then(() => draftStore.putDraft(draft))
        .catch(() => {
          const current = stateRef.current;
          if (
            current.key === scopeKey &&
            current.phase === 'ready' &&
            !current.token
          ) {
            publish({
              ...current,
              message:
                'Der Entwurf konnte nicht sicher gespeichert werden. Lass diesen Bildschirm geöffnet.',
            });
          }
        });
    },
    [draftStore, privateDatabase.accountId, publish, rootEventId, scopeKey],
  );

  const change = useCallback(
    (field: InviteField, value: string) => {
      const current = stateRef.current;
      if (
        !scopeKey ||
        current.key !== scopeKey ||
        current.phase !== 'ready' ||
        current.busy ||
        current.token
      ) {
        return;
      }
      const form = { ...current.form, [field]: value };
      attemptRef.current = null;
      publish({
        ...current,
        errors: validateInviteForm(form, current.role).errors,
        form,
        message: null,
        restored: false,
      });
      persistDraft(form);
    },
    [persistDraft, publish, scopeKey],
  );

  const create = useCallback(async () => {
    const current = stateRef.current;
    if (
      !client ||
      !onlineRef.current ||
      !scopeKey ||
      current.key !== scopeKey ||
      current.phase !== 'ready' ||
      current.busy ||
      current.token
    ) {
      return;
    }
    publish({ ...current, busy: true, message: null });
    try {
      const { role: currentRole, subject } = await inviteManagerSession(
        client,
        privateDatabase.accountId,
        rootEventId,
      );
      const validation = validateInviteForm(current.form, currentRole);
      if (!validation.values) {
        attemptRef.current = null;
        publish({
          ...current,
          busy: false,
          errors: validation.errors,
          message:
            currentRole !== current.role
              ? 'Deine aktuelle Serverrolle wurde übernommen. Prüfe die Auswahl erneut.'
              : null,
          role: currentRole,
          roleSource: 'server',
        });
        return;
      }
      const inputKey = JSON.stringify(validation.values);
      const attempt =
        attemptRef.current?.inputKey === inputKey
          ? attemptRef.current
          : {
              idempotencyKey: secureUuidV4(),
              inputKey,
              invitationId: `inv_${secureUuidV4()}`,
            };
      attemptRef.current = attempt;
      const response = await client.requestAsUser(
        subject,
        'eventInvitationsCreate',
        {
          body: {
            expiresAt: validation.values.expiresAt,
            id: attempt.invitationId,
            maxUses: validation.values.maxUses,
            normalizedEmailHint: validation.values.normalizedEmailHint,
            role: validation.values.role,
          },
          headers: { 'idempotency-key': attempt.idempotencyKey },
          path: { rootEventId },
        },
      );
      const latest = stateRef.current;
      if (
        scopeRef.current !== scopeKey ||
        latest.key !== scopeKey ||
        latest.phase !== 'ready'
      ) {
        return;
      }
      if (!response.data.token) {
        publish({
          ...latest,
          busy: false,
          message:
            'Die Einladung wurde erstellt, der einmalige Link aber nicht bereitgestellt. Versuche denselben Abruf erneut.',
        });
        return;
      }
      attemptRef.current = null;
      publish({
        ...latest,
        busy: false,
        message: null,
        role: currentRole,
        roleSource: 'server',
        token: response.data.token,
      });
      persistDraft(initialInviteForm());
    } catch (error) {
      const latest = stateRef.current;
      if (
        scopeRef.current !== scopeKey ||
        latest.key !== scopeKey ||
        latest.phase !== 'ready'
      ) {
        return;
      }
      if (concealsEditor(error)) {
        attemptRef.current = null;
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
          attemptRef.current = null;
        }
        publish({
          ...latest,
          busy: false,
          message: inProgress
            ? 'Die Einladung wird noch verarbeitet. Versuche es gleich mit denselben Eingaben erneut.'
            : terminalConflict
            ? 'Dieser Versuch kann nicht fortgesetzt werden. Beim nächsten Erstellen beginnt Crew sicher neu.'
            : 'Es wurde keine Einladung bestätigt. Deine Eingaben bleiben erhalten.',
        });
      }
    }
  }, [
    client,
    privateDatabase.accountId,
    persistDraft,
    publish,
    rootEventId,
    scopeKey,
  ]);

  const chooseExpiry = useCallback(async () => {
    const current = stateRef.current;
    if (
      !scopeKey ||
      current.key !== scopeKey ||
      current.phase !== 'ready' ||
      current.busy ||
      current.token
    ) {
      return;
    }
    if (!NativeCrewInviteExpiry) {
      publish({
        ...current,
        message:
          'Die Datumsauswahl ist gerade nicht verfügbar. Deine Eingabe bleibt erhalten.',
      });
      return;
    }
    const minimum = new Date(Math.ceil((Date.now() + 1_000) / 60_000) * 60_000);
    try {
      const result = await NativeCrewInviteExpiry.pickExpiry(
        current.form.expiresAt,
        minimum.toISOString(),
      );
      const latest = stateRef.current;
      if (
        !result ||
        scopeRef.current !== scopeKey ||
        latest.key !== scopeKey ||
        latest.phase !== 'ready' ||
        latest.busy ||
        latest.token
      ) {
        return;
      }
      const selection = validNativeInviteExpirySelection(
        result,
        minimum.getTime(),
      );
      if (!selection) {
        publish({
          ...latest,
          message:
            'Die Datumsauswahl war ungültig. Der bisherige Zeitpunkt bleibt erhalten.',
        });
        return;
      }
      const form = {
        ...latest.form,
        expiresAt: selection.expiresAt,
        timeZone: selection.timeZone,
      };
      attemptRef.current = null;
      publish({
        ...latest,
        errors: validateInviteForm(form, latest.role).errors,
        form,
        message: null,
        restored: false,
      });
      persistDraft(form);
    } catch {
      const latest = stateRef.current;
      if (
        scopeRef.current === scopeKey &&
        latest.key === scopeKey &&
        latest.phase === 'ready'
      ) {
        publish({
          ...latest,
          message:
            'Die Datumsauswahl ist gerade nicht verfügbar. Deine Eingabe bleibt erhalten.',
        });
      }
    }
  }, [persistDraft, publish, scopeKey]);

  const share = useCallback(async () => {
    const current = stateRef.current;
    if (
      !scopeKey ||
      current.key !== scopeKey ||
      current.phase !== 'ready' ||
      !current.token
    ) {
      return;
    }
    try {
      const result = await Share.share({
        message: `Komm zu unserer Crew:\n${buildInviteUrl(current.token)}`,
        title: 'Crew Einladung',
      });
      const latest = stateRef.current;
      if (
        latest.key === scopeKey &&
        latest.phase === 'ready' &&
        latest.token === current.token
      ) {
        publish({
          ...latest,
          message:
            result.action === Share.dismissedAction
              ? 'Noch nicht geteilt. Du kannst es erneut versuchen, solange dieser Bildschirm geöffnet ist.'
              : 'Teilen geöffnet. Der Link bleibt nur auf diesem Bildschirm verfügbar.',
        });
      }
    } catch {
      const latest = stateRef.current;
      if (
        latest.key === scopeKey &&
        latest.phase === 'ready' &&
        latest.token === current.token
      ) {
        publish({
          ...latest,
          message:
            'Teilen wurde nicht abgeschlossen. Du kannst es auf diesem Bildschirm erneut versuchen.',
        });
      }
    }
  }, [publish, scopeKey]);

  const back = () => {
    const current = stateRef.current;
    if (current.phase === 'ready' && current.busy) return;
    attemptRef.current = null;
    if (scopeKey) {
      publish({ key: scopeKey, phase: 'loading' });
    }
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Invites', { rootEventId });
  };
  const clearDraft = () => {
    const current = stateRef.current;
    if (
      !scopeKey ||
      current.key !== scopeKey ||
      current.phase !== 'ready' ||
      current.busy ||
      current.token
    ) {
      return;
    }
    const form = initialInviteForm();
    attemptRef.current = null;
    publish({
      ...current,
      errors: validateInviteForm(form, current.role).errors,
      form,
      message: 'Gespeicherter Entwurf geleert.',
      restored: false,
    });
    persistDraft(form);
  };
  const visibleState =
    scopeKey && state.key === scopeKey
      ? state
      : scopeKey
      ? ({ key: scopeKey, phase: 'loading' } as const)
      : ({ key: '', phase: 'concealed' } as const);

  return (
    <InviteEditorView
      online={online && Boolean(client)}
      onBack={back}
      onChange={change}
      onClearDraft={clearDraft}
      onCreate={create}
      onPickExpiry={chooseExpiry}
      onRetryAuthority={() => setAuthorityRequest(value => value + 1)}
      onShare={share}
      state={visibleState}
    />
  );
}

export function InviteEditorView({
  online,
  onBack,
  onChange,
  onClearDraft,
  onCreate,
  onPickExpiry,
  onRetryAuthority,
  onShare,
  state,
}: {
  online: boolean;
  onBack(): void;
  onChange(field: InviteField, value: string): void;
  onClearDraft(): void;
  onCreate(): void;
  onPickExpiry(): Promise<void>;
  onRetryAuthority(): void;
  onShare(): void;
  state: State;
}) {
  if (state.phase === 'loading') {
    return (
      <ScreenFrame
        description="Crew prüft deine aktuelle Rolle direkt am Server."
        eyebrow="NEUE EINLADUNG"
        testID="invite-editor"
        title="Berechtigung wird geprüft"
      />
    );
  }
  if (state.phase === 'concealed') {
    return (
      <ScreenFrame
        description="Eine Einladung kann mit diesem Konto nicht erstellt werden."
        eyebrow="NEUE EINLADUNG"
        icon={icons.cloudOffline}
        liveRegion="polite"
        statusLabel="Sicher verborgen"
        testID="invite-editor"
        title="Nicht verfügbar"
        tone="brand"
      >
        <Button
          label="Zurück zu Einladungen"
          onPress={onBack}
          testID="invite-editor-back"
          variant="surface"
        />
      </ScreenFrame>
    );
  }
  if (state.phase === 'offline') {
    return (
      <ScreenFrame
        description={
          online
            ? 'Die Serverrolle konnte noch nicht bestätigt werden. Es werden keine Zugriffslinks erstellt.'
            : 'Neue Zugriffslinks werden nie offline vorgemerkt.'
        }
        eyebrow="NEUE EINLADUNG"
        icon={icons.cloudOffline}
        liveRegion="polite"
        statusLabel={
          online ? 'Serverprüfung erforderlich' : 'Verbindung erforderlich'
        }
        testID="invite-editor"
        title={online ? 'Serverprüfung erforderlich' : 'Gerade offline'}
        tone="brand"
      >
        <Button
          disabled={!online}
          label={online ? 'Server erneut prüfen' : 'Verbindung abwarten'}
          onPress={onRetryAuthority}
          testID="invite-editor-retry-authority"
          variant="action"
        />
        <Button
          label="Zurück zu Einladungen"
          onPress={onBack}
          testID="invite-editor-back"
          variant="surface"
        />
      </ScreenFrame>
    );
  }

  if (state.token) {
    return (
      <ScreenFrame
        description="Dieser Link wird nicht in Crew gespeichert. Teile ihn jetzt oder schliesse den Bildschirm."
        eyebrow="EINMALIGER LINK"
        icon={icons.crew}
        liveRegion="polite"
        statusLabel="Einladung erstellt"
        testID="invite-editor"
        title="Deine Einladung ist bereit"
        tone="action"
      >
        <Card tone="surface">
          <Text style={styles.cardTitle}>Nur jetzt verfügbar</Text>
          <Text style={styles.body}>
            Beim Zurückgehen wird der Link aus diesem Bildschirm entfernt. Eine
            abgebrochene Freigabe kannst du hier erneut starten.
          </Text>
        </Card>
        {state.message ? (
          <Card accessibilityLiveRegion="polite" tone="brand">
            <Text style={styles.body}>{state.message}</Text>
          </Card>
        ) : null}
        <View style={styles.actions}>
          <Button
            accessibilityHint="Öffnet das native Teilen-Menü mit dem einmaligen Einladungslink."
            icon={<ScreenIcon source={icons.crew} />}
            label="Einladung teilen"
            onPress={onShare}
            testID="invite-editor-share"
            variant="action"
          />
          <Button
            accessibilityHint="Entfernt den einmaligen Link aus diesem Bildschirm und kehrt zur Übersicht zurück."
            icon={<ScreenIcon source={icons.arrowRight} />}
            label="Fertig"
            onPress={onBack}
            testID="invite-editor-done"
            variant="surface"
          />
        </View>
      </ScreenFrame>
    );
  }

  const locked = state.busy;
  const serverReady = online && state.roleSource === 'server';
  const roles: InviteRole[] =
    state.role === 'owner' || state.form.role === 'organizer'
      ? ['organizer', 'participant', 'viewer']
      : ['participant', 'viewer'];
  return (
    <ScreenFrame
      description="Lege Rolle, optionale E-Mail-Bindung, Ablauf und Anzahl Nutzungen fest."
      eyebrow="NEUE EINLADUNG"
      icon={online ? icons.crew : icons.cloudOffline}
      liveRegion="polite"
      statusLabel={
        online && state.roleSource === 'server'
          ? 'Online · noch nicht erstellt'
          : online
          ? 'Serverprüfung erforderlich · Entwurf lokal'
          : 'Offline · Entwurf lokal gespeichert'
      }
      testID="invite-editor"
      title="Einladung erstellen"
      tone="action"
    >
      <View style={styles.meta}>
        <StatusChip
          label={state.role === 'owner' ? 'Eigentümer:in' : 'Organisator:in'}
          tone="lavender"
        />
        <StatusChip label="Link nur einmal sichtbar" tone="surface" />
        {state.restored ? (
          <StatusChip label="Entwurf wiederaufgenommen" tone="action" />
        ) : null}
      </View>

      <View style={styles.form}>
        <View>
          <Text style={styles.fieldLabel}>Rolle</Text>
          <InviteRolePicker
            disabled={locked}
            onChange={role => onChange('role', role)}
            roles={roles}
            selectedRole={state.form.role}
          />
          {state.errors.role ? (
            <Text
              accessibilityLiveRegion="polite"
              accessibilityRole="alert"
              style={styles.error}
            >
              Fehler: {state.errors.role}
            </Text>
          ) : null}
        </View>
        <TextField
          autoCapitalize="none"
          autoComplete="email"
          autoCorrect={false}
          disabled={locked}
          error={state.errors.email}
          helpText="Optional. Nur das verifizierte Konto mit dieser E-Mail kann beitreten."
          keyboardType="email-address"
          label="E-Mail-Bindung"
          maxLength={254}
          onChangeText={value => onChange('email', value)}
          placeholder="name@beispiel.ch"
          testID="invite-editor-email"
          value={state.form.email}
        />
        <InviteExpiryField
          disabled={locked}
          error={state.errors.expiresAt ?? state.errors.timeZone}
          expiresAt={state.form.expiresAt}
          onPress={onPickExpiry}
          timeZone={state.form.timeZone}
        />
        <TextField
          disabled={locked}
          error={state.errors.maxUses}
          helpText="1 für eine Person, bis 10’000 für einen Gruppenlink"
          keyboardType="number-pad"
          label="Maximale Nutzungen"
          maxLength={5}
          onChangeText={value => onChange('maxUses', value)}
          testID="invite-editor-max-uses"
          value={state.form.maxUses}
        />
      </View>

      {state.message ? (
        <Card accessibilityLiveRegion="polite" tone="brand">
          <Text style={styles.body}>{state.message}</Text>
        </Card>
      ) : null}

      <View style={styles.actions}>
        {state.roleSource === 'cache' ? (
          <Button
            accessibilityHint="Prüft deine aktuelle Rolle erneut am Server. Erstellen bleibt bis zur Bestätigung deaktiviert."
            disabled={!online || locked}
            label={online ? 'Server erneut prüfen' : 'Verbindung abwarten'}
            onPress={onRetryAuthority}
            testID="invite-editor-retry-authority"
            variant="brand"
          />
        ) : null}
        <Button
          accessibilityHint="Prüft die aktuelle Serverrolle und erstellt den Link online. Er wird nur auf dem nächsten Bildschirm gehalten."
          disabled={
            !serverReady || locked || Object.keys(state.errors).length > 0
          }
          icon={<ScreenIcon source={icons.crew} />}
          label={serverReady ? 'Einladung erstellen' : 'Online erstellen'}
          loading={locked}
          onPress={onCreate}
          testID="invite-editor-create"
          variant="action"
        />
        <Button
          accessibilityHint="Überschreibt den lokal gespeicherten Entwurf mit leeren Standardfeldern."
          disabled={locked}
          label="Entwurf leeren"
          onPress={onClearDraft}
          testID="invite-editor-clear-draft"
          variant="surface"
        />
        <Button
          disabled={locked}
          label="Abbrechen"
          onPress={onBack}
          testID="invite-editor-back"
          variant="surface"
        />
      </View>
    </ScreenFrame>
  );
}

function InviteExpiryField({
  disabled,
  error,
  expiresAt,
  onPress,
  timeZone,
}: {
  disabled: boolean;
  error?: string;
  expiresAt: string;
  onPress(): Promise<void>;
  timeZone: string;
}) {
  const triggerRef = useRef<View | null>(null);
  const label = formatInviteExpiry(expiresAt, timeZone);
  const press = async () => {
    await onPress();
    setTimeout(() => {
      setInviteAccessibilityFocus(findNodeHandle(triggerRef.current));
    }, 0);
  };

  return (
    <View>
      <Text style={styles.fieldLabel}>Gültig bis</Text>
      <Pressable
        accessibilityHint="Öffnet die systemeigene Auswahl für Datum und Uhrzeit. Abbrechen behält den bisherigen Zeitpunkt."
        accessibilityLabel="Gültig bis"
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        accessibilityValue={{
          text: `${label}. Lokale Zeitzone ${timeZone}.`,
        }}
        disabled={disabled}
        onPress={press}
        ref={triggerRef}
        style={({ pressed }) => [
          styles.expiryChoice,
          pressed && styles.roleChoicePressed,
          disabled && styles.roleChoiceDisabled,
        ]}
        testID="invite-editor-expires-at"
      >
        <Text style={styles.expiryValue}>{label}</Text>
        <Text style={styles.expiryTimeZone}>Lokale Zeitzone · {timeZone}</Text>
      </Pressable>
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          style={styles.error}
        >
          Fehler: {error}
        </Text>
      ) : (
        <Text style={styles.help}>
          Datum und Uhrzeit werden systemseitig gewählt.
        </Text>
      )}
    </View>
  );
}

function InviteRolePicker({
  disabled,
  onChange,
  roles,
  selectedRole,
}: {
  disabled: boolean;
  onChange(role: InviteRole): void;
  roles: readonly InviteRole[];
  selectedRole: InviteRole;
}) {
  const selectedRef = useRef<View | null>(null);
  useEffect(() => {
    setInviteAccessibilityFocus(findNodeHandle(selectedRef.current));
  }, [selectedRole]);

  return (
    <View
      accessibilityHint="Wähle genau eine Rolle. Beim Fokussieren wird die aktuelle Auswahl angesagt."
      accessibilityLabel="Rolle"
      accessibilityRole="radiogroup"
      style={styles.roleButtons}
    >
      {roles.map(role => {
        const selected = selectedRole === role;
        return (
          <Pressable
            accessibilityHint={`${roleHint(role)} Doppeltippen zum Auswählen.`}
            accessibilityLabel={`${roleLabel(role)}, ${
              selected ? 'ausgewählt' : 'nicht ausgewählt'
            }`}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected, disabled }}
            disabled={disabled}
            key={role}
            onPress={() => onChange(role)}
            ref={selected ? selectedRef : undefined}
            style={({ pressed }) => [
              styles.roleChoice,
              selected ? styles.roleChoiceSelected : styles.roleChoiceDefault,
              pressed && styles.roleChoicePressed,
              disabled && styles.roleChoiceDisabled,
            ]}
            testID={`invite-editor-role-${role}`}
          >
            <Text style={styles.roleChoiceLabel}>{roleLabel(role)}</Text>
            {selected ? (
              <Text style={styles.roleChoiceState}>AUSGEWÄHLT</Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export function validateInviteForm(
  form: InviteEditorForm,
  managerRole: InviteManagerRole,
): {
  errors: Partial<Record<InviteField, string>>;
  values: {
    expiresAt: string;
    maxUses: number;
    normalizedEmailHint: string | null;
    role: InviteRole;
  } | null;
} {
  const errors: Partial<Record<InviteField, string>> = {};
  if (managerRole === 'organizer' && form.role === 'organizer') {
    errors.role =
      'Nur Eigentümer:innen können weitere Organisator:innen einladen.';
  }
  const normalizedEmailHint = form.email.trim().toLowerCase();
  if (
    normalizedEmailHint &&
    (normalizedEmailHint.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmailHint))
  ) {
    errors.email = 'Verwende eine gültige E-Mail-Adresse.';
  }
  const expiry = exactInviteExpiry(form.expiresAt);
  if (!expiry || expiry.getTime() <= Date.now()) {
    errors.expiresAt = 'Wähle einen zukünftigen Zeitpunkt.';
  }
  if (!validInviteTimeZone(form.timeZone)) {
    errors.timeZone = 'Die lokale Zeitzone ist nicht verfügbar.';
  }
  const maxUses = Number(form.maxUses);
  if (
    !/^\d+$/.test(form.maxUses) ||
    !Number.isInteger(maxUses) ||
    maxUses < 1 ||
    maxUses > 10_000
  ) {
    errors.maxUses = 'Gib eine ganze Zahl von 1 bis 10’000 ein.';
  }
  if (Object.keys(errors).length > 0 || !expiry) {
    return { errors, values: null };
  }
  return {
    errors,
    values: {
      expiresAt: expiry.toISOString(),
      maxUses,
      normalizedEmailHint: normalizedEmailHint || null,
      role: form.role,
    },
  };
}

function initialInviteForm(): InviteEditorForm {
  const expiresAt = new Date(Date.now() + 7 * 86_400_000);
  expiresAt.setSeconds(0, 0);
  return {
    email: '',
    expiresAt: expiresAt.toISOString(),
    maxUses: '1',
    role: 'participant',
    timeZone: localInviteTimeZone(),
  };
}

async function readInviteDraft(
  store: Pick<MobileDataStore, 'listDrafts'>,
  accountUserId: string,
  rootEventId: string,
): Promise<{
  form: InviteEditorForm;
  message: string | null;
  restored: boolean;
}> {
  try {
    const saved = (await store.listDrafts(accountUserId, rootEventId))
      .filter(draft => draft.entityType === INVITE_EDITOR_DRAFT_TYPE)
      .at(-1);
    const parsed = saved ? inviteFormFromDraft(saved) : null;
    if (!parsed) {
      return { form: initialInviteForm(), message: null, restored: false };
    }
    return {
      form: parsed,
      message: null,
      restored: true,
    };
  } catch {
    return {
      form: initialInviteForm(),
      message:
        'Der gespeicherte Entwurf konnte nicht geladen werden. Du kannst mit einem neuen beginnen.',
      restored: false,
    };
  }
}

function inviteFormFromDraft(draft: DraftRecord): InviteEditorForm | null {
  try {
    const value = JSON.parse(draft.contentJson) as Record<string, unknown>;
    if (
      value.schemaVersion !== 2 ||
      typeof value.email !== 'string' ||
      typeof value.expiresAt !== 'string' ||
      typeof value.maxUses !== 'string' ||
      typeof value.timeZone !== 'string' ||
      !exactInviteExpiry(value.expiresAt) ||
      !validInviteTimeZone(value.timeZone) ||
      (value.role !== 'organizer' &&
        value.role !== 'participant' &&
        value.role !== 'viewer')
    ) {
      return null;
    }
    return {
      email: value.email,
      expiresAt: value.expiresAt,
      maxUses: value.maxUses,
      role: value.role,
      timeZone: value.timeZone,
    };
  } catch {
    return null;
  }
}

function exactInviteExpiry(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value
    ? date
    : null;
}

function validInviteTimeZone(value: string) {
  if (!value || value.length > 128) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function localInviteTimeZone() {
  const timeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  return validInviteTimeZone(timeZone) ? timeZone : 'UTC';
}

function formatInviteExpiry(expiresAt: string, timeZone: string) {
  const expiry = exactInviteExpiry(expiresAt);
  if (!expiry || !validInviteTimeZone(timeZone)) {
    return 'Zeitpunkt nicht verfügbar';
  }
  return new Intl.DateTimeFormat('de-CH', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone,
  }).format(expiry);
}

export function validNativeInviteExpirySelection(
  selection: NativeInviteExpirySelection,
  minimumTime: number,
) {
  if (
    typeof selection?.expiresAt !== 'string' ||
    typeof selection.timeZone !== 'string'
  ) {
    return null;
  }
  const expiry = exactInviteExpiry(selection.expiresAt);
  if (
    !expiry ||
    expiry.getTime() < minimumTime ||
    !validInviteTimeZone(selection.timeZone)
  ) {
    return null;
  }
  return selection;
}

export function setInviteAccessibilityFocus(node: number | null) {
  if (node) AccessibilityInfo.setAccessibilityFocus(node);
}

function roleLabel(role: InviteRole) {
  if (role === 'organizer') return 'Organisieren';
  if (role === 'viewer') return 'Nur ansehen';
  return 'Teilnehmen';
}

function roleHint(role: InviteRole) {
  if (role === 'organizer') return 'Kann das Event mitorganisieren.';
  if (role === 'viewer') return 'Kann Eventinhalte nur ansehen.';
  return 'Kann am Event teilnehmen und mit der Crew interagieren.';
}

function concealsEditor(error: unknown) {
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
    marginBottom: spacing.sm,
  },
  error: {
    ...typography.caption,
    color: colors.error,
    marginTop: spacing.sm,
  },
  expiryChoice: {
    ...elevations.control,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.control,
    borderWidth: borders.strong,
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: componentMetrics.control.minimumTouchSize,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  expiryTimeZone: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  expiryValue: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  fieldLabel: {
    ...typography.label,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  form: {
    gap: spacing.lg,
  },
  help: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  meta: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  roleButtons: {
    gap: spacing.sm,
  },
  roleChoice: {
    ...elevations.control,
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: borders.strong,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: componentMetrics.control.minimumTouchSize,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  roleChoiceDefault: {
    backgroundColor: colors.surface,
  },
  roleChoiceDisabled: {
    opacity: componentMetrics.control.disabledOpacity,
  },
  roleChoiceLabel: {
    ...typography.bodyStrong,
    color: colors.text,
    flexShrink: 1,
    textAlign: 'center',
  },
  roleChoicePressed: {
    ...elevations.pressed,
    transform: [
      { translateX: motion.press.controlOffset },
      { translateY: motion.press.controlOffset },
    ],
  },
  roleChoiceSelected: {
    backgroundColor: colors.surfaceBrand,
  },
  roleChoiceState: {
    ...typography.caption,
    color: colors.text,
  },
});
