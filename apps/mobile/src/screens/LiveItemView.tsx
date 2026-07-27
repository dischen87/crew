import type { ImageSourcePropType } from 'react-native';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card, StatusChip, SyncStatus } from '../design/primitives';
import { colors, spacing, typography } from '../design/theme';
import { ScreenFrame, ScreenIcon } from './ScreenFrame';

const icons = {
  calendar: require('../assets/icons/calendar.png'),
  check: require('../assets/icons/check.png'),
  cloudOffline: require('../assets/icons/cloud-offline.png'),
  flag: require('../assets/icons/flag.png'),
  golf: require('../assets/icons/golf.png'),
  location: require('../assets/icons/location.png'),
} satisfies Record<string, ImageSourcePropType>;

export type LiveItemDetail = {
  label: string;
  value: string;
};

export type LiveItemReadyModel = {
  canEdit: boolean;
  canOpenGolfScorecard: boolean;
  dateLabel: string;
  details: readonly LiveItemDetail[];
  eventTitle: string;
  itemType: string;
  notes: string | null;
  place: string | null;
  primaryAction:
    | { itemId: string; kind: 'item'; label: string }
    | { kind: 'plan' | 'recap'; label: string };
  role: 'organizer' | 'owner' | 'participant' | 'viewer';
  status: 'active' | 'archived' | 'cancelled';
  syncLabel: string;
  syncState: 'attention' | 'offline' | 'ready';
  timeLabel: string;
  timeZone: string;
  title: string;
};

export type LiveItemViewModel =
  | { phase: 'concealed' }
  | { phase: 'loading' }
  | { item: LiveItemReadyModel; phase: 'ready' };

export type LiveItemViewProps = {
  model: LiveItemViewModel;
  onBack(): void;
  onEdit?(): void;
  onOpenGolfScorecard?(): void;
  onPrimaryAction?(): void;
};

