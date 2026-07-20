import type { ImageSourcePropType } from 'react-native';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card, StatusChip, SyncStatus, TextField } from '../design/primitives';
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
import type {
  EventSetupCapabilityType,
  EventSetupPlaceCandidate,
  EventSetupRecoverySnapshot,
  EventSetupTemplateId,
} from './EventSetupRecoveryRuntime';

const icons = {
  arrowRight: require('../assets/icons/arrow-right.png'),
  calendar: require('../assets/icons/calendar.png'),
  check: require('../assets/icons/check.png'),
  cloudOffline: require('../assets/icons/cloud-offline.png'),
  crew: require('../assets/icons/crew.png'),
  flag: require('../assets/icons/flag.png'),
  golf: require('../assets/icons/golf.png'),
  location: require('../assets/icons/location.png'),
} satisfies Record<string, ImageSourcePropType>;

export type EventSetupRecoveryAction =
  | 'adopt_template'
  | 'bind_place'
  | 'refresh'
  | 'restore_capability'
  | 'search_places';

export type EventSetupRecoveryViewModel = {
  busyAction: EventSetupRecoveryAction | null;
  message: string | null;
  online: boolean;
  phase: 'concealed' | 'loading' | 'ready' | 'resolved';
  placeQuery: string;
  placeResults: readonly EventSetupPlaceCandidate[];
  selectedPlaceId: string | null;
  selectedTemplateId: EventSetupTemplateId | null;
  snapshot: EventSetupRecoverySnapshot | null;
};

export type EventSetupRecoveryViewProps = {
  model: EventSetupRecoveryViewModel;
  onBack(): void;
  onPlaceQueryChange(value: string): void;
  onPrimaryAction(action: EventSetupRecoveryAction): void;
  onSelectPlace(id: string): void;
  onSelectTemplate(id: EventSetupTemplateId): void;
};

export function EventSetupRecoveryView({
  model,
  onBack,
  onPlaceQueryChange,
  onPrimaryAction,
  onSelectPlace,
  onSelectTemplate,
}: EventSetupRecoveryViewProps) {
  const presentation = framePresentation(model);

  return (
    <ScreenFrame
      description={presentation.description}
      eyebrow="EVENT SETUP"
      icon={presentation.icon}
      key={model.phase}
      liveRegion={presentation.liveRegion}
      statusLabel={presentation.statusLabel}
      testID="event-setup-recovery-view"
      title={presentation.title}
      tone={presentation.tone}
    >
      {model.phase === 'loading' ? (
        <Text accessibilityLiveRegion="polite" style={styles.body}>
          Der sichere Eventstand wird geprüft.
        </Text>
      ) : null}
      {model.phase === 'concealed' ? (
        <ConcealedState
          model={model}
          onBack={onBack}
          onPrimaryAction={onPrimaryAction}
        />
      ) : null}
      {model.phase === 'resolved' && model.snapshot ? (
        <ResolvedState model={model} onBack={onBack} />
      ) : null}
      {model.phase === 'ready' && model.snapshot ? (
        <ReadyState
          model={{ ...model, snapshot: model.snapshot }}
          onBack={onBack}
          onPlaceQueryChange={onPlaceQueryChange}
          onPrimaryAction={onPrimaryAction}
          onSelectPlace={onSelectPlace}
          onSelectTemplate={onSelectTemplate}
        />
      ) : null}
    </ScreenFrame>
  );
}

function ConcealedState({
  model,
  onBack,
  onPrimaryAction,
}: {
  model: EventSetupRecoveryViewModel;
  onBack(): void;
  onPrimaryAction(action: EventSetupRecoveryAction): void;
}) {
  return (
    <>
      <Text style={styles.body}>
        {model.message ??
          'Dieser private Setup-Ablauf ist für dieses Konto nicht verfügbar.'}
      </Text>
      <View style={styles.actions}>
        {model.online ? (
          <Button
            accessibilityHint="Prüft Konto, Rolle und Eventstand erneut online."
            icon={<ScreenIcon source={icons.cloudOffline} />}
            label="Erneut prüfen"
            loading={model.busyAction === 'refresh'}
            onPress={() => onPrimaryAction('refresh')}
            testID="event-setup-primary-action"
            variant="action"
          />
        ) : null}
        <Button
          accessibilityHint="Kehrt ohne Änderung zur Event-Prüfung zurück."
          label="Zurück zur Prüfung"
          disabled={Boolean(model.busyAction)}
          onPress={onBack}
          testID="event-setup-back-action"
          variant="surface"
        />
      </View>
    </>
  );
}

