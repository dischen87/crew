import type {
  CommunityFeedbackStatus,
  CommunityFeedbackSummary,
  CommunityFeedbackUpdate,
} from '@crew/mobile-data';
import type { ImageSourcePropType } from 'react-native';
import {
  ActivityIndicator,
  FlatList,
  Image,
  ImageBackground,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  Card,
  FeedUpdateRow,
  StatusChip,
  SyncStatus,
  TextField,
} from '../design/primitives';
import {
  borders,
  colors,
  componentMetrics,
  elevations,
  radii,
  spacing,
  typography,
} from '../design/theme';
import { ScreenIcon } from './ScreenFrame';

const boardBackground = require('../assets/crew-board-background.png');
const crewLogo = require('../assets/crew-logo.png');
const icons = {
  chat: require('../assets/icons/chat.png'),
  check: require('../assets/icons/check.png'),
  cloudOffline: require('../assets/icons/cloud-offline.png'),
  crew: require('../assets/icons/crew.png'),
} satisfies Record<string, ImageSourcePropType>;

export type CommunityFeedbackListItem = Pick<
  CommunityFeedbackSummary,
  | 'body'
  | 'duplicateCount'
  | 'followed'
  | 'id'
  | 'status'
  | 'title'
  | 'updatedAt'
  | 'viewerHasVoted'
  | 'voteCount'
>;

export type CommunityFeedbackListUpdate = Omit<
  Pick<
    CommunityFeedbackUpdate,
    | 'changedAt'
    | 'feedbackId'
    | 'fromStatus'
    | 'note'
    | 'title'
    | 'toStatus'
    | 'version'
  >,
  'fromStatus'
> & { fromStatus: CommunityFeedbackStatus | null };

export type CommunityFeedbackListMode = 'feedback' | 'updates';
export type CommunityFeedbackStatusFilter = 'all' | CommunityFeedbackStatus;

export type CommunityFeedbackListViewModel = {
  followedOnly: boolean;
  items: readonly CommunityFeedbackListItem[];
  message: string | null;
  mode: CommunityFeedbackListMode;
  online: boolean;
  phase: 'loading' | 'ready' | 'unavailable';
  query: string;
  refreshing: boolean;
  status: CommunityFeedbackStatusFilter;
  updates: readonly CommunityFeedbackListUpdate[];
};

export type CommunityFeedbackListViewProps = {
  model: CommunityFeedbackListViewModel;
  onBack(): void;
  onCompose(): void;
  onComposeWithScreenshot(): void;
  onFollowedOnlyChange(value: boolean): void;
  onModeChange(value: CommunityFeedbackListMode): void;
  onOpenFeedback(feedbackId: string): void;
  onQueryChange(value: string): void;
  onRefresh(): void;
  onStatusChange(value: CommunityFeedbackStatusFilter): void;
  screenshotCaptureBusy: boolean;
  screenshotCaptureMessage: string | null;
};

type ListRow =
  | { item: CommunityFeedbackListItem; kind: 'feedback' }
  | { item: CommunityFeedbackListUpdate; kind: 'update' };

const statuses: readonly CommunityFeedbackStatusFilter[] = [
  'all',
  'open',
  'planned',
  'in_progress',
  'completed',
  'declined',
];

