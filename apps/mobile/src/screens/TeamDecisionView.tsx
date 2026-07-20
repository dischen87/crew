import type { ImageSourcePropType } from 'react-native';
import {
  Image,
  ImageBackground,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
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
  radii,
  spacing,
  typography,
} from '../design/theme';
import type { TeamDecisionViewModel } from '../team/TeamCollaborationController';

const boardBackground = require('../assets/crew-board-background.png');
const crewLogo = require('../assets/crew-logo.png');
const icons = {
  arrowRight: require('../assets/icons/arrow-right.png'),
  caretRight: require('../assets/icons/caret-right.png'),
  check: require('../assets/icons/check.png'),
  cloudOffline: require('../assets/icons/cloud-offline.png'),
} satisfies Record<string, ImageSourcePropType>;

export type TeamDecisionViewProps = {
  model: TeamDecisionViewModel;
  onBack(): void;
  onPrimaryAction(): void;
  onSelectOption(optionId: string): void;
};

export function TeamDecisionView({
  model,
  onBack,
  onPrimaryAction,
  onSelectOption,
}: TeamDecisionViewProps) {
  const insets = useSafeAreaInsets();
  const submitted =
    model.authoritativeOptionId !== null || model.responseMutationId !== null;
  const canSelect =
    model.lifecycle === 'open' &&
    model.role !== 'viewer' &&
    model.canRespond &&
    !submitted;
  const primary = decisionPrimary(model, submitted);

  return (
    <ImageBackground
      resizeMode="cover"
      source={boardBackground}
      style={styles.screen}
      testID="team-decision-view"
    >
      <ScrollView
        automaticallyAdjustContentInsets={false}
        contentContainerStyle={[
          styles.content,
          { paddingTop: Math.max(spacing.md - insets.top, 0) },
        ]}
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        style={[styles.scroll, { marginTop: insets.top }]}
      >
        <View style={styles.brandRow}>
          <View style={styles.brandLockup}>
            <IconButton
              accessibilityLabel="Zurück"
              icon={<AssetIcon name="caretRight" rotate />}
              onPress={onBack}
              tone="surface"
            />
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

        <Text accessibilityRole="header" style={styles.screenTitle}>
          Entscheidung
        </Text>
        <Text style={styles.eventTitle}>{model.eventTitle}</Text>
        <View style={styles.metaRow}>
          <StatusChip
            label={lifecycleLabel(model.lifecycle)}
            tone={model.lifecycle === 'open' ? 'action' : 'lavender'}
          />
          {model.role === 'viewer' ? (
            <StatusChip label="Nur ansehen" tone="surface" />
          ) : null}
        </View>
        <SyncStatus
          icon={
            <AssetIcon
              name={model.deliveryState === 'synced' ? 'check' : 'cloudOffline'}
              size={17}
            />
          }
          label={model.deliveryLabel}
          state={syncState(model.deliveryState)}
        />

        <Card elevated style={styles.questionCard} tone="brand">
          <Text style={styles.overline}>DEINE WAHL</Text>
          <Text style={styles.question}>{model.title}</Text>
          <Text style={styles.contextCopy}>
            {decisionContext(model, submitted)}
          </Text>
        </Card>

        <View
          accessibilityLabel={`Entscheidung ${model.title}, ${lifecycleLabel(
            model.lifecycle,
          )}`}
          accessibilityRole="radiogroup"
          style={styles.options}
        >
          {model.options.map(option => {
            const selected = model.selectedOptionId === option.id;
            const delivery = selected ? selectedDelivery(model) : null;
            return (
              <Pressable
                accessibilityHint={
                  canSelect
                    ? 'Wählt diese Option lokal aus.'
                    : disabledReason(model, submitted)
                }
                accessibilityLabel={`Entscheidung ${model.title}. Option ${
                  option.label
                }, ${selected ? 'ausgewählt' : 'nicht ausgewählt'}${
                  delivery ? `, ${delivery}` : ''
                }.`}
                accessibilityRole="radio"
                accessibilityState={{
                  checked: selected,
                  disabled: !canSelect,
                }}
                disabled={!canSelect}
                key={option.id}
                onPress={() => onSelectOption(option.id)}
                style={({ pressed }) => [
                  styles.option,
                  selected && styles.optionSelected,
                  pressed && styles.optionPressed,
                  !canSelect && !selected && styles.optionDisabled,
                ]}
                testID={`team-decision-option-${option.id}`}
              >
                <View style={styles.optionCopy}>
                  <Text style={styles.optionLabel}>{option.label}</Text>
                  {(model.lifecycle === 'closed' ||
                    model.role === 'viewer') && (
                    <Text style={styles.optionResult}>
                      {option.responseCount}{' '}
                      {option.responseCount === 1 ? 'Antwort' : 'Antworten'}
                    </Text>
                  )}
                </View>
                {selected ? (
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={styles.selectedIcon}
                  >
                    <AssetIcon name="check" size={23} />
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>

        {model.lifecycle === 'closed' && model.selectedOptionId ? (
          <Card style={styles.closedNotice} tone="lavender">
            <Text style={styles.noticeTitle}>Auswahl bleibt sichtbar</Text>
            <Text style={styles.noticeCopy}>
              Die Entscheidung ist geschlossen. Deine lokal gespeicherte Wahl
              wurde nicht verworfen.
            </Text>
          </Card>
        ) : null}
        {model.deliveryState === 'needs_attention' ? (
          <Card style={styles.attentionNotice} tone="brand">
            <Text style={styles.noticeTitle}>Antwort prüfen</Text>
            <Text style={styles.noticeCopy}>
              Deine Auswahl ist erhalten, wurde aber noch nicht bestätigt.
            </Text>
          </Card>
        ) : null}
      </ScrollView>

      <View
        style={[
          styles.actionDock,
          { paddingBottom: Math.max(insets.bottom, spacing.md) },
        ]}
      >
        <Button
          accessibilityHint={primary.hint}
          disabled={primary.disabled}
          icon={
            <AssetIcon
              name={primary.kind === 'submit' ? 'check' : 'arrowRight'}
              size={23}
            />
          }
          label={primary.label}
          onPress={onPrimaryAction}
          testID="team-decision-primary-action"
          variant={primary.kind === 'submit' ? 'brand' : 'action'}
        />
      </View>
    </ImageBackground>
  );
}

function AssetIcon({
  name,
  rotate = false,
  size = 22,
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
        transform: rotate ? [{ rotate: '180deg' }] : undefined,
        width: size,
      }}
    />
  );
}

function decisionPrimary(model: TeamDecisionViewModel, submitted: boolean) {
  if (model.lifecycle === 'closed' || model.role === 'viewer') {
    return {
      disabled: false,
      hint: 'Kehrt zur Session zurück, ohne Eventdaten zu ändern.',
      kind: 'read' as const,
      label: 'Zurück zur Session',
    };
  }
  if (model.deliveryState === 'needs_attention') {
    return {
      disabled: false,
      hint: 'Kehrt zur Session zurück. Deine Auswahl bleibt sichtbar.',
      kind: 'read' as const,
      label: 'Zurück zur Session',
    };
  }
  if (submitted) {
    return {
      disabled: false,
      hint: 'Deine Auswahl bleibt lokal gespeichert.',
      kind: 'read' as const,
      label: 'Zurück zur Session',
    };
  }
  return {
    disabled: !model.selectedOptionId || !model.canRespond,
    hint: model.selectedOptionId
      ? 'Speichert deine Auswahl lokal und reiht sie zur Übertragung ein.'
      : 'Wähle zuerst eine Option.',
    kind: 'submit' as const,
    label: 'Antwort senden',
  };
}

function decisionContext(model: TeamDecisionViewModel, submitted: boolean) {
  if (model.lifecycle === 'closed') {
    return `${model.responseCount} bestätigte Antworten · Ergebnis verfügbar`;
  }
  if (model.role === 'viewer') {
    return 'Du kannst das Ergebnis ansehen, aber nicht antworten.';
  }
  if (submitted) {
    return 'Deine Auswahl ist gespeichert. Eine zweite Antwort wird nicht erstellt.';
  }
  return 'Wähle genau eine Option. Offline bleibt deine Auswahl erhalten.';
}

function disabledReason(model: TeamDecisionViewModel, submitted: boolean) {
  if (model.lifecycle === 'closed') return 'Die Entscheidung ist geschlossen.';
  if (model.role === 'viewer') return 'Du kannst nur ansehen.';
  if (submitted) return 'Deine Antwort wurde bereits gespeichert.';
  return 'Diese Option ist nicht verfügbar.';
}

function lifecycleLabel(lifecycle: TeamDecisionViewModel['lifecycle']) {
  switch (lifecycle) {
    case 'draft':
      return 'Entwurf';
    case 'open':
      return 'Offen';
    case 'closed':
      return 'Geschlossen';
  }
}

function selectedDelivery(model: TeamDecisionViewModel) {
  if (model.deliveryState === 'pending') return 'wartet auf Verbindung';
  if (model.deliveryState === 'needs_attention') return 'Aktion erforderlich';
  if (model.deliveryState === 'unpublished') return 'nicht veröffentlicht';
  return 'synchronisiert';
}

function syncState(state: TeamDecisionViewModel['deliveryState']) {
  switch (state) {
    case 'needs_attention':
      return 'attention' as const;
    case 'pending':
      return 'offline' as const;
    case 'synced':
      return 'ready' as const;
    case 'unpublished':
      return 'offline' as const;
  }
}

const styles = StyleSheet.create({
  actionDock: {
    backgroundColor: colors.background,
    borderTopColor: colors.border,
    borderTopWidth: borders.chip,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  attentionNotice: {
    gap: spacing.xs,
  },
  brandLockup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  brandName: {
    ...typography.subheading,
    color: colors.text,
  },
  brandRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  closedNotice: {
    gap: spacing.xs,
  },
  content: {
    gap: spacing.md,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  contextCopy: {
    ...typography.body,
    color: colors.text,
  },
  eventTitle: {
    ...typography.bodyStrong,
    color: colors.textSecondary,
    marginTop: -spacing.sm,
  },
  logo: {
    height: 44,
    width: 44,
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  noticeCopy: {
    ...typography.body,
    color: colors.text,
  },
  noticeTitle: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  option: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.card,
    borderWidth: borders.strong,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: componentMetrics.control.minimumTouchSize + 18,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  optionCopy: {
    flex: 1,
    gap: spacing.xxs,
  },
  optionDisabled: {
    opacity: 0.62,
  },
  optionLabel: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  optionPressed: {
    backgroundColor: colors.backgroundPressed,
  },
  optionResult: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  options: {
    gap: spacing.sm,
  },
  optionSelected: {
    backgroundColor: colors.surfaceAction,
  },
  overline: {
    ...typography.overline,
    color: colors.textSecondary,
  },
  question: {
    ...typography.heading,
    color: colors.text,
  },
  questionCard: {
    gap: spacing.sm,
    padding: spacing.lg,
  },
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  screenTitle: {
    ...typography.title,
    color: colors.text,
    marginTop: spacing.sm,
  },
  selectedIcon: {
    alignItems: 'center',
    backgroundColor: colors.surfaceBrand,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: borders.chip,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
});
