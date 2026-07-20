import { MobileSyncRootAccessDeniedError } from '@crew/mobile-data';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import type { ImageSourcePropType } from 'react-native';
import {
  AccessibilityInfo,
  Clipboard,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useGatewayClient } from '../app/GatewayProvider';
import {
  usePrivateDatabase,
  usePrivateSessionLifecycle,
} from '../app/PrivateBootstrapGate';
import {
  Button,
  Card,
  StatusChip,
  SyncStatus,
  TextField,
} from '../design/primitives';
import { colors, spacing, typography } from '../design/theme';
import type { RootStackParamList } from '../navigation/types';
import {
  TEAM_FEED_MAX_LENGTH,
  TeamProductionRuntime,
  type TeamFeedEntryViewModel,
  type TeamFeedViewModel,
} from '../team/TeamProductionRuntime';
import { ScreenFrame, ScreenIcon } from './ScreenFrame';
import { TeamRouteStateView } from './TeamRouteStateView';
import { useOnlineState } from './useOnlineState';

const icons = {
  chat: require('../assets/icons/chat.png'),
  check: require('../assets/icons/check.png'),
  cloudOffline: require('../assets/icons/cloud-offline.png'),
} satisfies Record<string, ImageSourcePropType>;

type Props = NativeStackScreenProps<RootStackParamList, 'TeamFeed'>;

type ReadyState = {
  key: string;
  model: TeamFeedViewModel;
  runtime: TeamProductionRuntime;
  status: 'ready';
};

type LoadState =
  | ReadyState
  | { key: string; status: 'concealed' }
  | { key: string; status: 'loading' };

