import type { ImageSourcePropType } from 'react-native';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Button, Card, StatusChip, TextField } from '../design/primitives';
import {
  borders,
  colors,
  componentMetrics,
  elevations,
  radii,
  spacing,
  typography,
} from '../design/theme';
import { ScreenFrame, ScreenIcon } from './ScreenFrame';

const icons = {
  arrowRight: require('../assets/icons/arrow-right.png'),
  calendar: require('../assets/icons/calendar.png'),
  check: require('../assets/icons/check.png'),
  cloudOffline: require('../assets/icons/cloud-offline.png'),
  crew: require('../assets/icons/crew.png'),
  golf: require('../assets/icons/golf.png'),
} satisfies Record<string, ImageSourcePropType>;

export type EventCreateOption = {
  id: 'blank' | 'golf-tour' | 'team-event' | 'travel';
  kind: 'blank' | 'template';
  logicalKeys: readonly string[];
  rootKind:
    | 'activity'
    | 'day'
    | 'golf'
    | 'other'
    | 'session'
    | 'team_event'
    | 'trip';
  summary: string;
  title: string;
  version?: number;
};

export type EventCreateViewState =
  | { kind: 'loading' }
  | {
      kind: 'shape';
      options: readonly EventCreateOption[];
      retryingTemplates: boolean;
      selectedId: EventCreateOption['id'] | null;
      templatesUnavailable: boolean;
    }
  | {
      description: string;
      kind: 'details';
      option: EventCreateOption;
      submissionError: string | null;
      submitting: boolean;
      timeZone: string;
      title: string;
      titleError: string | null;
    }
  | {
      kind: 'queued';
      mode: 'attention' | 'offline' | 'syncing';
      recovery: 'none' | 'retry' | 'review';
      retrying: boolean;
      rootEventId: string;
      title: string;
    }
  | { kind: 'unavailable' };

export type EventCreateViewProps = {
  onBack(): void;
  onDescriptionChange(value: string): void;
  onExit(): void;
  onReviewCreation(): void;
  onRetryCreation(): void;
  onRetryTemplates(): void;
  onSelectOption(id: EventCreateOption['id']): void;
  onSubmit(): void;
  onTitleChange(value: string): void;
  onUseOption(): void;
  state: EventCreateViewState;
};

export function EventCreateView({
  onBack,
  onDescriptionChange,
  onExit,
  onReviewCreation,
  onRetryCreation,
  onRetryTemplates,
  onSelectOption,
  onSubmit,
  onTitleChange,
  onUseOption,
  state,
}: EventCreateViewProps) {
  const presentation = framePresentation(state);

  return (
    <ScreenFrame
      description={presentation.description}
      eyebrow="EVENT ERSTELLEN"
      icon={presentation.icon}
      key={state.kind}
      liveRegion={presentation.liveRegion}
      statusLabel={presentation.statusLabel}
      testID="event-create-view"
      title={presentation.title}
      tone={presentation.tone}
    >
      {state.kind === 'loading' ? <LoadingState /> : null}
      {state.kind === 'shape' ? (
        <ShapeState
          onBack={onBack}
          onRetryTemplates={onRetryTemplates}
          onSelectOption={onSelectOption}
          onUseOption={onUseOption}
          state={state}
        />
      ) : null}
      {state.kind === 'details' ? (
        <DetailsState
          onBack={onBack}
          onDescriptionChange={onDescriptionChange}
          onSubmit={onSubmit}
          onTitleChange={onTitleChange}
          state={state}
        />
      ) : null}
      {state.kind === 'queued' ? (
        <QueuedState
          onExit={onExit}
          onReview={onReviewCreation}
          onRetry={onRetryCreation}
          state={state}
        />
      ) : null}
      {state.kind === 'unavailable' ? (
        <UnavailableState onExit={onExit} />
      ) : null}
    </ScreenFrame>
  );
}

function LoadingState() {
  return (
    <View accessibilityLiveRegion="polite" style={styles.centeredState}>
      <ActivityIndicator
        accessibilityLabel="Event-Erstellung wird vorbereitet"
        color={colors.textSecondary}
        size="large"
      />
      <Text style={styles.body}>Dein sicherer Entwurf wird vorbereitet.</Text>
    </View>
  );
}

