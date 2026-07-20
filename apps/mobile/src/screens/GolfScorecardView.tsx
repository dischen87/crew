import type { ImageSourcePropType } from 'react-native';
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  Card,
  IconButton,
  StatusChip,
  SyncStatus,
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
import type {
  GolfDraftPreview,
  GolfScorecardHoleModel,
  GolfScorecardViewModel,
} from '../golf/GolfScorecardController';

const boardBackground = require('../assets/crew-board-background.png');
const crewLogo = require('../assets/crew-logo.png');
const icons = {
  arrowRight: require('../assets/icons/arrow-right.png'),
  caretRight: require('../assets/icons/caret-right.png'),
  check: require('../assets/icons/check.png'),
  cloudOffline: require('../assets/icons/cloud-offline.png'),
  flag: require('../assets/icons/flag.png'),
  golf: require('../assets/icons/golf.png'),
} satisfies Record<string, ImageSourcePropType>;

export type GolfScorecardSurfaceModel =
  | { eventTitle: string; message?: string; phase: 'concealed' | 'loading' }
  | (GolfScorecardViewModel & { message?: string; phase: 'ready' });

export type GolfScorecardDraftViewModel = {
  dirty: boolean;
  preview: GolfDraftPreview;
  putts: string;
  saving: boolean;
  strokes: string;
};

export type GolfScorecardViewProps = {
  draft: GolfScorecardDraftViewModel;
  model: GolfScorecardSurfaceModel;
  onBack(): void;
  onChangePutts(value: string): void;
  onChangeStrokes(value: string): void;
  onClear(): void;
  onResolveConflict(): void;
  onRetry(): void;
  onSave(): void;
  onSelectHole(hole: number): void;
  onSync(): void;
  selectedHole: number;
};