export function TeamFeedScreen({ navigation, route }: Props) {
  const client = useGatewayClient();
  const privateDatabase = usePrivateDatabase();
  const lifecycle = usePrivateSessionLifecycle();
  const online = useOnlineState();
  const activeAccountRef = useRef(lifecycle.accountId);
  activeAccountRef.current = lifecycle.accountId;
  const rootEventId = route.params.rootEventId;
  const eventId = route.params.eventId ?? null;
  const scopeKey =
    lifecycle.status === 'ready' &&
    lifecycle.accountId === privateDatabase.accountId
      ? `${privateDatabase.accountId}:${rootEventId}:${eventId ?? 'root'}`
      : null;
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [refreshRequest, setRefreshRequest] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [state, setState] = useState<LoadState>({
    key: scopeKey ?? '',
    status: 'loading',
  });

  useEffect(() => {
    setDraft('');
    setError(null);
    setSubmitting(false);
  }, [scopeKey]);

  useEffect(() => {
    if (!scopeKey) {
      setState({ key: '', status: 'concealed' });
      return;
    }
    let cancelled = false;
    const accountUserId = privateDatabase.accountId;
    const publish = (next: LoadState) => {
      if (
        !cancelled &&
        activeAccountRef.current === accountUserId &&
        next.key === scopeKey
      ) {
        setState(next);
      }
    };

    (async () => {
      const runtime = await TeamProductionRuntime.create({
        accountUserId,
        activeAccountUserId: () => activeAccountRef.current,
        client,
        database: privateDatabase.database,
        rootEventId,
      });
      if (!runtime) {
        publish({ key: scopeKey, status: 'concealed' });
        return;
      }
      let model = await runtime.loadFeed(eventId);
      if (model) {
        publish({ key: scopeKey, model, runtime, status: 'ready' });
      } else {
        publish({ key: scopeKey, status: 'loading' });
      }
      if (online) {
        try {
          await runtime.refresh();
        } catch (caught) {
          if (caught instanceof MobileSyncRootAccessDeniedError) {
            publish({ key: scopeKey, status: 'concealed' });
            return;
          }
        }
      }
      model = (await runtime.loadFeed(eventId)) ?? model;
      publish(
        model
          ? { key: scopeKey, model, runtime, status: 'ready' }
          : { key: scopeKey, status: 'concealed' },
      );
    })().catch(() => publish({ key: scopeKey, status: 'concealed' }));

    return () => {
      cancelled = true;
    };
  }, [
    client,
    eventId,
    online,
    privateDatabase.accountId,
    privateDatabase.database,
    refreshRequest,
    rootEventId,
    scopeKey,
  ]);

  if (!scopeKey || state.key !== scopeKey || state.status === 'loading') {
    return (
      <TeamRouteStateView
        description="Crew lädt den sicher gespeicherten Feed."
        kind="loading"
        onBack={() => navigation.goBack()}
        onRetry={() => setRefreshRequest(value => value + 1)}
        testID="team-feed-loading"
        title="Feed wird geladen"
      />
    );
  }
  if (state.status === 'concealed') {
    return (
      <TeamRouteStateView
        description="Dieser Feed ist für das aktive Konto nicht verfügbar."
        kind="concealed"
        onBack={() => navigation.goBack()}
        onRetry={() => setRefreshRequest(value => value + 1)}
        testID="team-feed-unavailable"
        title="Inhalt nicht verfügbar"
      />
    );
  }

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const { runtime } = state;
    let locallySaved = false;
    try {
      await runtime.createFeedEntry(eventId, draft);
      locallySaved = true;
      if (activeAccountRef.current !== privateDatabase.accountId) return;
      setDraft('');
      const queued = await runtime.loadFeed(eventId);
      if (!queued) throw new Error('Queued team feed entry is unavailable');
      if (activeAccountRef.current === privateDatabase.accountId) {
        setState({ key: scopeKey, model: queued, runtime, status: 'ready' });
      }
      if (online) {
        try {
          await runtime.refresh();
        } catch (caught) {
          if (caught instanceof MobileSyncRootAccessDeniedError) {
            setState({ key: scopeKey, status: 'concealed' });
            return;
          }
        }
        const latest = await runtime.loadFeed(eventId);
        if (latest && activeAccountRef.current === privateDatabase.accountId) {
          setState({ key: scopeKey, model: latest, runtime, status: 'ready' });
        }
      }
    } catch {
      if (activeAccountRef.current === privateDatabase.accountId) {
        setError(
          locallySaved
            ? 'Der Beitrag wurde lokal gespeichert, aber der Feed konnte nicht aktualisiert werden. Tippe auf «Feed aktualisieren».'
            : 'Der Beitrag konnte nicht lokal gespeichert werden. Dein Text bleibt in diesem Feld.',
        );
      }
    } finally {
      if (activeAccountRef.current === privateDatabase.accountId) {
        setSubmitting(false);
      }
    }
  };

  return (
    <TeamFeedView
      draft={draft}
      error={error}
      model={state.model}
      onBack={() => navigation.goBack()}
      onChange={value => {
        setDraft(value);
        if (error) setError(null);
      }}
      onRefresh={() => setRefreshRequest(value => value + 1)}
      onSubmit={() => {
        submit().catch(() => undefined);
      }}
      online={online}
      submitting={submitting}
    />
  );
}

export type TeamFeedViewProps = {
  draft: string;
  error: string | null;
  model: TeamFeedViewModel;
  onBack(): void;
  onChange(value: string): void;
  onRefresh(): void;
  onSubmit(): void;
  online: boolean;
  submitting: boolean;
};