function ShapeState({
  onBack,
  onRetryTemplates,
  onSelectOption,
  onUseOption,
  state,
}: {
  onBack(): void;
  onRetryTemplates(): void;
  onSelectOption(id: EventCreateOption['id']): void;
  onUseOption(): void;
  state: Extract<EventCreateViewState, { kind: 'shape' }>;
}) {
  const selected = state.options.find(option => option.id === state.selectedId);

  return (
    <>
      <Text style={styles.sectionTitle}>WIE MÖCHTEST DU STARTEN?</Text>
      <Text style={styles.body}>
        Wähle ein verfügbares Setup oder beginne mit einem leeren Event.
      </Text>
      <View accessibilityRole="radiogroup" style={styles.optionList}>
        {state.options.map(option => (
          <CreateOptionCard
            key={option.id}
            onPress={() => onSelectOption(option.id)}
            option={option}
            selected={option.id === state.selectedId}
          />
        ))}
      </View>
      {state.templatesUnavailable ? (
        <Card
          accessibilityLiveRegion="polite"
          style={styles.notice}
          tone="brand"
        >
          <Text style={styles.noticeTitle}>Setups gerade nicht verfügbar</Text>
          <Text style={styles.body}>
            Vorschläge sind nicht verfügbar. Du kannst ohne Vorlage starten.
          </Text>
          <Button
            label="Setups erneut laden"
            loading={state.retryingTemplates}
            onPress={onRetryTemplates}
            testID="event-create-retry-templates"
            variant="surface"
          />
        </Card>
      ) : null}
      <View style={styles.actions}>
        <Button
          accessibilityHint="Öffnet die Event-Details für die gewählte Startart."
          disabled={!selected}
          icon={<ScreenIcon source={icons.arrowRight} />}
          label={
            selected?.kind === 'template'
              ? 'Dieses Setup verwenden'
              : 'Leer starten'
          }
          onPress={onUseOption}
          testID="event-create-use-option"
          variant="action"
        />
        <Button
          accessibilityHint="Kehrt zu deiner Eventliste zurück."
          label="Zurück zu Events"
          onPress={onBack}
          testID="event-create-back"
          variant="surface"
        />
      </View>
    </>
  );
}

function CreateOptionCard({
  onPress,
  option,
  selected,
}: {
  onPress(): void;
  option: EventCreateOption;
  selected: boolean;
}) {
  return (
    <Pressable
      accessibilityHint="Wählt diese Startart aus."
      accessibilityLabel={`${option.title}. ${option.summary}`}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={styles.optionPressable}
      testID={`event-create-option-${option.id}`}
    >
      {({ pressed }) => (
        <Card
          elevated
          style={[
            styles.optionCard,
            selected && styles.optionSelected,
            pressed && styles.optionPressed,
            pressed && elevations.pressed,
          ]}
          tone={selected ? 'action' : optionTone(option.id)}
        >
          <View style={styles.optionHeader}>
            <View style={styles.optionIcon}>
              <AssetIcon name={optionIcon(option.id)} size={24} />
            </View>
            <View style={styles.optionCopy}>
              <Text style={styles.optionTitle}>{option.title}</Text>
              <Text style={styles.body}>{option.summary}</Text>
            </View>
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[styles.radio, selected && styles.radioSelected]}
            >
              {selected ? <View style={styles.radioDot} /> : null}
            </View>
          </View>
        </Card>
      )}
    </Pressable>
  );
}

