import type { ImageSourcePropType } from 'react-native';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card, StatusChip, TextField } from '../design/primitives';
import { colors, spacing, typography } from '../design/theme';
import type { EventBasicsDelivery } from './EventBasicsRuntime';
import { ScreenFrame, ScreenIcon } from './ScreenFrame';

const icons = {
  arrowRight: require('../assets/icons/arrow-right.png'),
  calendar: require('../assets/icons/calendar.png'),
  check: require('../assets/icons/check.png'),
  cloudOffline: require('../assets/icons/cloud-offline.png'),
  flag: require('../assets/icons/flag.png'),
} satisfies Record<string, ImageSourcePropType>;

export type EventBasicsField =
  | 'description'
  | 'endsAt'
  | 'startsAt'
  | 'timeZone'
  | 'title';

export type EventBasicsForm = {
  description: string;
  endsAt: string;
  startsAt: string;
  timeZone: string;
  title: string;
};

export type EventBasicsPrimaryAction = 'back' | 'refresh' | 'save';

export type EventBasicsViewModel = {
  busyAction: Exclude<EventBasicsPrimaryAction, 'back'> | null;
  conflictCurrent: EventBasicsForm | null;
  delivery: EventBasicsDelivery;
  dirty: boolean;
  editable: boolean;
  errors: Partial<Record<EventBasicsField, string>>;
  focusField: EventBasicsField | null;
  form: EventBasicsForm;
  message: string | null;
  online: boolean;
  phase: 'concealed' | 'loading' | 'ready';
  role: 'organizer' | 'owner' | null;
  saved: boolean;
};

export type EventBasicsViewProps = {
  model: EventBasicsViewModel;
  onBack(): void;
  onChange(field: EventBasicsField, value: string): void;
  onPrimaryAction(action: EventBasicsPrimaryAction): void;
};

export function EventBasicsView({
  model,
  onBack,
  onChange,
  onPrimaryAction,
}: EventBasicsViewProps) {
  if (model.phase === 'loading') {
    return (
      <ScreenFrame
        description="Der accountgebundene Entwurf und seine lokale Warteschlange werden sicher geladen."
        eyebrow="EVENT-DETAILS"
        testID="event-basics-view"
        title="Details werden geladen"
      />
    );
  }
  if (model.phase === 'concealed') {
    return (
      <ScreenFrame
        description="Diese Event-Details sind für dieses Konto nicht verfügbar."
        eyebrow="EVENT-DETAILS"
        icon={icons.cloudOffline}
        liveRegion="polite"
        statusLabel="Sicher verborgen"
        testID="event-basics-view"
        title="Details nicht verfügbar"
        tone="brand"
      >
        <Button
          accessibilityHint="Kehrt ohne Änderung zur Veröffentlichungsprüfung zurück."
          label="Zurück zur Prüfung"
          onPress={onBack}
          testID="event-basics-back"
          variant="surface"
        />
      </ScreenFrame>
    );
  }

  const primary = primaryAction(model);
  const locked = !model.editable || model.busyAction !== null;
  return (
    <ScreenFrame
      description="Titel, Beschreibung und Termin des bestehenden privaten Entwurfs."
      eyebrow="EVENT-DETAILS"
      icon={model.delivery === 'conflict' ? icons.flag : icons.calendar}
      liveRegion="polite"
      statusLabel={deliveryLabel(model)}
      testID="event-basics-view"
      title="Event-Basis bearbeiten"
      tone={model.delivery === 'conflict' ? 'brand' : 'action'}
    >
      <View style={styles.metaRow}>
        <StatusChip
          label={model.role === 'owner' ? 'Eigentümer:in' : 'Organisator:in'}
          tone="lavender"
        />
        <StatusChip label="Privater Entwurf" tone="surface" />
      </View>

      {model.delivery === 'conflict' && model.conflictCurrent ? (
        <Card
          accessibilityLabel={`Serverstand geändert. Aktuell: ${formSummary(
            model.conflictCurrent,
          )}. Deine versuchten Angaben bleiben in den Feldern erhalten.`}
          accessibilityRole="alert"
          style={styles.notice}
          tone="brand"
        >
          <Text style={styles.cardEyebrow}>SERVERSTAND GEÄNDERT</Text>
          <Text style={styles.cardTitle}>Deine Angaben sind erhalten</Text>
          <Text style={styles.body}>
            Prüfe sie gegen den aktuellen Stand. Beim Speichern wird zuerst der
            verbrauchte Konflikt abgeschlossen und danach eine neue Änderung mit
            der aktuellen Version vorgemerkt.
          </Text>
          <View style={styles.currentPanel}>
            <Text style={styles.cardEyebrow}>AKTUELL AUF DEM SERVER</Text>
            <Text style={styles.body}>
              {formSummary(model.conflictCurrent)}
            </Text>
          </View>
        </Card>
      ) : null}

      {model.delivery === 'queued' || model.delivery === 'syncing' ? (
        <Card style={styles.notice} tone="action">
          <Text style={styles.cardTitle}>Lokal dauerhaft gespeichert</Text>
          <Text style={styles.body}>
            Diese eine Änderung wartet auf die Serverbestätigung. Bis dahin sind
            weitere Basisänderungen gesperrt; es wird keine zweite Version
            gestapelt.
          </Text>
        </Card>
      ) : null}

      {model.delivery === 'attention' ? (
        <Card style={styles.notice} tone="brand">
          <Text style={styles.cardTitle}>Änderung braucht Aufmerksamkeit</Text>
          <Text style={styles.body}>
            Die gespeicherten Angaben bleiben erhalten. Prüfe den Serverstand
            erneut, bevor du weiter bearbeitest.
          </Text>
        </Card>
      ) : null}

      <View style={styles.form}>
        <TextField
          autoFocus={model.focusField === 'title'}
          disabled={locked}
          error={model.errors.title}
          label="Event-Titel"
          maxLength={160}
          onChangeText={value => onChange('title', value)}
          testID="event-basics-title"
          value={model.form.title}
        />
        <TextField
          autoFocus={model.focusField === 'description'}
          disabled={locked}
          error={model.errors.description}
          label="Beschreibung"
          maxLength={20_000}
          multiline
          numberOfLines={5}
          onChangeText={value => onChange('description', value)}
          testID="event-basics-description"
          textAlignVertical="top"
          value={model.form.description}
        />
        <TextField
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus={model.focusField === 'timeZone'}
          disabled={locked}
          error={model.errors.timeZone}
          helpText="IANA-Zeitzone, zum Beispiel Europe/Zurich"
          label="Zeitzone"
          maxLength={100}
          onChangeText={value => onChange('timeZone', value)}
          testID="event-basics-time-zone"
          value={model.form.timeZone}
        />
        <TextField
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus={model.focusField === 'startsAt'}
          disabled={locked}
          error={model.errors.startsAt}
          helpText="JJJJ-MM-TT HH:MM in der gewählten Zeitzone"
          label="Beginn"
          maxLength={16}
          onChangeText={value => onChange('startsAt', value)}
          placeholder="2026-09-20 09:00"
          testID="event-basics-starts-at"
          value={model.form.startsAt}
        />
        <TextField
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus={model.focusField === 'endsAt'}
          disabled={locked}
          error={model.errors.endsAt}
          helpText="Muss nach dem Beginn liegen; leer lassen, wenn noch offen"
          label="Ende"
          maxLength={16}
          onChangeText={value => onChange('endsAt', value)}
          placeholder="2026-09-21 18:00"
          testID="event-basics-ends-at"
          value={model.form.endsAt}
        />
      </View>

      {model.message ? (
        <Card accessibilityLiveRegion="polite" tone="brand">
          <Text style={styles.message}>{model.message}</Text>
        </Card>
      ) : null}

      <View style={styles.actions}>
        <Button
          accessibilityHint={primary.hint}
          disabled={primary.disabled}
          icon={<ScreenIcon source={primary.icon} />}
          label={primary.label}
          loading={
            primary.action !== 'back' && model.busyAction === primary.action
          }
          onPress={() => onPrimaryAction(primary.action)}
          testID="event-basics-primary-action"
          variant="action"
        />
        {primary.action !== 'back' ? (
          <Button
            accessibilityHint="Kehrt ohne weitere Änderung zur Veröffentlichungsprüfung zurück."
            label="Zurück zur Prüfung"
            onPress={onBack}
            testID="event-basics-back"
            variant="surface"
          />
        ) : null}
      </View>
    </ScreenFrame>
  );
}