function ResolvedState({
  model,
  onBack,
}: {
  model: EventSetupRecoveryViewModel;
  onBack(): void;
}) {
  return (
    <>
      <Text style={styles.body}>
        {model.message ??
          (model.snapshot?.source === 'online'
            ? 'Der aktuelle Serverstand meldet diesen Prüfpunkt nicht mehr als offen.'
            : 'Die gespeicherte Prüfung meldet diesen Prüfpunkt nicht mehr als offen. Bestätige den Stand online in der Prüfung.')}
      </Text>
      <Button
        accessibilityHint="Kehrt zur Prüfung zurück und lädt dort den aktuellen Serverstand."
        icon={<ScreenIcon source={icons.arrowRight} />}
        label="Zurück zur Prüfung"
        disabled={Boolean(model.busyAction)}
        onPress={onBack}
        testID="event-setup-primary-action"
        variant="action"
      />
    </>
  );
}

function ReadyState({
  model,
  onBack,
  onPlaceQueryChange,
  onPrimaryAction,
  onSelectPlace,
  onSelectTemplate,
}: EventSetupRecoveryViewProps & {
  model: EventSetupRecoveryViewModel & {
    snapshot: EventSetupRecoverySnapshot;
  };
}) {
  const snapshot = model.snapshot;
  const authoritative = snapshot.source === 'online';
  const primary = primaryAction(model);
  return (
    <>
      <View style={styles.metaRow}>
        <StatusChip label={roleLabel(snapshot.role)} tone="surface" />
        <StatusChip
          label={templateLabel(snapshot.template)}
          tone="lavender"
        />
      </View>
      <SyncStatus
        icon={
          <ScreenIcon
            size={17}
            source={authoritative ? icons.check : icons.cloudOffline}
          />
        }
        label={sourceLabel(snapshot)}
        state={authoritative ? 'ready' : 'offline'}
      />

      {!authoritative ? (
        <Card accessibilityRole="alert" style={styles.notice} tone="brand">
          <Text style={styles.cardTitle}>
            {model.online
              ? 'Serverstand nicht bestätigt'
              : 'Nur sichere Offline-Kopie'}
          </Text>
          <Text style={styles.body}>
            Du kannst den zuletzt bestätigten Kontext lesen. Setup, Fähigkeit
            und Hauptort werden ohne aktuelle Serverprüfung weder vorgemerkt
            noch geändert.
          </Text>
        </Card>
      ) : null}

      {snapshot.intent.code === 'EVENT_TEMPLATE_REQUIRED' ? (
        <TemplateRecovery
          model={model}
          onSelectTemplate={onSelectTemplate}
        />
      ) : null}
      {snapshot.intent.code === 'EVENT_CAPABILITY_REQUIRED' ? (
        <CapabilityRecovery snapshot={snapshot} />
      ) : null}
      {snapshot.intent.code === 'EVENT_CAPABILITY_PLACE_REQUIRED' ? (
        <PlaceRecovery
          model={model}
          onPlaceQueryChange={onPlaceQueryChange}
          onPrimaryAction={onPrimaryAction}
          onSelectPlace={onSelectPlace}
        />
      ) : null}

      {model.message ? (
        <Card accessibilityLiveRegion="polite" style={styles.notice} tone="brand">
          <Text style={styles.body}>{model.message}</Text>
        </Card>
      ) : null}

      <View style={styles.actions}>
        {primary ? (
          <Button
            accessibilityHint={primary.hint}
            icon={<ScreenIcon source={primary.icon} />}
            label={primary.label}
            loading={model.busyAction === primary.action}
            onPress={() => onPrimaryAction(primary.action)}
            testID="event-setup-primary-action"
            variant="action"
          />
        ) : null}
        <Button
          accessibilityHint="Kehrt ohne weitere Änderung zur Event-Prüfung zurück."
          label="Zurück zur Prüfung"
          disabled={Boolean(model.busyAction)}
          onPress={onBack}
          testID="event-setup-back-action"
          variant="surface"
        />
      </View>
    </>
  );
}