export function LiveItemView({
  model,
  onBack,
  onEdit,
  onOpenGolfScorecard,
  onPrimaryAction,
}: LiveItemViewProps) {
  if (model.phase === 'loading') {
    return (
      <ScreenFrame
        description="Der sicher gespeicherte Programmpunkt wird für dieses Konto geladen."
        eyebrow="LIVE-ITEM"
        testID="live-item-view"
        title="Programmpunkt wird geladen"
      />
    );
  }

  if (model.phase === 'concealed') {
    return (
      <ScreenFrame
        description="Dieser Programmpunkt ist für dieses Konto nicht verfügbar."
        eyebrow="LIVE-ITEM"
        icon={icons.cloudOffline}
        liveRegion="polite"
        statusLabel="Sicher verborgen"
        testID="live-item-view"
        title="Inhalt nicht verfügbar"
        tone="brand"
      >
        <Button
          accessibilityHint="Kehrt zur vorherigen sicheren Ansicht zurück."
          label="Zurück"
          onPress={onBack}
          testID="live-item-back"
          variant="surface"
        />
      </ScreenFrame>
    );
  }

  const { item } = model;
  return (
    <ScreenFrame
      description={`${item.itemType} in ${item.eventTitle}.`}
      eyebrow="LIVE-ITEM"
      icon={item.status === 'active' ? icons.calendar : icons.flag}
      liveRegion="polite"
      statusLabel={statusLabel(item.status)}
      testID="live-item-view"
      title={item.title}
      tone={item.status === 'active' ? 'action' : 'brand'}
    >
      <SyncStatus
        icon={
          <ScreenIcon
            size={17}
            source={
              item.syncState === 'ready' ? icons.check : icons.cloudOffline
            }
          />
        }
        label={item.syncLabel}
        state={item.syncState}
      />

      <View style={styles.metaRow}>
        <StatusChip label={item.itemType} tone="lavender" />
        <StatusChip label={roleLabel(item.role)} tone="surface" />
      </View>

      <Card
        accessibilityLabel={`${item.dateLabel}. ${item.timeLabel}. Zeitzone ${item.timeZone}.`}
        style={styles.section}
        tone="surface"
      >
        <View style={styles.sectionHeading}>
          <ScreenIcon source={icons.calendar} />
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            Zeitpunkt
          </Text>
        </View>
        <Text style={styles.primaryText}>{item.dateLabel}</Text>
        <Text style={styles.body}>{item.timeLabel}</Text>
        <Text style={styles.support}>Zeitzone · {item.timeZone}</Text>
      </Card>

      {item.place ? (
        <Card style={styles.section} tone="lavender">
          <View style={styles.sectionHeading}>
            <ScreenIcon source={icons.location} />
            <Text accessibilityRole="header" style={styles.sectionTitle}>
              Ort
            </Text>
          </View>
          <Text style={styles.primaryText}>{item.place}</Text>
        </Card>
      ) : null}

      {item.notes ? (
        <Card style={styles.section} tone="surface">
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            Notizen
          </Text>
          <Text style={styles.body}>{item.notes}</Text>
        </Card>
      ) : null}

      {item.details.length > 0 ? (
        <Card style={styles.section} tone="surface">
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            Details
          </Text>
          {item.details.map(detail => (
            <View key={detail.label} style={styles.detailRow}>
              <Text style={styles.detailLabel}>{detail.label}</Text>
              <Text style={styles.detailValue}>{detail.value}</Text>
            </View>
          ))}
        </Card>
      ) : null}

      <View style={styles.actions}>
        {onPrimaryAction ? (
          <Button
            accessibilityHint="Öffnet den nächsten sicheren Schritt für diesen Programmpunkt."
            icon={<ScreenIcon source={icons.check} />}
            label={item.primaryAction.label}
            onPress={onPrimaryAction}
            testID="live-item-primary-action"
            variant="action"
          />
        ) : null}
        {item.canOpenGolfScorecard && onOpenGolfScorecard ? (
          <Button
            accessibilityHint="Öffnet die Scorecard dieser Golfrunde."
            icon={<ScreenIcon source={icons.golf} />}
            label="Scorecard öffnen"
            onPress={onOpenGolfScorecard}
            testID="live-item-golf-scorecard"
            variant="surface"
          />
        ) : null}
        {item.canEdit && onEdit ? (
          <Button
            accessibilityHint="Öffnet diesen Programmpunkt zur Bearbeitung."
            label="Programmpunkt bearbeiten"
            onPress={onEdit}
            testID="live-item-edit"
            variant="surface"
          />
        ) : null}
        <Button
          accessibilityHint="Kehrt zum Plan zurück."
          label="Zurück zum Plan"
          onPress={onBack}
          testID="live-item-back"
          variant="surface"
        />
      </View>
    </ScreenFrame>
  );
}

function statusLabel(status: LiveItemReadyModel['status']) {
  if (status === 'cancelled') return 'Abgesagt';
  if (status === 'archived') return 'Archiviert';
  return 'Aktiv';
}

function roleLabel(role: LiveItemReadyModel['role']) {
  if (role === 'owner') return 'Eigentümer:in';
  if (role === 'organizer') return 'Organisator:in';
  if (role === 'viewer') return 'Ansicht';
  return 'Teilnehmend';
}

const styles = StyleSheet.create({
  actions: {
    gap: spacing.md,
  },
  body: {
    ...typography.body,
    color: colors.text,
  },
  detailLabel: {
    ...typography.overline,
    color: colors.textSecondary,
  },
  detailRow: {
    gap: spacing.xs,
  },
  detailValue: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  metaRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  primaryText: {
    ...typography.subheading,
    color: colors.text,
  },
  section: {
    gap: spacing.md,
  },
  sectionHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  sectionTitle: {
    ...typography.subheading,
    color: colors.text,
    flexShrink: 1,
  },
  support: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