export function TeamFeedView({
  draft,
  error,
  model,
  onBack,
  onChange,
  onRefresh,
  onSubmit,
  online,
  submitting,
}: TeamFeedViewProps) {
  const fieldError =
    draft.length > TEAM_FEED_MAX_LENGTH
      ? "Höchstens 10'000 Zeichen sind erlaubt."
      : draft.length > 0 && draft.trim().length === 0
      ? 'Gib mindestens ein sichtbares Zeichen ein.'
      : undefined;
  const canSubmit =
    model.canPost &&
    !submitting &&
    draft.trim().length > 0 &&
    draft.trim().length <= TEAM_FEED_MAX_LENGTH;
  const delivery = feedDeliverySummary(model.entries, online);
  const submitHint = submitting
    ? 'Der Beitrag wird verarbeitet. Eine zweite Übermittlung ist gesperrt.'
    : fieldError
    ? fieldError
    : draft.trim().length === 0
    ? 'Gib zuerst eine Nachricht ein.'
    : 'Speichert genau einen Beitrag im Offline-Ausgang.';

  return (
    <ScreenFrame
      description="Geteilte Nachrichten werden zuerst lokal gespeichert und dann mit derselben Identität synchronisiert."
      eyebrow="TEAM-FEED"
      icon={delivery.icon}
      statusLabel={delivery.statusLabel}
      testID="team-feed-view"
      title={model.eventTitle}
      tone="lavender"
    >
      <SyncStatus
        icon={<ScreenIcon size={17} source={delivery.icon} />}
        label={delivery.label}
        state={delivery.state}
      />

      {model.canPost ? (
        <View style={styles.composer}>
          <View style={styles.field}>
            <TextField
              accessibilityHint="Schreibe eine Nachricht für die Mitglieder dieses Events."
              autoCapitalize="sentences"
              autoComplete="off"
              disabled={submitting}
              error={fieldError}
              inputStyle={styles.input}
              label="Nachricht"
              maxLength={TEAM_FEED_MAX_LENGTH}
              multiline
              onChangeText={onChange}
              placeholder="Was soll dein Team wissen?"
              testID="team-feed-input"
              textAlignVertical="top"
              value={draft}
            />
            <Text
              accessibilityLabel={`${draft.length} von 10'000 Zeichen. Beim Teilen wird die Nachricht lokal gespeichert.`}
              style={styles.helper}
              testID="team-feed-character-count"
            >
              {draft.length} / 10'000 Zeichen · Beim Teilen lokal gespeichert.
            </Text>
          </View>
          {error ? (
            <Text
              accessibilityLiveRegion="assertive"
              accessibilityRole="alert"
              style={styles.error}
            >
              {error}
            </Text>
          ) : null}
          <Button
            accessibilityHint={submitHint}
            disabled={!canSubmit}
            icon={<ScreenIcon source={icons.chat} />}
            label={submitting ? 'Wird verarbeitet …' : 'Im Feed teilen'}
            loading={submitting}
            onPress={onSubmit}
            testID="team-feed-submit"
            variant="action"
          />
        </View>
      ) : (
        <Card tone="surface">
          <StatusChip label="NUR ANSEHEN" tone="lavender" />
          <Text style={styles.supportCopy}>
            Du kannst Beiträge lesen, aber in diesem Event nichts posten.
          </Text>
        </Card>
      )}

      <View style={styles.feed}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          LETZTE BEITRÄGE
        </Text>
        {model.entries.length > 0 ? (
          <View accessibilityRole="list" style={styles.entryList}>
            {model.entries.map(entry => (
              <TeamFeedEntry entry={entry} key={entry.id} />
            ))}
          </View>
        ) : (
          <Card tone="surface">
            <Text accessibilityLiveRegion="polite" style={styles.emptyTitle}>
              Noch keine Nachrichten
            </Text>
            <Text style={styles.supportCopy}>
              Der erste lokal gespeicherte Beitrag erscheint sofort hier.
            </Text>
          </Card>
        )}
      </View>

      <View style={styles.actions}>
        <Button
          accessibilityHint={
            submitting
              ? 'Warte, bis der Beitrag verarbeitet wurde.'
              : 'Lädt ausstehende Beiträge und den aktuellen Event-Feed erneut.'
          }
          disabled={submitting}
          label="Feed aktualisieren"
          onPress={onRefresh}
          testID="team-feed-refresh"
          variant="surface"
        />
        <Button
          accessibilityHint={
            submitting
              ? 'Warte, bis der Beitrag verarbeitet wurde.'
              : 'Kehrt zum Event zurück. Ausstehende Beiträge bleiben gespeichert.'
          }
          disabled={submitting}
          label="Zurück zum Event"
          onPress={onBack}
          testID="team-feed-back"
          variant="surface"
        />
      </View>
    </ScreenFrame>
  );
}

