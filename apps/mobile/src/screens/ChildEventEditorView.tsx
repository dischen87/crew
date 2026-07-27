import type { ImageSourcePropType } from 'react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card, StatusChip, TextField } from '../design/primitives';
import { colors, elevations, spacing, typography } from '../design/theme';
import type { PlanChildEventValues } from './PlanRuntime';
import { ScreenFrame, ScreenIcon } from './ScreenFrame';
import type { EventBasicsField, EventBasicsForm } from './EventBasicsView';

const icons = {
  arrowRight: require('../assets/icons/arrow-right.png'),
  calendar: require('../assets/icons/calendar.png'),
  check: require('../assets/icons/check.png'),
} satisfies Record<string, ImageSourcePropType>;

export type ChildEventForm = EventBasicsForm & {
  kind: PlanChildEventValues['kind'];
};

export type ChildEventEditorViewProps = {
  busy: boolean;
  errors: Partial<Record<EventBasicsField, string>>;
  form: ChildEventForm;
  message: string | null;
  online: boolean;
  parentTitle: string;
  onBack(): void;
  onChange(field: keyof ChildEventForm, value: string): void;
  onSubmit(): void;
};

const kinds: ReadonlyArray<{
  kind: ChildEventForm['kind'];
  label: string;
}> = [
  { kind: 'day', label: 'Tag' },
  { kind: 'session', label: 'Session' },
  { kind: 'activity', label: 'Aktivität' },
  { kind: 'golf', label: 'Golfrunde' },
  { kind: 'team_event', label: 'Team-Event' },
  { kind: 'trip', label: 'Reise' },
  { kind: 'other', label: 'Anderer Bereich' },
];

export function ChildEventEditorView({
  busy,
  errors,
  form,
  message,
  online,
  parentTitle,
  onBack,
  onChange,
  onSubmit,
}: ChildEventEditorViewProps) {
  return (
    <ScreenFrame
      description={`Neuer Unterbereich in ${parentTitle}`}
      eyebrow="PLANSTRUKTUR"
      icon={icons.calendar}
      liveRegion="polite"
      statusLabel={online ? 'Bereit zum Speichern' : 'Offline speicherbar'}
      testID="child-event-editor"
      title="Unterbereich hinzufügen"
      tone="action"
    >
      <View style={styles.metaRow}>
        <StatusChip label={`Übergeordnet: ${parentTitle}`} tone="lavender" />
        <StatusChip
          label={online ? 'Online' : 'Wird lokal vorgemerkt'}
          tone="surface"
        />
      </View>

      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          Art des Bereichs
        </Text>
        <View accessibilityRole="radiogroup" style={styles.kindGrid}>
          {kinds.map(option => {
            const selected = form.kind === option.kind;
            return (
              <Pressable
                accessibilityLabel={option.label}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected, disabled: busy }}
                disabled={busy}
                key={option.kind}
                onPress={() => onChange('kind', option.kind)}
                style={styles.kindPressable}
                testID={`child-event-kind-${option.kind}`}
              >
                {({ pressed }) => (
                  <Card
                    elevated
                    style={[
                      styles.kindCard,
                      pressed && styles.pressed,
                      pressed && elevations.pressed,
                    ]}
                    tone={selected ? 'action' : 'surface'}
                  >
                    <Text style={styles.kindLabel}>{option.label}</Text>
                  </Card>
                )}
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.form}>
        <TextField
          autoFocus
          disabled={busy}
          error={errors.title}
          label="Titel"
          maxLength={160}
          onChangeText={value => onChange('title', value)}
          testID="child-event-title"
          value={form.title}
        />
        <TextField
          disabled={busy}
          error={errors.description}
          label="Beschreibung"
          maxLength={20_000}
          multiline
          numberOfLines={4}
          onChangeText={value => onChange('description', value)}
          testID="child-event-description"
          textAlignVertical="top"
          value={form.description}
        />
        <TextField
          autoCapitalize="none"
          autoCorrect={false}
          disabled={busy}
          error={errors.timeZone}
          helpText="IANA-Zeitzone, zum Beispiel Europe/Zurich"
          label="Zeitzone"
          maxLength={100}
          onChangeText={value => onChange('timeZone', value)}
          testID="child-event-time-zone"
          value={form.timeZone}
        />
        <TextField
          autoCapitalize="none"
          autoCorrect={false}
          disabled={busy}
          error={errors.startsAt}
          helpText="Optional: JJJJ-MM-TT HH:MM"
          label="Beginn"
          maxLength={16}
          onChangeText={value => onChange('startsAt', value)}
          placeholder="2026-09-20 09:00"
          testID="child-event-starts-at"
          value={form.startsAt}
        />
        <TextField
          autoCapitalize="none"
          autoCorrect={false}
          disabled={busy}
          error={errors.endsAt}
          helpText="Optional; muss nach dem Beginn liegen"
          label="Ende"
          maxLength={16}
          onChangeText={value => onChange('endsAt', value)}
          placeholder="2026-09-20 18:00"
          testID="child-event-ends-at"
          value={form.endsAt}
        />
      </View>

      {message ? (
        <Card accessibilityRole="alert" tone="brand">
          <Text style={styles.body}>{message}</Text>
        </Card>
      ) : null}

      <View style={styles.actions}>
        <Button
          accessibilityHint="Speichert den Unterbereich dauerhaft in der accountgebundenen Warteschlange."
          disabled={Object.keys(errors).length > 0 || !form.title.trim()}
          icon={<ScreenIcon source={icons.check} />}
          label="Unterbereich speichern"
          loading={busy}
          onPress={onSubmit}
          testID="child-event-primary-action"
          variant="action"
        />
        <Button
          icon={<ScreenIcon source={icons.arrowRight} />}
          label="Zurück zum Plan"
          onPress={onBack}
          testID="child-event-back"
          variant="surface"
        />
      </View>
    </ScreenFrame>
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
  form: {
    gap: spacing.md,
  },
  kindCard: {
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
    paddingVertical: spacing.sm,
  },
  kindGrid: {
    gap: spacing.sm,
  },
  kindLabel: {
    ...typography.label,
    color: colors.text,
    textAlign: 'center',
  },
  kindPressable: {
    borderRadius: 20,
  },
  metaRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  pressed: {
    backgroundColor: colors.backgroundPressed,
  },
  section: {
    gap: spacing.md,
  },
  sectionTitle: {
    ...typography.subheading,
    color: colors.text,
  },
});