export function CommunityFeedbackListView({
  model,
  onBack,
  onCompose,
  onComposeWithScreenshot,
  onFollowedOnlyChange,
  onModeChange,
  onOpenFeedback,
  onQueryChange,
  onRefresh,
  onStatusChange,
  screenshotCaptureBusy,
  screenshotCaptureMessage,
}: CommunityFeedbackListViewProps) {
  const insets = useSafeAreaInsets();
  const rows: readonly ListRow[] =
    model.mode === 'feedback'
      ? model.items.map(item => ({ item, kind: 'feedback' as const }))
      : model.updates.map(item => ({ item, kind: 'update' as const }));

  return (
    <ImageBackground
      resizeMode="cover"
      source={boardBackground}
      style={styles.screen}
      testID="community-feedback-list-view"
    >
      <FlatList
        automaticallyAdjustContentInsets={false}
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom: Math.max(insets.bottom, spacing.xl),
            paddingTop: Math.max(spacing.md - insets.top, 0),
          },
        ]}
        contentInsetAdjustmentBehavior="never"
        data={rows}
        keyExtractor={row =>
          row.kind === 'feedback'
            ? `feedback:${row.item.id}`
            : `update:${row.item.feedbackId}:${row.item.version}`
        }
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <EmptyState
            mode={model.mode}
            onCompose={onCompose}
            phase={model.phase}
            query={model.query}
          />
        }
        ListFooterComponent={
          model.phase === 'ready' ? (
            <View style={styles.footerActions}>
              <Button
                accessibilityHint="Prüft neue Event-Feedbacks und Statusänderungen. Gespeicherte Einträge bleiben sichtbar."
                label="Feedback aktualisieren"
                loading={model.refreshing}
                onPress={onRefresh}
                testID="community-feedback-refresh"
                variant="surface"
              />
              <Button
                label="Zurück zum Event"
                onPress={onBack}
                testID="community-feedback-back"
                variant="surface"
              />
            </View>
          ) : null
        }
        ListHeaderComponent={
          <ListHeader
            model={model}
            onBack={onBack}
            onCompose={onCompose}
            onComposeWithScreenshot={onComposeWithScreenshot}
            onFollowedOnlyChange={onFollowedOnlyChange}
            onModeChange={onModeChange}
            onQueryChange={onQueryChange}
            onStatusChange={onStatusChange}
            screenshotCaptureBusy={screenshotCaptureBusy}
            screenshotCaptureMessage={screenshotCaptureMessage}
          />
        }
        onRefresh={onRefresh}
        refreshing={model.refreshing}
        renderItem={({ item }) =>
          item.kind === 'feedback' ? (
            <FeedbackRow
              feedback={item.item}
              onPress={() => onOpenFeedback(item.item.id)}
            />
          ) : (
            <UpdateRow
              onPress={() => onOpenFeedback(item.item.feedbackId)}
              update={item.item}
            />
          )
        }
        showsVerticalScrollIndicator={false}
        style={[styles.list, { marginTop: insets.top }]}
      />
    </ImageBackground>
  );
}