function TeamFeedEntry({ entry }: { entry: TeamFeedEntryViewModel }) {
  const timestamp = feedTimestamp(entry.createdAt);
  const copyHint =
    entry.deliveryState === 'attention'
      ? 'Aktion verfügbar: Beitrag kopieren. Der Text bleibt lokal.'
      : 'Aktion verfügbar: Beitrag kopieren.';
  const copyEntry = () => {
    Clipboard.setString(entry.body);
    AccessibilityInfo.announceForAccessibility('Beitrag kopiert.');
  };
  return (
    <Card
      style={styles.entry}
      testID={`team-feed-entry-${entry.deliveryState}`}
      tone={entry.deliveryState === 'attention' ? 'brand' : 'surface'}
    >
      <View style={styles.entryMeta}>
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.author}
        >
          {entry.author}
        </Text>
        <StatusChip
          accessibilityLiveRegion="polite"
          label={entry.deliveryLabel}
          testID={`team-feed-entry-status-${entry.id}`}
          tone={entry.deliveryState === 'converged' ? 'action' : 'lavender'}
        />
      </View>
      <Text
        accessible
        accessibilityActions={[{ label: 'Beitrag kopieren', name: 'copy' }]}
        accessibilityHint={copyHint}
        accessibilityLabel={`${entry.author}. ${entry.body} ${timestamp}.`}
        accessibilityRole="text"
        onAccessibilityAction={event => {
          if (event.nativeEvent.actionName === 'copy') copyEntry();
        }}
        style={styles.body}
      >
        {entry.body}
      </Text>
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.timestamp}
      >
        {timestamp}
      </Text>
      {entry.deliveryState === 'attention' ? (
        <Button
          accessibilityHint="Kopiert den lokal erhaltenen Beitrag in die Zwischenablage."
          label="Beitrag kopieren"
          onPress={copyEntry}
          testID={`team-feed-entry-copy-${entry.id}`}
          variant="surface"
        />
      ) : null}
    </Card>
  );
}

function feedDeliverySummary(
  entries: readonly TeamFeedEntryViewModel[],
  online: boolean,
): {
  icon: ImageSourcePropType;
  label: string;
  state: 'attention' | 'offline' | 'ready' | 'syncing';
  statusLabel: string;
} {
  const deliveryState = (['attention', 'sending', 'queued'] as const).find(
    state => entries.some(entry => entry.deliveryState === state),
  );
  if (deliveryState === 'attention') {
    return {
      icon: icons.cloudOffline,
      label:
        'Mindestens ein Beitrag braucht Aufmerksamkeit. Nutze beim betroffenen Beitrag die Aktion „Beitrag kopieren“; er bleibt lokal.',
      state: 'attention',
      statusLabel: 'AKTION ERFORDERLICH',
    };
  }
  if (deliveryState === 'sending') {
    return {
      icon: icons.cloudOffline,
      label:
        'Mindestens ein Beitrag wird synchronisiert und wartet auf Serverbestätigung.',
      state: 'syncing',
      statusLabel: 'WIRD GESENDET',
    };
  }
  if (deliveryState === 'queued') {
    return {
      icon: icons.cloudOffline,
      label: online
        ? 'Mindestens ein Beitrag ist lokal gespeichert. Crew versucht die Synchronisierung.'
        : 'Mindestens ein Beitrag ist offline gespeichert. Crew sendet bei der nächsten Verbindung.',
      state: 'offline',
      statusLabel: 'LOKAL GESPEICHERT',
    };
  }
  return online
    ? {
        icon: icons.check,
        label: 'Alle sichtbaren Beiträge sind synchronisiert.',
        state: 'ready',
        statusLabel: 'SYNCHRONISIERT',
      }
    : {
        icon: icons.cloudOffline,
        label: 'Offline. Synchronisierte Beiträge bleiben verfügbar.',
        state: 'offline',
        statusLabel: 'OFFLINE BEREIT',
      };
}

function feedTimestamp(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Zeitpunkt unbekannt';
  return new Intl.DateTimeFormat('de-CH', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

const styles = StyleSheet.create({
  actions: {
    gap: spacing.md,
  },
  author: {
    ...typography.bodyStrong,
    color: colors.text,
    flexShrink: 1,
  },
  body: {
    ...typography.body,
    color: colors.text,
  },
  composer: {
    gap: spacing.md,
  },
  emptyTitle: {
    ...typography.subheading,
    color: colors.text,
  },
  entry: {
    gap: spacing.sm,
  },
  entryList: {
    gap: spacing.md,
  },
  entryMeta: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  error: {
    ...typography.caption,
    color: colors.error,
  },
  feed: {
    gap: spacing.md,
  },
  field: {
    gap: spacing.xs,
  },
  helper: {
    ...typography.caption,
    color: colors.text,
  },
  input: {
    minHeight: 128,
  },
  sectionTitle: {
    ...typography.overline,
    color: colors.text,
  },
  supportCopy: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  timestamp: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