function TemplateRecovery({
  model,
  onSelectTemplate,
}: {
  model: EventSetupRecoveryViewModel & {
    snapshot: EventSetupRecoverySnapshot;
  };
  onSelectTemplate(id: EventSetupTemplateId): void;
}) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        Passendes Start-Setup
      </Text>
      <Text style={styles.body}>
        Wähle die Struktur, die zu diesem privaten Event passt. Deine bereits
        eingegebenen Event-Details bleiben erhalten.
      </Text>
      <View accessibilityRole="radiogroup" style={styles.optionList}>
        {model.snapshot.templates.map(template => (
          <OptionCard
            disabled={Boolean(model.busyAction) || model.snapshot.source !== 'online'}
            icon={templateIcon(template.id)}
            key={template.id}
            label={`${templateLabel(template.id)}. ${template.summary}`}
            onPress={() => onSelectTemplate(template.id)}
            selected={model.selectedTemplateId === template.id}
            subtitle={template.summary}
            testID={`event-setup-template-${template.id}`}
            title={templateLabel(template.id)}
          />
        ))}
      </View>
      {model.snapshot.source === 'online' && model.selectedTemplateId ? (
        <Card style={styles.notice} tone="lavender">
          <Text style={styles.cardTitle}>
            Ausgewählt: {templateLabel(model.selectedTemplateId)}
          </Text>
          <Text style={styles.body}>
            Die bestehende Event-Basis bleibt erhalten. Neue Bausteine werden
            erst nach der versionierten Serverprüfung angelegt.
          </Text>
        </Card>
      ) : null}
    </View>
  );
}

function CapabilityRecovery({
  snapshot,
}: {
  snapshot: EventSetupRecoverySnapshot;
}) {
  const target = snapshot.target;
  if (!target) return null;
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        Fehlendes Setup wiederherstellen
      </Text>
      <Card style={styles.capabilityCard} tone="lavender">
        <View style={styles.cardHeading}>
          <RoundIcon source={capabilityIcon(target.type)} />
          <View style={styles.copy}>
            <Text style={styles.cardTitle}>{capabilityLabel(target.type)}</Text>
            <Text style={styles.body}>{target.eventTitle}</Text>
          </View>
        </View>
        <Text style={styles.body}>{capabilitySummary(target.type)}</Text>
        <Text style={styles.note}>
          Die serverseitige Vorlage liefert die typisierte Standardkonfiguration.
        </Text>
      </Card>
    </View>
  );
}

function PlaceRecovery({
  model,
  onPlaceQueryChange,
  onPrimaryAction,
  onSelectPlace,
}: {
  model: EventSetupRecoveryViewModel & {
    snapshot: EventSetupRecoverySnapshot;
  };
  onPlaceQueryChange(value: string): void;
  onPrimaryAction(action: EventSetupRecoveryAction): void;
  onSelectPlace(id: string): void;
}) {
  const target = model.snapshot.target;
  if (!target) return null;
  const selected = model.placeResults.find(
    result => result.id === model.selectedPlaceId,
  );
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        Hauptort für {capabilityLabel(target.type)}
      </Text>
      <Card style={styles.capabilityCard} tone="lavender">
        <View style={styles.cardHeading}>
          <RoundIcon source={icons.location} />
          <View style={styles.copy}>
            <Text style={styles.cardTitle}>{target.eventTitle}</Text>
            <Text style={styles.body}>
              {target.currentPlaceName ?? 'Noch kein Hauptort verbunden'}
            </Text>
          </View>
        </View>
      </Card>
      <TextField
        autoCapitalize="words"
        autoComplete="off"
        disabled={
          model.snapshot.source !== 'online' || Boolean(model.busyAction)
        }
        helpText="Suche nach Ort, Golfplatz oder Venue."
        label="Hauptort suchen"
        maxLength={120}
        onChangeText={onPlaceQueryChange}
        onSubmitEditing={() => {
          if (model.placeQuery.trim()) onPrimaryAction('search_places');
        }}
        placeholder={
          target.type === 'golf'
            ? 'Zum Beispiel: Golf Club'
            : 'Zum Beispiel: Zürich'
        }
        returnKeyType="search"
        testID="event-setup-place-query"
        value={model.placeQuery}
      />
      {model.placeResults.length > 0 ? (
        <View accessibilityRole="radiogroup" style={styles.optionList}>
          {model.placeResults.map(result => (
            <OptionCard
              disabled={
                Boolean(model.busyAction) ||
                model.snapshot.source !== 'online'
              }
              icon={icons.location}
              key={result.id}
              label={`${result.name}. ${placeSubtitle(result)}`}
              onPress={() => onSelectPlace(result.id)}
              selected={model.selectedPlaceId === result.id}
              subtitle={placeSubtitle(result)}
              testID={`event-setup-place-${result.id}`}
              title={result.name}
            />
          ))}
        </View>
      ) : null}
      {selected ? (
        <Card style={styles.notice} tone="action">
          <Text style={styles.cardTitle}>Ausgewählt: {selected.name}</Text>
          <Text style={styles.body}>
            Der Ort wird zuerst sicher im Event angelegt und danach nur im
            betroffenen Setup als Hauptort verbunden.
          </Text>
        </Card>
      ) : null}
    </View>
  );
}