function ListHeader({
  model,
  onBack,
  onCompose,
  onComposeWithScreenshot,
  onFollowedOnlyChange,
  onModeChange,
  onQueryChange,
  onStatusChange,
  screenshotCaptureBusy,
  screenshotCaptureMessage,
}: Omit<CommunityFeedbackListViewProps, 'onOpenFeedback' | 'onRefresh'>) {
  return (
    <View style={styles.header}>
      <View
        style={styles.brandRow}
        testID="community-feedback-brand-row"
      >
        <View style={styles.brandLockup}>
          <Image
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            resizeMode="contain"
            source={crewLogo}
            style={styles.logo}
          />
          <Text style={styles.brandName}>CREW</Text>
        </View>
        <Button
          label="Zurück"
          onPress={onBack}
          testID="community-feedback-header-back"
          variant="surface"
        />
      </View>
      <Text style={styles.eyebrow}>EVENT-FEEDBACK</Text>
      <Text accessibilityRole="header" style={styles.title}>
        Feedback im Event
      </Text>
      <Text style={styles.description}>
        Nur aktive Mitglieder dieses Events sehen bereinigte Meldungen und
        Statusupdates. Es gibt keine öffentlichen Profile oder
        eventübergreifenden Follows.
      </Text>
      <SyncStatus
        icon={
          <ScreenIcon
            size={17}
            source={model.online ? icons.check : icons.cloudOffline}
          />
        }
        label={syncLabel(model)}
        state={
          model.refreshing ? 'syncing' : model.online ? 'ready' : 'offline'
        }
      />
      {model.message ? (
        <Card
          accessibilityLiveRegion="polite"
          style={styles.messageCard}
          tone={model.phase === 'unavailable' ? 'brand' : 'lavender'}
        >
          <Text
            accessibilityRole={
              model.phase === 'unavailable' ? 'alert' : undefined
            }
            style={styles.message}
          >
            {model.message}
          </Text>
        </Card>
      ) : null}
      {model.phase === 'ready' ? (
        <>
          <View
            accessibilityRole="tablist"
            style={styles.modeTabs}
            testID="community-feedback-mode-tabs"
          >
            <ModeTab
              label="Meldungen"
              onPress={() => onModeChange('feedback')}
              selected={model.mode === 'feedback'}
              testID="community-feedback-mode-feedback"
            />
            <ModeTab
              label="Updates"
              onPress={() => onModeChange('updates')}
              selected={model.mode === 'updates'}
              testID="community-feedback-mode-updates"
            />
          </View>
          {model.mode === 'feedback' ? (
            <>
              <TextField
                autoCapitalize="none"
                autoComplete="off"
                label="Feedback durchsuchen"
                onChangeText={onQueryChange}
                placeholder="Titel oder Text"
                returnKeyType="search"
                testID="community-feedback-query"
                value={model.query}
              />
              <Text style={styles.filterHeading}>STATUS FILTERN</Text>
              <View style={styles.filters}>
                {statuses.map(status => (
                  <FilterChip
                    key={status}
                    label={statusLabel(status)}
                    onPress={() => onStatusChange(status)}
                    selected={model.status === status}
                  />
                ))}
              </View>
              <Pressable
                accessibilityLabel="Nur gefolgtes Feedback"
                accessibilityRole="button"
                accessibilityState={{ selected: model.followedOnly }}
                onPress={() => onFollowedOnlyChange(!model.followedOnly)}
                style={({ pressed }) => [
                  styles.followedFilter,
                  model.followedOnly && styles.filterSelected,
                  pressed && styles.pressed,
                ]}
                testID="community-feedback-followed-filter"
              >
                <Text style={styles.filterLabel}>
                  {model.followedOnly
                    ? 'Nur gefolgte: aktiv'
                    : 'Nur gefolgte anzeigen'}
                </Text>
              </Pressable>
              <Button
                accessibilityHint="Öffnet Text-Feedback und kehrt danach zu dieser Liste zurück."
                icon={<ScreenIcon source={icons.chat} />}
                label="Feedback geben"
                onPress={onCompose}
                testID="community-feedback-compose"
                variant="brand"
              />
              <Button
                accessibilityHint="Erstellt jetzt einen Screenshot dieser sichtbaren Feedback-Liste und öffnet danach Feedback."
                label="Screenshot hinzufügen"
                loading={screenshotCaptureBusy}
                onPress={onComposeWithScreenshot}
                testID="community-feedback-compose-screenshot"
                variant="surface"
              />
              {screenshotCaptureMessage ? (
                <Card
                  accessibilityLiveRegion="polite"
                  style={styles.messageCard}
                  tone="lavender"
                >
                  <Text accessibilityRole="alert" style={styles.message}>
                    {screenshotCaptureMessage}
                  </Text>
                </Card>
              ) : null}
            </>
          ) : (
            <Text style={styles.supportCopy}>
              Statusänderungen der bereinigten Meldungen – ohne Autor:innen,
              Diagnosen oder interne Kontextdaten.
            </Text>
          )}
        </>
      ) : null}
    </View>
  );
}

function ModeTab({
  label,
  onPress,
  selected,
  testID,
}: {
  label: string;
  onPress(): void;
  selected: boolean;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.modeTab,
        selected && styles.modeTabSelected,
        pressed && styles.pressed,
      ]}
      testID={testID}
    >
      <Text style={styles.modeTabLabel}>{label}</Text>
    </Pressable>
  );
}