function primaryAction(model: EventBasicsViewModel): {
  action: EventBasicsPrimaryAction;
  disabled: boolean;
  hint: string;
  icon: ImageSourcePropType;
  label: string;
} {
  if (model.saved || (model.delivery === 'queued' && !model.online)) {
    return {
      action: 'back',
      disabled: false,
      hint: 'Kehrt zur Prüfung zurück. Online wird die verbindliche Bereitschaft neu geladen.',
      icon: icons.arrowRight,
      label: 'Zurück zur Prüfung',
    };
  }
  if (
    model.delivery === 'queued' ||
    model.delivery === 'syncing' ||
    model.delivery === 'attention'
  ) {
    return {
      action: 'refresh',
      disabled: !model.online,
      hint: 'Prüft die eine dauerhaft gespeicherte Änderung erneut online.',
      icon: icons.cloudOffline,
      label: model.online ? 'Serverstand erneut prüfen' : 'Verbindung abwarten',
    };
  }
  return {
    action: 'save',
    disabled:
      !model.dirty ||
      Object.keys(model.errors).length > 0 ||
      model.busyAction !== null,
    hint: 'Speichert genau eine account- und eventgebundene Änderung dauerhaft. Online wird sie anschliessend synchronisiert.',
    icon: model.delivery === 'conflict' ? icons.flag : icons.check,
    label:
      model.delivery === 'conflict'
        ? 'Aktualisierten Stand speichern'
        : 'Änderungen speichern',
  };
}

function deliveryLabel(model: EventBasicsViewModel) {
  if (model.delivery === 'conflict') return 'Konflikt prüfen';
  if (model.delivery === 'attention') return 'Aktion erforderlich';
  if (model.delivery === 'queued') return 'Lokal gespeichert';
  if (model.delivery === 'syncing') return 'Wird synchronisiert';
  if (!model.online) return 'Offline bearbeitbar';
  return model.dirty ? 'Ungespeicherte Änderungen' : 'Bereit';
}

function formSummary(form: EventBasicsForm) {
  const description = form.description.trim()
    ? 'Beschreibung vorhanden'
    : 'Beschreibung leer';
  const dates = [form.startsAt || 'Beginn offen', form.endsAt || 'Ende offen']
    .join(' bis ')
    .trim();
  return `${form.title || 'Titel offen'} · ${description} · ${dates} · ${
    form.timeZone || 'Zeitzone offen'
  }`;
}

const styles = StyleSheet.create({
  actions: {
    gap: spacing.md,
  },
  body: {
    ...typography.body,
    color: colors.text,
  },
  cardEyebrow: {
    ...typography.overline,
    color: colors.text,
  },
  cardTitle: {
    ...typography.subheading,
    color: colors.text,
  },
  currentPanel: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    gap: spacing.xs,
    padding: spacing.md,
  },
  form: {
    gap: spacing.lg,
  },
  message: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  metaRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  notice: {
    gap: spacing.sm,
  },
});