function OptionCard({
  disabled,
  icon,
  label,
  onPress,
  selected,
  subtitle,
  testID,
  title,
}: {
  disabled: boolean;
  icon: ImageSourcePropType;
  label: string;
  onPress(): void;
  selected: boolean;
  subtitle: string;
  testID: string;
  title: string;
}) {
  return (
    <Pressable
      accessibilityHint="Wählt diesen Eintrag aus."
      accessibilityLabel={label}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={styles.optionPressable}
      testID={testID}
    >
      {({ pressed }) => (
        <Card
          style={[
            styles.optionCard,
            selected && styles.optionSelected,
            disabled && styles.optionDisabled,
            pressed && styles.optionPressed,
            pressed && elevations.pressed,
          ]}
          tone={selected ? 'action' : 'surface'}
        >
          <RoundIcon source={icon} />
          <View style={styles.copy}>
            <Text style={styles.optionTitle}>{title}</Text>
            <Text style={styles.body}>{subtitle}</Text>
          </View>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.radio, selected && styles.radioSelected]}
          >
            {selected ? <View style={styles.radioDot} /> : null}
          </View>
        </Card>
      )}
    </Pressable>
  );
}

function RoundIcon({ source }: { source: ImageSourcePropType }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.roundIcon}
    >
      <Image resizeMode="contain" source={source} style={styles.iconImage} />
    </View>
  );
}

function primaryAction(model: EventSetupRecoveryViewModel): {
  action: EventSetupRecoveryAction;
  hint: string;
  icon: ImageSourcePropType;
  label: string;
} | null {
  const snapshot = model.snapshot;
  if (!snapshot || !model.online || model.phase !== 'ready') return null;
  if (snapshot.source === 'cached') {
    return {
      action: 'refresh',
      hint: 'Lädt Rolle, Setup und Prüfpunkt erneut vom Gateway.',
      icon: icons.cloudOffline,
      label: 'Erneut online prüfen',
    };
  }
  if (
    snapshot.intent.code === 'EVENT_TEMPLATE_REQUIRED' &&
    model.selectedTemplateId
  ) {
    return {
      action: 'adopt_template',
      hint: 'Übernimmt das ausgewählte Setup versioniert in den bestehenden privaten Entwurf.',
      icon: icons.arrowRight,
      label: 'Setup übernehmen',
    };
  }
  if (snapshot.intent.code === 'EVENT_CAPABILITY_REQUIRED') {
    return {
      action: 'restore_capability',
      hint: 'Stellt die typisierte Fähigkeit mit der aktuellen Serverversion wieder her.',
      icon: icons.check,
      label: 'Setup wiederherstellen',
    };
  }
  if (snapshot.intent.code === 'EVENT_CAPABILITY_PLACE_REQUIRED') {
    if (model.selectedPlaceId) {
      return {
        action: 'bind_place',
        hint: 'Legt den ausgewählten Ort im Event an und verbindet ihn als Hauptort.',
        icon: icons.arrowRight,
        label: 'Als Hauptort übernehmen',
      };
    }
    if (model.placeQuery.trim()) {
      return {
        action: 'search_places',
        hint: 'Sucht online nach passenden Orten, ohne das Event zu verändern.',
        icon: icons.location,
        label: 'Orte suchen',
      };
    }
  }
  return null;
}