function DetailsState({
  onBack,
  onDescriptionChange,
  onSubmit,
  onTitleChange,
  state,
}: {
  onBack(): void;
  onDescriptionChange(value: string): void;
  onSubmit(): void;
  onTitleChange(value: string): void;
  state: Extract<EventCreateViewState, { kind: 'details' }>;
}) {
  return (
    <>
      <StatusChip label={state.option.title} tone="surface" />
      <Text style={styles.body}>
        Nur Titel und Zeitzone sind erforderlich. Weitere Angaben kannst du
        später ergänzen.
      </Text>
      <TextField
        autoCapitalize="sentences"
        autoComplete="off"
        disabled={state.submitting}
        error={state.titleError ?? undefined}
        label="Titel"
        maxLength={160}
        onChangeText={onTitleChange}
        onSubmitEditing={onSubmit}
        placeholder="Zum Beispiel: Crew-Wochenende"
        returnKeyType="done"
        testID="event-create-title"
        value={state.title}
      />
      <TextField
        autoCapitalize="sentences"
        autoComplete="off"
        disabled={state.submitting}
        helpText="Optional. Du kannst die Beschreibung später ändern."
        inputStyle={styles.descriptionInput}
        label="Beschreibung"
        maxLength={20_000}
        multiline
        onChangeText={onDescriptionChange}
        placeholder="Was plant ihr gemeinsam?"
        testID="event-create-description"
        textAlignVertical="top"
        value={state.description}
      />
      <Card style={styles.timeZoneCard} tone="lavender">
        <Text style={styles.sectionTitle}>ZEITZONE</Text>
        <Text style={styles.optionTitle}>{state.timeZone}</Text>
        <Text style={styles.body}>
          Crew verwendet die Zeitzone dieses Geräts. Du kannst sie später im
          Event ändern.
        </Text>
      </Card>
      {state.submissionError ? (
        <Text
          accessibilityLiveRegion="assertive"
          accessibilityRole="alert"
          style={styles.error}
        >
          {state.submissionError}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button
          accessibilityHint="Speichert den Entwurf dauerhaft und synchronisiert ihn sicher."
          icon={<ScreenIcon source={icons.check} />}
          label="Details speichern"
          loading={state.submitting}
          onPress={onSubmit}
          testID="event-create-submit"
          variant="action"
        />
        <Button
          accessibilityHint="Kehrt zur Wahl des Setups zurück; deine Eingaben bleiben in dieser Ansicht erhalten."
          disabled={state.submitting}
          label="Zurück zur Auswahl"
          onPress={onBack}
          testID="event-create-details-back"
          variant="surface"
        />
      </View>
    </>
  );
}

function QueuedState({
  onExit,
  onReview,
  onRetry,
  state,
}: {
  onExit(): void;
  onReview(): void;
  onRetry(): void;
  state: Extract<EventCreateViewState, { kind: 'queued' }>;
}) {
  const syncing = state.mode === 'syncing';
  const attention = state.mode === 'attention';
  return (
    <>
      <View style={styles.queuedHeading}>
        {syncing ? (
          <ActivityIndicator
            accessibilityLabel="Entwurf wird synchronisiert"
            color={colors.textSecondary}
            size="large"
          />
        ) : (
          <View style={styles.queuedIcon}>
            <AssetIcon name={attention ? 'cloudOffline' : 'check'} size={28} />
          </View>
        )}
        <View style={styles.optionCopy}>
          <Text style={styles.optionTitle}>{state.title}</Text>
          <Text style={styles.body}>
            {queuedMessage(state.mode, state.recovery)}
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        {!syncing && state.recovery === 'retry' ? (
          <Button
            accessibilityHint="Versucht denselben sicher gespeicherten Entwurf erneut zu synchronisieren."
            icon={<ScreenIcon source={icons.arrowRight} />}
            label="Jetzt erneut versuchen"
            loading={state.retrying}
            onPress={onRetry}
            testID="event-create-retry"
            variant="action"
          />
        ) : null}
        {!syncing && state.recovery === 'review' ? (
          <Button
            accessibilityHint="Lädt aktuelle Setups und öffnet die lokal erhaltenen Angaben zur Prüfung."
            icon={<ScreenIcon source={icons.arrowRight} />}
            label="Setup und Angaben prüfen"
            onPress={onReview}
            testID="event-create-review"
            variant="action"
          />
        ) : null}
        <Button
          accessibilityHint="Öffnet deine Eventliste. Der Entwurf bleibt sicher gespeichert."
          disabled={state.retrying}
          label="Zu Events"
          onPress={onExit}
          testID="event-create-to-events"
          variant="surface"
        />
      </View>
    </>
  );
}

function UnavailableState({ onExit }: { onExit(): void }) {
  return (
    <>
      <Text accessibilityRole="alert" style={styles.body}>
        Die Event-Erstellung ist gerade nicht sicher verfügbar. Deine Eventliste
        bleibt unverändert.
      </Text>
      <Button
        label="Zu Events"
        onPress={onExit}
        testID="event-create-unavailable-exit"
        variant="surface"
      />
    </>
  );
}

function framePresentation(state: EventCreateViewState) {
  switch (state.kind) {
    case 'loading':
      return {
        description: 'Crew prüft vorhandene Entwürfe und verfügbare Setups.',
        icon: undefined,
        liveRegion: 'polite' as const,
        statusLabel: 'WIRD VORBEREITET',
        title: 'Start wird vorbereitet',
        tone: 'surface' as const,
      };
    case 'shape':
      return {
        description: 'Starte leer oder nutze ein vorbereitetes Setup.',
        icon: icons.calendar,
        liveRegion: 'polite' as const,
        statusLabel: 'SCHRITT 1 VON 2',
        title: 'Start wählen',
        tone: 'surface' as const,
      };
    case 'details':
      return {
        description:
          'Gib deinem Event einen klaren Titel. Alles Weitere kann später folgen.',
        icon: icons.crew,
        liveRegion: state.titleError
          ? ('assertive' as const)
          : ('none' as const),
        statusLabel: 'SCHRITT 2 VON 2',
        title: 'Event-Details',
        tone: 'surface' as const,
      };
    case 'queued':
      return {
        description:
          state.mode === 'syncing'
            ? 'Crew überträgt deinen sicher gespeicherten Entwurf.'
            : state.recovery === 'review'
            ? 'Der lokal gespeicherte Entwurf braucht eine Korrektur.'
            : 'Dein Entwurf bleibt auf diesem Gerät erhalten.',
        icon: state.mode === 'attention' ? icons.cloudOffline : icons.check,
        liveRegion: 'polite' as const,
        statusLabel:
          state.mode === 'syncing'
            ? 'WIRD SYNCHRONISIERT'
            : state.mode === 'attention'
            ? 'AKTION ERFORDERLICH'
            : 'LOKAL GESPEICHERT',
        title:
          state.mode === 'syncing'
            ? 'Event wird erstellt'
            : 'Entwurf gespeichert',
        tone:
          state.mode === 'attention' ? ('brand' as const) : ('action' as const),
      };
    case 'unavailable':
      return {
        description: 'Dieser private Ablauf ist gerade nicht verfügbar.',
        icon: icons.cloudOffline,
        liveRegion: 'assertive' as const,
        statusLabel: 'NICHT VERFÜGBAR',
        title: 'Event erstellen',
        tone: 'brand' as const,
      };
  }
}

function queuedMessage(
  mode: Extract<EventCreateViewState, { kind: 'queued' }>['mode'],
  recovery: Extract<EventCreateViewState, { kind: 'queued' }>['recovery'],
) {
  switch (mode) {
    case 'syncing':
      return 'Der Entwurf ist lokal gespeichert und wird jetzt synchronisiert.';
    case 'offline':
      return 'Entwurf lokal gespeichert. Wartet auf Verbindung.';
    case 'attention':
      return recovery === 'review'
        ? 'Der Server hat diesen Entwurf nicht angenommen. Deine Angaben bleiben lokal gespeichert. Prüfe Setup und Angaben.'
        : recovery === 'retry'
        ? 'Noch nicht synchronisiert. Deine Angaben sind erhalten. Versuche es erneut.'
        : 'Die Erstellung konnte nicht sicher abgeschlossen werden. Dein Entwurf bleibt lokal gespeichert.';
  }
}

function optionIcon(id: EventCreateOption['id']): keyof typeof icons {
  if (id === 'golf-tour') return 'golf';
  if (id === 'team-event') return 'crew';
  return 'calendar';
}

function optionTone(
  id: EventCreateOption['id'],
): 'brand' | 'lavender' | 'surface' {
  if (id === 'travel') return 'lavender';
  if (id === 'golf-tour') return 'brand';
  return 'surface';
}

function AssetIcon({ name, size }: { name: keyof typeof icons; size: number }) {
  return (
    <Image
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      resizeMode="contain"
      source={icons[name]}
      style={{ height: size, width: size }}
    />
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  body: {
    ...typography.body,
    color: colors.text,
  },
  centeredState: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xl,
  },
  descriptionInput: {
    minHeight: 112,
    paddingTop: spacing.md,
  },
  error: {
    ...typography.bodyStrong,
    color: colors.error,
  },
  notice: {
    gap: spacing.sm,
  },
  noticeTitle: {
    ...typography.subheading,
    color: colors.text,
  },
  optionCard: {
    minHeight: 116,
    padding: spacing.lg,
  },
  optionCopy: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  optionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  optionIcon: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: borders.chip,
    height: componentMetrics.control.minimumTouchSize,
    justifyContent: 'center',
    width: componentMetrics.control.minimumTouchSize,
  },
  optionList: {
    gap: spacing.md,
  },
  optionPressable: {
    minHeight: componentMetrics.control.minimumTouchSize,
  },
  optionPressed: {
    transform: [{ translateX: spacing.xxs }, { translateY: spacing.xxs }],
  },
  optionSelected: {
    borderColor: colors.focus,
  },
  optionTitle: {
    ...typography.subheading,
    color: colors.text,
  },
  queuedHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  queuedIcon: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: borders.chip,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  radio: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: borders.chip,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  radioDot: {
    backgroundColor: colors.text,
    borderRadius: radii.pill,
    height: 12,
    width: 12,
  },
  radioSelected: {
    borderColor: colors.focus,
    borderWidth: borders.strong,
  },
  sectionTitle: {
    ...typography.overline,
    color: colors.textSecondary,
  },
  timeZoneCard: {
    gap: spacing.xs,
  },
});