function FilterChip({
  label,
  onPress,
  selected,
}: {
  label: string;
  onPress(): void;
  selected: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={`Status ${label}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.filterChip,
        selected && styles.filterSelected,
        pressed && styles.pressed,
      ]}
    >
      <Text style={styles.filterLabel}>{label}</Text>
    </Pressable>
  );
}

function FeedbackRow({
  feedback,
  onPress,
}: {
  feedback: CommunityFeedbackListItem;
  onPress(): void;
}) {
  const body = summary(feedback.body);
  const accessibilityLabel = [
    feedback.title,
    statusLabel(feedback.status),
    `${feedback.voteCount} Stimmen`,
    feedback.followed ? 'Gefolgt' : 'Nicht gefolgt',
    body,
  ].join(', ');
  return (
    <Pressable
      accessibilityHint="Öffnet das bereinigte Feedback und seinen Statusverlauf."
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.rowPressable, pressed && styles.pressed]}
    >
      <Card elevated style={styles.feedbackCard} tone="surface">
        <View style={styles.rowMeta}>
          <StatusChip label={statusLabel(feedback.status)} tone="brand" />
          {feedback.followed ? (
            <StatusChip label="GEFOLGT" tone="lavender" />
          ) : null}
        </View>
        <Text style={styles.rowTitle}>{feedback.title}</Text>
        <Text style={styles.rowBody}>{body}</Text>
        <View style={styles.counts}>
          <Text style={styles.countLabel}>
            {feedback.viewerHasVoted ? 'DEINE STIMME · ' : ''}
            {feedback.voteCount} Stimmen
          </Text>
          {feedback.duplicateCount > 0 ? (
            <Text style={styles.countLabel}>
              {feedback.duplicateCount} zusammengeführt
            </Text>
          ) : null}
        </View>
      </Card>
    </Pressable>
  );
}

function UpdateRow({
  onPress,
  update,
}: {
  onPress(): void;
  update: CommunityFeedbackListUpdate;
}) {
  const transition =
    update.fromStatus === null
      ? `Gestartet als ${statusLabel(update.toStatus)}`
      : `${statusLabel(update.fromStatus)} → ${statusLabel(update.toStatus)}`;
  return (
    <FeedUpdateRow
      accessibilityHint="Öffnet das Feedback mit dem vollständigen Statusverlauf."
      actor="CREW STATUS"
      body={update.note ?? transition}
      icon={<ScreenIcon source={icons.crew} />}
      onPress={onPress}
      statusLabel={transition}
      style={styles.updateRow}
      timestamp={formatDate(update.changedAt)}
      title={update.title}
    />
  );
}

function EmptyState({
  mode,
  onCompose,
  phase,
  query,
}: {
  mode: CommunityFeedbackListMode;
  onCompose(): void;
  phase: CommunityFeedbackListViewModel['phase'];
  query: string;
}) {
  if (phase === 'loading') {
    return (
      <View accessibilityLiveRegion="polite" style={styles.emptyState}>
        <ActivityIndicator
          accessibilityLabel="Event-Feedback wird geladen"
          color={colors.textSecondary}
          size="large"
        />
        <Text style={styles.supportCopy}>
          Gespeichertes Feedback bleibt sichtbar, sobald es geprüft ist.
        </Text>
      </View>
    );
  }
  if (phase === 'unavailable') {
    return (
      <Card style={styles.emptyCard} tone="brand">
        <Text accessibilityRole="alert" style={styles.emptyTitle}>
          Dieser Inhalt ist nicht verfügbar.
        </Text>
        <Text style={styles.supportCopy}>
          Geschützte Event- und Feedbackdaten bleiben verborgen.
        </Text>
      </Card>
    );
  }
  if (mode === 'updates') {
    return (
      <Card style={styles.emptyCard} tone="lavender">
        <Text style={styles.emptyTitle}>Noch keine sichtbaren Updates</Text>
        <Text style={styles.supportCopy}>
          Der aktuelle Status steht direkt bei jeder Meldung.
        </Text>
      </Card>
    );
  }
  return (
    <Card style={styles.emptyCard} tone="brand">
      <Text style={styles.emptyTitle}>
        {query.trim()
          ? 'Keine passenden Meldungen'
          : 'Noch kein sichtbares Feedback in diesem Event'}
      </Text>
      <Text style={styles.supportCopy}>
        {query.trim()
          ? 'Passe Suche oder Filter an – gespeicherte Meldungen bleiben erhalten.'
          : 'Starte mit einer Idee oder einem Problem. Text kann auch offline gespeichert werden.'}
      </Text>
      <Button
        icon={<ScreenIcon source={icons.chat} />}
        label="Feedback geben"
        onPress={onCompose}
        testID="community-feedback-empty-compose"
        variant="action"
      />
    </Card>
  );
}

function syncLabel(model: CommunityFeedbackListViewModel) {
  if (model.refreshing)
    return 'Feedback wird aktualisiert. Gespeicherte Einträge bleiben sichtbar.';
  return model.online
    ? 'Gespeichertes Event-Feedback ist bereit.'
    : 'Offline. Du siehst die gespeicherte Liste; Beiträge sind nur online möglich.';
}

export function statusLabel(status: CommunityFeedbackStatusFilter): string {
  switch (status) {
    case 'all':
      return 'Alle';
    case 'open':
      return 'Offen';
    case 'planned':
      return 'Geplant';
    case 'in_progress':
      return 'In Arbeit';
    case 'completed':
      return 'Erledigt';
    case 'declined':
      return 'Nicht geplant';
  }
}

function summary(value: string) {
  const normalized = value.trim();
  return normalized.length <= 240
    ? normalized
    : `${normalized.slice(0, 239).trimEnd()}…`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Aktualisiert';
  return date.toLocaleDateString('de-CH', {
    day: '2-digit',
    month: 'short',
  });
}

const styles = StyleSheet.create({
  brandLockup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  brandName: {
    ...typography.heading,
    color: colors.text,
    fontSize: 22,
    lineHeight: 26,
  },
  brandRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
  },
  countLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  counts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  description: {
    ...typography.body,
    color: colors.textSecondary,
  },
  emptyCard: {
    gap: spacing.md,
    marginTop: spacing.md,
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  emptyTitle: {
    ...typography.heading,
    color: colors.text,
  },
  eyebrow: {
    ...typography.overline,
    color: colors.textSecondary,
  },
  feedbackCard: {
    gap: spacing.sm,
  },
  filterChip: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: borders.chip,
    justifyContent: 'center',
    minHeight: componentMetrics.control.minimumTouchSize,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  filterHeading: {
    ...typography.overline,
    color: colors.textSecondary,
  },
  filterLabel: {
    ...typography.label,
    color: colors.text,
  },
  filterSelected: {
    backgroundColor: colors.surfaceAction,
    borderWidth: borders.strong,
  },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  followedFilter: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: borders.chip,
    justifyContent: 'center',
    minHeight: componentMetrics.control.minimumTouchSize,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  footerActions: {
    gap: spacing.md,
    paddingTop: spacing.xl,
  },
  header: {
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  logo: {
    height: 52,
    width: 52,
  },
  list: {
    flex: 1,
  },
  message: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  messageCard: {
    gap: spacing.sm,
  },
  modeTab: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.control,
    borderWidth: borders.chip,
    flexBasis: 'auto',
    flexGrow: 1,
    flexShrink: 0,
    justifyContent: 'center',
    minHeight: componentMetrics.control.minimumTouchSize,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  modeTabLabel: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  modeTabSelected: {
    backgroundColor: colors.surfaceBrand,
    borderWidth: borders.strong,
  },
  modeTabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  pressed: {
    backgroundColor: colors.backgroundPressed,
    transform: [{ translateX: 1 }, { translateY: 1 }],
  },
  rowBody: {
    ...typography.body,
    color: colors.text,
  },
  rowMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  rowPressable: {
    marginBottom: spacing.md,
  },
  rowTitle: {
    ...typography.subheading,
    color: colors.text,
  },
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  supportCopy: {
    ...typography.body,
    color: colors.text,
  },
  title: {
    ...typography.title,
    color: colors.text,
  },
  updateRow: {
    borderColor: colors.border,
    borderRadius: radii.card,
    borderWidth: borders.chip,
    marginBottom: spacing.md,
    overflow: 'hidden',
    ...elevations.compact,
  },
});