function framePresentation(model: EventSetupRecoveryViewModel) {
  if (model.phase === 'loading') {
    return {
      description: 'Konto, Rolle und letzter Eventstand werden sicher geprüft.',
      icon: icons.cloudOffline,
      liveRegion: 'polite' as const,
      statusLabel: 'WIRD GELADEN',
      title: 'Setup wird geladen',
      tone: 'surface' as const,
    };
  }
  if (model.phase === 'concealed') {
    return {
      description: 'Dieser private Setup-Ablauf bleibt sicher verborgen.',
      icon: icons.cloudOffline,
      liveRegion: 'assertive' as const,
      statusLabel: 'NICHT VERFÜGBAR',
      title: 'Setup nicht verfügbar',
      tone: 'brand' as const,
    };
  }
  if (model.phase === 'resolved') {
    const cached = model.snapshot?.source === 'cached';
    return {
      description: model.snapshot?.eventTitle ?? 'Dein Event',
      icon: cached ? icons.cloudOffline : icons.check,
      liveRegion: 'polite' as const,
      statusLabel: cached ? 'GESPEICHERTE PRÜFUNG' : 'PRÜFPUNKT ERLEDIGT',
      title: cached ? 'Gespeicherter Stand passt' : 'Aktueller Stand passt',
      tone: cached ? ('brand' as const) : ('action' as const),
    };
  }
  const code = model.snapshot?.intent.code;
  return {
    description: model.snapshot?.eventTitle ?? 'Dein Event',
    icon:
      code === 'EVENT_CAPABILITY_PLACE_REQUIRED'
        ? icons.location
        : code === 'EVENT_CAPABILITY_REQUIRED'
        ? icons.flag
        : icons.calendar,
    liveRegion: 'polite' as const,
    statusLabel: model.snapshot?.source === 'online' ? 'ONLINE GEPRÜFT' : 'OFFLINE-KOPIE',
    title:
      code === 'EVENT_CAPABILITY_PLACE_REQUIRED'
        ? 'Hauptort festlegen'
        : code === 'EVENT_CAPABILITY_REQUIRED'
        ? 'Setup wiederherstellen'
        : 'Start-Setup wählen',
    tone: 'surface' as const,
  };
}

function roleLabel(role: EventSetupRecoverySnapshot['role']) {
  return role === 'owner' ? 'Eigentümer:in' : 'Organisator:in';
}

function sourceLabel(snapshot: EventSetupRecoverySnapshot) {
  if (snapshot.source === 'cached') {
    return snapshot.checkedAt
      ? 'Offline-Kopie · letzte gespeicherte Prüfung'
      : 'Offline-Kopie · Prüfpunkt online bestätigen';
  }
  return 'Aktueller Serverstand · Änderungen nur online';
}

function templateLabel(value: EventSetupTemplateId | null) {
  if (value === 'golf-tour') return 'Golfreise';
  if (value === 'team-event') return 'Teamevent';
  if (value === 'travel') return 'Reise';
  return 'Setup offen';
}

function capabilityLabel(type: EventSetupCapabilityType) {
  if (type === 'golf') return 'Golfrunde';
  if (type === 'lodging') return 'Unterkunft';
  if (type === 'team') return 'Teameinteilung';
  if (type === 'transport') return 'Transport';
  return 'Reise';
}

function capabilitySummary(type: EventSetupCapabilityType) {
  if (type === 'golf') return 'Stableford, Abschlag und Handicap bleiben typisiert.';
  if (type === 'lodging') return 'Check-in, Check-out und Zimmervergabe bleiben typisiert.';
  if (type === 'team') return 'Zuteilung, Kapazität und Moderation bleiben typisiert.';
  if (type === 'transport') return 'Treffpunkt und Anreisemodus bleiben typisiert.';
  return 'Heimatort und Reisereferenz bleiben typisiert.';
}

function templateIcon(id: EventSetupTemplateId) {
  if (id === 'golf-tour') return icons.golf;
  if (id === 'team-event') return icons.crew;
  return icons.calendar;
}

function capabilityIcon(type: EventSetupCapabilityType) {
  if (type === 'golf') return icons.golf;
  if (type === 'team') return icons.crew;
  return icons.calendar;
}

function placeSubtitle(place: EventSetupPlaceCandidate) {
  return [place.locality, place.region, place.countryCode]
    .filter(Boolean)
    .join(' · ');
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
  capabilityCard: {
    gap: spacing.md,
  },
  cardHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  cardTitle: {
    ...typography.subheading,
    color: colors.text,
  },
  copy: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  iconImage: {
    height: 24,
    width: 24,
  },
  metaRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  note: {
    ...typography.caption,
    color: colors.text,
  },
  notice: {
    gap: spacing.sm,
  },
  optionCard: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 96,
    padding: spacing.lg,
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
  optionDisabled: {
    opacity: componentMetrics.control.disabledOpacity,
  },
  optionTitle: {
    ...typography.bodyStrong,
    color: colors.text,
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
  roundIcon: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: borders.chip,
    height: componentMetrics.control.minimumTouchSize,
    justifyContent: 'center',
    width: componentMetrics.control.minimumTouchSize,
  },
  section: {
    gap: spacing.md,
  },
  sectionTitle: {
    ...typography.overline,
    color: colors.text,
  },
});