export function GolfScorecardView({
  draft,
  model,
  onBack,
  onChangePutts,
  onChangeStrokes,
  onClear,
  onResolveConflict,
  onRetry,
  onSave,
  onSelectHole,
  onSync,
  selectedHole,
}: GolfScorecardViewProps) {
  const insets = useSafeAreaInsets();
  const ready = model.phase === 'ready' ? model : null;
  const selected =
    ready?.access === 'edit'
      ? ready.holes.find(hole => hole.hole === selectedHole) ?? ready.holes[0]
      : null;
  const missingEditableScorecard = ready?.access === 'edit' && !selected;

  return (
    <ImageBackground
      resizeMode="cover"
      source={boardBackground}
      style={styles.screen}
      testID="golf-scorecard-view"
    >
      <ScrollView
        automaticallyAdjustContentInsets={false}
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom: Math.max(insets.bottom, spacing.xl),
            paddingTop: Math.max(spacing.md - insets.top, 0),
          },
        ]}
        contentInsetAdjustmentBehavior="never"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={[styles.scroll, { marginTop: insets.top }]}
      >
        <BrandHeader onBack={onBack} />
        <View style={styles.titleRow}>
          <View style={styles.titleCopy}>
            <Text style={styles.eyebrow}>LIVE · GOLF</Text>
            <Text
              accessibilityLabel="Scorekarte"
              accessibilityRole="header"
              style={styles.title}
            >
              {'Score\u00adkarte'}
            </Text>
            <Text style={styles.eventTitle}>{model.eventTitle}</Text>
          </View>
          <View style={styles.heroIcon}>
            <AssetIcon name="golf" size={30} />
          </View>
        </View>

        {model.phase === 'loading' ? (
          <StateCard kind="loading" message={model.message} onRetry={onRetry} />
        ) : null}
        {model.phase === 'concealed' ? (
          <StateCard
            kind="concealed"
            message={model.message}
            onRetry={onRetry}
          />
        ) : null}

        {ready ? (
          <>
            <View style={styles.metaRow}>
              <StatusChip
                label={
                  ready.access === 'edit' ? 'DEINE RUNDE' : 'LIVE-RANGLISTE'
                }
                tone={ready.access === 'edit' ? 'brand' : 'lavender'}
              />
              <StatusChip label={roleLabel(ready.role)} tone="surface" />
            </View>
            <SyncStatus
              icon={<AssetIcon name={syncIcon(ready)} size={17} />}
              label={syncLabel(ready)}
              state={syncState(ready)}
            />
            {ready.message ? (
              <Card
                accessibilityLiveRegion="polite"
                style={styles.messageCard}
                tone="brand"
              >
                <Text style={styles.messageText}>{ready.message}</Text>
              </Card>
            ) : null}

            {ready.access === 'edit' ? (
              selected ? (
                <EditableScorecard
                  draft={draft}
                  hole={selected}
                  holes={ready.holes}
                  onChangePutts={onChangePutts}
                  onChangeStrokes={onChangeStrokes}
                  onClear={onClear}
                  onResolveConflict={onResolveConflict}
                  onSave={onSave}
                  onSelectHole={onSelectHole}
                />
              ) : (
                <MissingEditableScorecard busy={draft.saving} onSync={onSync} />
              )
            ) : (
              <ReadOnlyIntro role={ready.role} />
            )}

            <Leaderboard model={ready} />
            {!missingEditableScorecard ? (
              <Button
                accessibilityHint="Gleicht die lokal gespeicherte Rangliste mit Crew ab."
                disabled={draft.saving}
                icon={<AssetIcon name="arrowRight" />}
                label="Jetzt synchronisieren"
                loading={draft.saving}
                onPress={onSync}
                testID="golf-sync-action"
                variant="surface"
              />
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </ImageBackground>
  );
}

function BrandHeader({ onBack }: { onBack(): void }) {
  return (
    <View style={styles.brandRow}>
      <IconButton
        accessibilityLabel="Zurück zum Event"
        icon={<AssetIcon name="caretRight" rotate />}
        onPress={onBack}
        tone="surface"
      />
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
    </View>
  );
}

function StateCard({
  kind,
  message,
  onRetry,
}: {
  kind: 'concealed' | 'loading';
  message?: string;
  onRetry(): void;
}) {
  if (kind === 'loading') {
    return (
      <Card
        accessibilityLiveRegion="polite"
        style={styles.stateCard}
        tone="lavender"
      >
        <ActivityIndicator
          accessibilityLabel="Scorekarte wird geladen"
          color={colors.textSecondary}
          size="large"
        />
        <Text style={styles.stateTitle}>Runde wird geladen</Text>
        <Text style={styles.stateCopy}>
          Crew prüft zuerst deine sicher gespeicherte Scorekarte.
        </Text>
      </Card>
    );
  }
  return (
    <Card
      accessibilityLiveRegion="assertive"
      style={styles.stateCard}
      tone="brand"
    >
      <AssetIcon name="cloudOffline" size={32} />
      <Text accessibilityRole="alert" style={styles.stateTitle}>
        Scorekarte nicht verfügbar
      </Text>
      <Text style={styles.stateCopy}>
        {message ?? 'Diese Golfrunde ist für dich gerade nicht verfügbar.'}
      </Text>
      <Button label="Erneut versuchen" onPress={onRetry} variant="surface" />
    </Card>
  );
}

function EditableScorecard({
  draft,
  hole,
  holes,
  onChangePutts,
  onChangeStrokes,
  onClear,
  onResolveConflict,
  onSave,
  onSelectHole,
}: {
  draft: GolfScorecardDraftViewModel;
  hole: GolfScorecardHoleModel;
  holes: readonly GolfScorecardHoleModel[];
  onChangePutts(value: string): void;
  onChangeStrokes(value: string): void;
  onClear(): void;
  onResolveConflict(): void;
  onSave(): void;
  onSelectHole(hole: number): void;
}) {
  const status = editorStatus(hole, draft);
  return (
    <>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionEyebrow}>18-LOCH SCOREKARTE</Text>
        <Text style={styles.sectionProgress}>Loch {hole.hole} von 18</Text>
      </View>
      <ScrollView
        accessibilityLabel="Loch auswählen"
        contentContainerStyle={styles.holeRail}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {holes.map(item => (
          <Pressable
            accessibilityLabel={`Loch ${item.hole}, ${holeStatusLabel(
              item.deliveryState,
            )}`}
            accessibilityRole="button"
            accessibilityState={{
              busy: draft.saving,
              disabled: draft.saving,
              selected: item.hole === hole.hole,
            }}
            disabled={draft.saving}
            key={item.hole}
            onPress={() => onSelectHole(item.hole)}
            style={({ pressed }) => [
              styles.holeButton,
              item.hole === hole.hole && styles.holeButtonSelected,
              item.deliveryState === 'conflict' && styles.holeButtonAttention,
              pressed && styles.holeButtonPressed,
            ]}
            testID={`golf-hole-${item.hole}`}
          >
            <Text style={styles.holeNumber}>{item.hole}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <Card elevated style={styles.scoreCard} tone="brand">
        <View style={styles.scoreHeader}>
          <View>
            <Text style={styles.scoreOverline}>LOCH {hole.hole}</Text>
            <Text style={styles.scoreTitle}>
              Par {hole.par} · HCP {hole.strokeIndex}
            </Text>
          </View>
          <StatusChip label={status.label} tone={status.tone} />
        </View>

        {hole.conflict ? (
          <ConflictCard hole={hole} onResolveConflict={onResolveConflict} />
        ) : (
          <>
            <View style={styles.inputRow}>
              <ScoreInput
                accessibilityHint="Ganze Zahl zwischen 1 und 99."
                disabled={draft.saving}
                label="Schläge"
                onChange={onChangeStrokes}
                testID="golf-strokes-input"
                value={draft.strokes}
              />
              <ScoreInput
                accessibilityHint="Optional. Ganze Zahl zwischen 0 und 99."
                disabled={draft.saving}
                label="Putts"
                onChange={onChangePutts}
                testID="golf-putts-input"
                value={draft.putts}
              />
            </View>
            <View
              accessibilityLabel={previewLabel(draft.preview)}
              accessibilityLiveRegion="polite"
              style={styles.previewRow}
            >
              <View>
                <Text style={styles.previewLabel}>STABLEFORD · LOKAL</Text>
                <Text style={styles.previewHint}>
                  {draft.preview.error ??
                    (draft.preview.netStrokes === null
                      ? 'Werte eintragen – auch offline.'
                      : `Netto ${draft.preview.netStrokes}`)}
                </Text>
              </View>
              <View style={styles.pointsBadge}>
                <Text style={styles.pointsValue}>
                  {draft.preview.stablefordPoints}
                </Text>
                <Text style={styles.pointsLabel}>Punkte</Text>
              </View>
            </View>
            <View style={styles.scoreActions}>
              <Button
                accessibilityHint="Speichert diese Eingabe sicher auf dem Gerät und stellt sie zur Synchronisierung bereit."
                disabled={!draft.dirty || !draft.preview.valid}
                icon={<AssetIcon name="check" />}
                label="Loch lokal speichern"
                loading={draft.saving}
                onPress={onSave}
                testID="golf-save-action"
                variant="action"
              />
              {(draft.strokes || draft.putts) && !draft.saving ? (
                <Button
                  label="Werte leeren"
                  onPress={onClear}
                  testID="golf-clear-action"
                  variant="surface"
                />
              ) : null}
            </View>
          </>
        )}
      </Card>
    </>
  );
}

function ScoreInput({
  accessibilityHint,
  disabled,
  label,
  onChange,
  testID,
  value,
}: {
  accessibilityHint: string;
  disabled: boolean;
  label: string;
  onChange(value: string): void;
  testID: string;
  value: string;
}) {
  return (
    <View style={styles.scoreInputGroup}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        accessibilityHint={accessibilityHint}
        accessibilityLabel={label}
        accessibilityState={{ busy: disabled, disabled }}
        editable={!disabled}
        keyboardType="number-pad"
        maxLength={3}
        onChangeText={onChange}
        placeholder="–"
        placeholderTextColor={colors.textSecondary}
        selectTextOnFocus
        style={styles.scoreInput}
        testID={testID}
        value={value}
      />
    </View>
  );
}

function ConflictCard({
  hole,
  onResolveConflict,
}: {
  hole: GolfScorecardHoleModel;
  onResolveConflict(): void;
}) {
  const conflict = hole.conflict;
  if (!conflict) return null;
  return (
    <View accessibilityLiveRegion="assertive" style={styles.conflictCard}>
      <Text accessibilityRole="alert" style={styles.conflictTitle}>
        Zwei Spielstände gefunden
      </Text>
      <Text style={styles.conflictCopy}>
        Dein Offline-Stand bleibt erhalten. Vergleiche ihn mit dem Server-Stand.
      </Text>
      <View style={styles.versionGrid}>
        <VersionCard
          label="DEIN STAND"
          points={conflict.local.stablefordPoints}
          putts={conflict.local.putts}
          strokes={conflict.local.strokes}
          tone="action"
        />
        <VersionCard
          label="SERVER-STAND"
          points={conflict.server.stablefordPoints}
          putts={conflict.server.putts}
          strokes={conflict.server.strokes}
          tone="surface"
        />
      </View>
      <Button
        accessibilityHint="Legt deinen erhaltenen Offline-Stand als neue Änderung auf Basis des aktuellen Serverstands ab."
        icon={<AssetIcon name="arrowRight" />}
        label="Meinen Stand erneut senden"
        onPress={onResolveConflict}
        testID="golf-resolve-conflict"
        variant="action"
      />
    </View>
  );
}

function VersionCard({
  label,
  points,
  putts,
  strokes,
  tone,
}: {
  label: string;
  points: number | null;
  putts: number | null;
  strokes: number | null;
  tone: 'action' | 'surface';
}) {
  return (
    <Card style={styles.versionCard} tone={tone}>
      <Text style={styles.versionLabel}>{label}</Text>
      <Text style={styles.versionScore}>{formatScore(strokes)} Schläge</Text>
      <Text style={styles.versionMeta}>
        {formatScore(putts)} Putts · {formatScore(points)} Pkt.
      </Text>
    </Card>
  );
}

function ReadOnlyIntro({ role }: { role: GolfScorecardViewModel['role'] }) {
  return (
    <Card style={styles.readOnlyCard} tone="brand">
      <AssetIcon name="flag" size={30} />
      <View style={styles.readOnlyCopy}>
        <Text style={styles.readOnlyTitle}>Live mitfiebern</Text>
        <Text style={styles.readOnlyText}>
          {role === 'viewer'
            ? 'Du siehst die freigegebene Rangliste dieser Runde.'
            : 'Diese Runde ist für dich lesbar. Scores erfassen nur eingeteilte Teilnehmende.'}
        </Text>
      </View>
    </Card>
  );
}

function MissingEditableScorecard({
  busy,
  onSync,
}: {
  busy: boolean;
  onSync(): void;
}) {
  return (
    <Card
      accessibilityLiveRegion="polite"
      style={styles.readOnlyCard}
      tone="brand"
    >
      <AssetIcon name="cloudOffline" size={30} />
      <View style={styles.readOnlyCopy}>
        <Text style={styles.readOnlyTitle}>
          Scorekarte noch nicht verfügbar
        </Text>
        <Text style={styles.readOnlyText}>
          Die 18 Löcher sind auf diesem Gerät noch nicht vollständig angekommen.
          Synchronisiere die Runde erneut, bevor du Scores erfasst.
        </Text>
        <Button
          label="Scorekarte synchronisieren"
          loading={busy}
          onPress={onSync}
          testID="golf-scorecard-retry"
          variant="surface"
        />
      </View>
    </Card>
  );
}

function Leaderboard({ model }: { model: GolfScorecardViewModel }) {
  return (
    <View style={styles.leaderboardSection}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionEyebrow}>LIVE LEADERBOARD</Text>
        <Text style={styles.sectionProgress}>
          {model.leaderboard.length} Spieler
        </Text>
      </View>
      <Card
        accessibilityRole="list"
        style={styles.leaderboardCard}
        tone="surface"
      >
        {model.leaderboard.length ? (
          model.leaderboard.map((entry, index) => (
            <View
              accessible
              accessibilityLabel={`${entry.rank}. Platz, ${entry.name}, ${entry.stablefordPoints} Stableford-Punkte, ${entry.holesCompleted} von 18 Löchern`}
              key={`${entry.rank}:${entry.name}`}
              role="listitem"
              style={[
                styles.leaderboardRow,
                entry.isSelf && styles.leaderboardRowSelf,
                index > 0 && styles.leaderboardDivider,
              ]}
              testID={`golf-leaderboard-row-${index + 1}`}
            >
              <Text style={styles.rank}>{entry.rank}</Text>
              <View style={styles.leaderboardPerson}>
                <Text style={styles.leaderboardName}>{entry.name}</Text>
                <Text style={styles.leaderboardMeta}>
                  {entry.teamName ? `${entry.teamName} · ` : ''}
                  {entry.holesCompleted}/18 Löcher
                </Text>
              </View>
              <View style={styles.leaderboardPoints}>
                <Text style={styles.leaderboardPointsValue}>
                  {entry.stablefordPoints}
                </Text>
                <Text style={styles.leaderboardPointsLabel}>Punkte</Text>
              </View>
            </View>
          ))
        ) : (
          <Text style={styles.emptyLeaderboard}>
            Sobald Scores synchronisiert sind, erscheint die Rangliste hier.
          </Text>
        )}
      </Card>
    </View>
  );
}

function AssetIcon({
  name,
  rotate = false,
  size = 20,
}: {
  name: keyof typeof icons;
  rotate?: boolean;
  size?: number;
}) {
  return (
    <Image
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      resizeMode="contain"
      source={icons[name]}
      style={{
        height: size,
        transform: rotate ? [{ rotate: '180deg' }] : [],
        width: size,
      }}
    />
  );
}

function editorStatus(
  hole: GolfScorecardHoleModel,
  draft: GolfScorecardDraftViewModel,
): { label: string; tone: 'action' | 'brand' | 'lavender' | 'surface' } {
  if (hole.conflict) return { label: 'KONFLIKT', tone: 'brand' };
  if (!draft.preview.valid) return { label: 'EINGABE PRÜFEN', tone: 'brand' };
  if (draft.dirty) return { label: 'ENTWURF', tone: 'lavender' };
  if (hole.deliveryState === 'queued')
    return { label: 'LOKAL GESPEICHERT', tone: 'lavender' };
  if (hole.deliveryState === 'syncing')
    return { label: 'WIRD SYNCHRONISIERT', tone: 'surface' };
  if (hole.deliveryState === 'synced')
    return { label: 'SYNCHRON', tone: 'action' };
  if (hole.deliveryState === 'attention')
    return { label: 'PRÜFEN', tone: 'brand' };
  return { label: 'NOCH OFFEN', tone: 'surface' };
}

function holeStatusLabel(state: GolfScorecardHoleModel['deliveryState']) {
  if (state === 'queued') return 'lokal gespeichert';
  if (state === 'syncing') return 'wird synchronisiert';
  if (state === 'synced') return 'synchronisiert';
  if (state === 'conflict') return 'Konflikt';
  if (state === 'attention') return 'muss geprüft werden';
  return 'noch offen';
}

function roleLabel(role: GolfScorecardViewModel['role']) {
  if (role === 'owner') return 'OWNER';
  if (role === 'organizer') return 'ORGANISATION';
  if (role === 'viewer') return 'GAST';
  return 'TEILNEHMEND';
}

function syncLabel(model: GolfScorecardViewModel) {
  const { syncStatus } = model;
  if (syncStatus.state === 'synced') return 'Alle Score-Daten synchronisiert';
  if (syncStatus.state === 'needs_attention')
    return 'Eine Änderung braucht deine Prüfung';
  if (syncStatus.state === 'syncing') return 'Änderungen werden synchronisiert';
  if (syncStatus.state === 'waiting_retry')
    return 'Offline gespeichert · nächster Versuch folgt';
  if (syncStatus.state === 'blocked')
    return 'Offline gespeichert · Synchronisierung wartet';
  if (syncStatus.state === 'resetting') return 'Rangliste wird aktualisiert';
  return `${syncStatus.pendingCount} Änderung${
    syncStatus.pendingCount === 1 ? '' : 'en'
  } lokal gespeichert`;
}

function syncState(model: GolfScorecardViewModel) {
  if (model.syncStatus.state === 'synced') return 'ready' as const;
  if (model.syncStatus.state === 'needs_attention') return 'attention' as const;
  if (
    model.syncStatus.state === 'syncing' ||
    model.syncStatus.state === 'resetting'
  ) {
    return 'syncing' as const;
  }
  return 'offline' as const;
}

function syncIcon(model: GolfScorecardViewModel): keyof typeof icons {
  return model.syncStatus.state === 'synced' ? 'check' : 'cloudOffline';
}

function previewLabel(preview: GolfDraftPreview) {
  if (preview.error) return preview.error;
  if (preview.netStrokes === null) return 'Noch keine Stableford-Vorschau';
  return `Lokale Vorschau: Netto ${preview.netStrokes}, ${preview.stablefordPoints} Stableford-Punkte`;
}

function formatScore(value: number | null) {
  return value === null ? '–' : String(value);
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 },
  scroll: { flex: 1 },
  content: {
    flexGrow: 1,
    gap: spacing.lg,
    paddingHorizontal: 18,
  },
  brandRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  brandLockup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  logo: { height: 52, width: 52 },
  brandName: { ...typography.heading, fontSize: 24 },
  titleRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  titleCopy: { flex: 1 },
  eyebrow: {
    ...typography.overline,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  title: { ...typography.display, fontSize: 38, lineHeight: 42 },
  eventTitle: {
    ...typography.bodyStrong,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  heroIcon: {
    alignItems: 'center',
    backgroundColor: colors.surfaceAction,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: borders.strong,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  messageCard: { padding: spacing.md },
  messageText: { ...typography.bodyStrong },
  stateCard: {
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
  stateTitle: { ...typography.heading, textAlign: 'center' },
  stateCopy: { ...typography.body, textAlign: 'center' },
  sectionHeader: {
    alignItems: 'baseline',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  sectionEyebrow: { ...typography.overline, color: colors.textSecondary },
  sectionProgress: { ...typography.label, color: colors.textSecondary },
  holeRail: {
    gap: spacing.sm,
    paddingBottom: spacing.xs,
    paddingRight: spacing.md,
  },
  holeButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.control,
    borderWidth: borders.chip,
    justifyContent: 'center',
    minHeight: componentMetrics.control.minimumTouchSize,
    minWidth: componentMetrics.control.minimumTouchSize,
    paddingVertical: spacing.xs,
  },
  holeButtonSelected: {
    backgroundColor: colors.surfaceBrand,
    ...elevations.compact,
  },
  holeButtonAttention: { backgroundColor: colors.surfaceBrand },
  holeButtonPressed: { transform: [{ translateX: 1 }, { translateY: 1 }] },
  holeNumber: { ...typography.bodyStrong },
  scoreCard: { gap: spacing.lg, padding: spacing.lg },
  scoreHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  scoreOverline: { ...typography.overline },
  scoreTitle: { ...typography.heading, marginTop: spacing.xs },
  inputRow: { flexDirection: 'row', gap: spacing.md },
  scoreInputGroup: { flex: 1, gap: spacing.sm },
  inputLabel: { ...typography.label },
  scoreInput: {
    ...typography.numeric,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.control,
    borderWidth: borders.strong,
    minHeight: 60,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    textAlign: 'center',
  },
  previewRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.card,
    borderWidth: borders.chip,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  previewLabel: { ...typography.overline },
  previewHint: { ...typography.caption, marginTop: spacing.xs, maxWidth: 200 },
  pointsBadge: { alignItems: 'center', minWidth: 64 },
  pointsValue: { ...typography.numeric },
  pointsLabel: { ...typography.caption },
  scoreActions: { gap: spacing.md },
  conflictCard: { gap: spacing.md },
  conflictTitle: { ...typography.subheading },
  conflictCopy: { ...typography.body },
  versionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  versionCard: { flex: 1, gap: spacing.xs, minWidth: 132, padding: spacing.md },
  versionLabel: { ...typography.overline },
  versionScore: { ...typography.bodyStrong },
  versionMeta: { ...typography.caption },
  readOnlyCard: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
  },
  readOnlyCopy: { flex: 1 },
  readOnlyTitle: { ...typography.subheading },
  readOnlyText: { ...typography.body, marginTop: spacing.xs },
  leaderboardSection: { gap: spacing.md },
  leaderboardCard: { overflow: 'hidden', padding: 0 },
  leaderboardRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 72,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  leaderboardRowSelf: { backgroundColor: colors.surfaceAction },
  leaderboardDivider: {
    borderColor: colors.divider,
    borderTopWidth: borders.subtle,
  },
  rank: { ...typography.heading, minWidth: 28, textAlign: 'center' },
  leaderboardPerson: { flex: 1 },
  leaderboardName: { ...typography.bodyStrong },
  leaderboardMeta: { ...typography.caption, color: colors.textSecondary },
  leaderboardPoints: { alignItems: 'flex-end', minWidth: 52 },
  leaderboardPointsValue: { ...typography.numeric },
  leaderboardPointsLabel: { ...typography.caption },
  emptyLeaderboard: {
    ...typography.body,
    padding: spacing.lg,
    textAlign: 'center',
  },
});
