import type { ImageSourcePropType } from 'react-native';
import {
  Image,
  ImageBackground,
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
import type {
  TeamAssignmentManagerTeam,
  TeamAssignmentsViewModel,
  TeamPerson,
} from '../team/TeamCollaborationController';

const boardBackground = require('../assets/crew-board-background.png');
const crewLogo = require('../assets/crew-logo.png');
const icons = {
  arrowRight: require('../assets/icons/arrow-right.png'),
  caretRight: require('../assets/icons/caret-right.png'),
  check: require('../assets/icons/check.png'),
  cloudOffline: require('../assets/icons/cloud-offline.png'),
  crew: require('../assets/icons/crew.png'),
} satisfies Record<string, ImageSourcePropType>;

export type TeamAssignmentsViewProps = {
  model: TeamAssignmentsViewModel;
  onBack(): void;
  onMoveMember(memberId: string, targetTeamId: string): void;
  onPrimaryAction(): void;
};

export function TeamAssignmentsView({
  model,
  onBack,
  onMoveMember,
  onPrimaryAction,
}: TeamAssignmentsViewProps) {
  const insets = useSafeAreaInsets();
  const canManage = isManagerModel(model);
  const capacityOkay =
    canManage &&
    model.teams.every(
      team => team.capacity === null || team.members.length <= team.capacity,
    );
  const primary = assignmentPrimary(model, canManage, capacityOkay);

  return (
    <ImageBackground
      resizeMode="cover"
      source={boardBackground}
      style={styles.screen}
      testID="team-assignments-view"
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

        <Text accessibilityRole="header" style={styles.title}>
          Teams einteilen
        </Text>
        <Text style={styles.eventTitle}>{model.eventTitle}</Text>
        <View style={styles.metaRow}>
          <StatusChip label={roleLabel(model.role)} tone="lavender" />
          {!canManage ? (
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

        {isManagerModel(model) ? (
          <View style={styles.teams}>
            <View style={styles.sectionHeadingRow}>
              <Text style={styles.sectionHeading}>EINTEILUNG</Text>
              <StatusChip
                label={`${model.teams.reduce(
                  (sum, team) => sum + team.members.length,
                  0,
                )} Personen`}
                tone="surface"
              />
            </View>
            {model.teams.map((team, index) => (
              <ManagerTeamCard
                allTeams={model.teams}
                key={team.id}
                onMoveMember={onMoveMember}
                team={team}
                teamIndex={index}
              />
            ))}
            {!capacityOkay ? (
              <Card
                accessibilityLabel="Die Einteilung verletzt eine Teamgrösse. Erstes Team korrigieren."
                style={styles.attentionCard}
                tone="brand"
              >
                <Text style={styles.attentionTitle}>Teamgrösse prüfen</Text>
                <Text style={styles.attentionCopy}>
                  Mindestens ein Team hat zu viele Personen. Deine Einteilung
                  ist noch nicht veröffentlicht.
                </Text>
              </Card>
            ) : null}
          </View>
        ) : (
          <ReadOnlyAssignments model={model} />
        )}
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
              name={primary.kind === 'publish' ? 'crew' : 'arrowRight'}
              size={23}
            />
          }
          label={primary.label}
          onPress={onPrimaryAction}
          testID="team-assignments-primary-action"
          variant={primary.kind === 'publish' ? 'brand' : 'action'}
        />
      </View>
    </ImageBackground>
  );
}

function ManagerTeamCard({
  allTeams,
  onMoveMember,
  team,
  teamIndex,
}: {
  allTeams: readonly TeamAssignmentManagerTeam[];
  onMoveMember(memberId: string, targetTeamId: string): void;
  team: TeamAssignmentManagerTeam;
  teamIndex: number;
}) {
  const capacity = team.capacity === null ? 'offen' : String(team.capacity);
  const overCapacity =
    team.capacity !== null && team.members.length > team.capacity;

  return (
    <Card
      accessibilityLabel={`${team.name}, ${team.members.length} von ${capacity} Plätzen`}
      style={styles.teamCard}
      tone={teamIndex % 2 === 0 ? 'brand' : 'action'}
    >
      <View style={styles.teamHeader}>
        <View style={styles.teamTitleRow}>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[
              styles.teamColor,
              { backgroundColor: team.color ?? colors.surfaceAccent },
            ]}
          />
          <Text style={styles.teamName}>{team.name}</Text>
        </View>
        <StatusChip
          label={`${team.members.length}/${capacity}`}
          tone={overCapacity ? 'brand' : 'surface'}
        />
      </View>
      <View style={styles.memberList}>
        {team.members.map(member => {
          const target = nextAvailableTeam(allTeams, team.id);
          return (
            <View key={member.id} style={styles.memberRow}>
              <PersonAvatar person={member} />
              <Text style={styles.memberName}>{member.name}</Text>
              {target ? (
                <Text style={styles.moveTarget}>nach {target.name}</Text>
              ) : null}
              <IconButton
                accessibilityHint={
                  target
                    ? `Verschiebt nach ${target.name}.`
                    : 'Es ist kein freier Platz in einem anderen Team verfügbar.'
                }
                accessibilityLabel={`${member.name}, aktuelles Team ${
                  team.name
                }, Teambelegung ${team.members.length} von ${capacity}. ${
                  target
                    ? `Verschieben nach ${target.name}`
                    : 'Kein freies Zielteam'
                }.`}
                disabled={!target}
                icon={<AssetIcon name="arrowRight" size={19} />}
                onPress={() => {
                  if (target) onMoveMember(member.id, target.id);
                }}
                testID={`move-${member.id}`}
                tone="surface"
              />
            </View>
          );
        })}
      </View>
    </Card>
  );
}

function ReadOnlyAssignments({
  model,
}: {
  model: Extract<TeamAssignmentsViewModel, { access: 'read' }>;
}) {
  return (
    <View style={styles.readOnlySection}>
      {model.role === 'participant' && model.ownTeam ? (
        <Card elevated style={styles.ownTeamCard} tone="action">
          <Text style={styles.sectionHeading}>DEIN TEAM</Text>
          <Text style={styles.ownTeamName}>{model.ownTeam.name}</Text>
          <Text style={styles.readOnlyCopy}>
            Deine Zuteilung ist auf diesem Gerät verfügbar.
          </Text>
        </Card>
      ) : (
        <Card style={styles.readOnlyCard} tone="surface">
          <Text style={styles.attentionTitle}>Nur ansehen</Text>
          <Text style={styles.readOnlyCopy}>
            Du kannst Teams nicht einteilen. Es werden keine fremden Zuteilungen
            angezeigt.
          </Text>
        </Card>
      )}
      <Text style={styles.sectionHeading}>TEAMS</Text>
      <View style={styles.publicTeams}>
        {model.teams.map(team => (
          <StatusChip key={team.id} label={team.name} tone="lavender" />
        ))}
      </View>
    </View>
  );
}

function PersonAvatar({ person }: { person: TeamPerson }) {
  if (!person.avatar) {
    return (
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.avatar, styles.avatarFallback]}
      >
        <Text style={styles.avatarInitial}>
          {person.name.trim().charAt(0).toLocaleUpperCase('de-CH')}
        </Text>
      </View>
    );
  }
  return (
    <Image
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      source={person.avatar}
      style={styles.avatar}
    />
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

function nextAvailableTeam(
  teams: readonly TeamAssignmentManagerTeam[],
  currentTeamId: string,
) {
  const current = teams.findIndex(team => team.id === currentTeamId);
  for (let offset = 1; offset < teams.length; offset += 1) {
    const team = teams[(current + offset) % teams.length];
    if (
      team &&
      (team.capacity === null || team.members.length < team.capacity)
    ) {
      return team;
    }
  }
  return null;
}

function isManagerModel(
  model: TeamAssignmentsViewModel,
): model is Extract<TeamAssignmentsViewModel, { access: 'manage' }> {
  return (
    model.access === 'manage' &&
    (model.role === 'owner' || model.role === 'organizer')
  );
}

function assignmentPrimary(
  model: TeamAssignmentsViewModel,
  canManage: boolean,
  capacityOkay: boolean,
) {
  if (!canManage) {
    return {
      disabled: false,
      hint: 'Kehrt zum Event zurück, ohne Daten zu ändern.',
      kind: 'read' as const,
      label: 'Zurück zum Event',
    };
  }
  if (model.deliveryState === 'pending') {
    return {
      disabled: false,
      hint: 'Die Einteilung bleibt lokal gespeichert.',
      kind: 'read' as const,
      label: 'Zurück zum Plan',
    };
  }
  if (model.deliveryState === 'needs_attention') {
    return {
      disabled: false,
      hint: 'Öffnet die lokal gespeicherte Einteilung zur Prüfung.',
      kind: 'read' as const,
      label: 'Einteilung prüfen',
    };
  }
  if (model.access === 'manage' && model.hasLocalChanges) {
    return {
      disabled: !capacityOkay,
      hint: capacityOkay
        ? 'Speichert die Einteilung im Offline-Ausgang und reiht sie zur Veröffentlichung ein.'
        : 'Korrigiere zuerst die Teamgrösse.',
      kind: 'publish' as const,
      label: capacityOkay
        ? 'Einteilung veröffentlichen'
        : 'Erstes Team korrigieren',
    };
  }
  return {
    disabled: false,
    hint: 'Kehrt zum Plan zurück, ohne Daten zu ändern.',
    kind: 'read' as const,
    label: 'Zurück zum Plan',
  };
}

function roleLabel(role: TeamAssignmentsViewModel['role']) {
  switch (role) {
    case 'owner':
      return 'Eigentümer:in';
    case 'organizer':
      return 'Organisator:in';
    case 'participant':
      return 'Teilnehmer:in';
    case 'viewer':
      return 'Betrachter:in';
  }
}

function syncState(state: TeamAssignmentsViewModel['deliveryState']) {
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
  attentionCard: {
    gap: spacing.xs,
  },
  attentionCopy: {
    ...typography.body,
    color: colors.text,
  },
  attentionTitle: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  avatar: {
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: borders.chip,
    height: 38,
    width: 38,
  },
  avatarFallback: {
    alignItems: 'center',
    backgroundColor: colors.surfaceAccent,
    justifyContent: 'center',
  },
  avatarInitial: {
    ...typography.label,
    color: colors.text,
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
  content: {
    gap: spacing.md,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
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
  memberList: {
    gap: spacing.xs,
  },
  memberName: {
    ...typography.bodyStrong,
    color: colors.text,
    flex: 1,
  },
  memberRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.control,
    borderWidth: borders.chip,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: componentMetrics.control.minimumTouchSize + 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  moveTarget: {
    ...typography.caption,
    color: colors.textSecondary,
    maxWidth: 64,
    textAlign: 'right',
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  ownTeamCard: {
    gap: spacing.sm,
  },
  ownTeamName: {
    ...typography.title,
    color: colors.text,
  },
  publicTeams: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  readOnlyCard: {
    gap: spacing.sm,
  },
  readOnlyCopy: {
    ...typography.body,
    color: colors.text,
  },
  readOnlySection: {
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  sectionHeading: {
    ...typography.overline,
    color: colors.textSecondary,
  },
  sectionHeadingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  teamCard: {
    gap: spacing.md,
    padding: spacing.md,
  },
  teamColor: {
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: borders.chip,
    height: 18,
    width: 18,
  },
  teamHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  teamName: {
    ...typography.subheading,
    color: colors.text,
  },
  teams: {
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  teamTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  title: {
    ...typography.title,
    color: colors.text,
    marginTop: spacing.sm,
  },
});
