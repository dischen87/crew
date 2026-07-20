import type { ImageSourcePropType } from 'react-native';
import {
  ActivityIndicator,
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
import { borders, colors, radii, spacing, typography } from '../design/theme';

const boardBackground = require('../assets/crew-board-background.png');
const crewLogo = require('../assets/crew-logo.png');
const icons = {
  arrowRight: require('../assets/icons/arrow-right.png'),
  calendar: require('../assets/icons/calendar.png'),
  caretRight: require('../assets/icons/caret-right.png'),
  check: require('../assets/icons/check.png'),
  cloudOffline: require('../assets/icons/cloud-offline.png'),
  crew: require('../assets/icons/crew.png'),
} satisfies Record<string, ImageSourcePropType>;

export type RecapViewRole = 'organizer' | 'owner' | 'participant' | 'viewer';
export type RecapViewPhase =
  | 'concealed'
  | 'draft'
  | 'empty'
  | 'loading'
  | 'published';
export type RecapViewAction =
  | 'generate'
  | 'publish'
  | 'refresh'
  | 'remove'
  | 'revoke'
  | 'share'
  | 'shareExact';

export type RecapViewExternalDecision = 'grant' | 'unknown' | 'withdraw';

export type RecapViewItem = {
  body: string | null;
  externalBody: {
    actorCanDecide: readonly ('author' | 'manager')[];
    authorDecision: RecapViewExternalDecision;
    managerDecision: RecapViewExternalDecision;
    requiredAuthorities: readonly ('author' | 'manager')[];
    selected: boolean;
  } | null;
  id: string;
  title: string | null;
};

export type RecapViewModel = {
  activeShareExpiresAt: string | null;
  activeShareKind: 'exact-body' | 'title-only' | null;
  busyAction: RecapViewAction | null;
  busyExternalAuthority: 'author' | 'manager' | null;
  busyExternalDecision: Exclude<RecapViewExternalDecision, 'unknown'> | null;
  busyExternalFieldId: string | null;
  eventTitle: string;
  items: readonly RecapViewItem[];
  message: string | null;
  online: boolean;
  phase: RecapViewPhase;
  refreshedAt: string | null;
  role: RecapViewRole | null;
};

export type RecapViewProps = {
  model: RecapViewModel;
  onBack(): void;
  onGenerate(): void;
  onExternalDecision(
    itemId: string,
    authority: 'author' | 'manager',
    decision: Exclude<RecapViewExternalDecision, 'unknown'>,
  ): void;
  onExternalSelectionToggle(itemId: string): void;
  onPublish(): void;
  onRefresh(): void;
  onRemove(): void;
  onRevoke(): void;
  onShare(): void;
  onShareExact(): void;
};

export function RecapView({
  model,
  onBack,
  onExternalDecision,
  onExternalSelectionToggle,
  onGenerate,
  onPublish,
  onRefresh,
  onRemove,
  onRevoke,
  onShare,
  onShareExact,
}: RecapViewProps) {
  const insets = useSafeAreaInsets();
  const manager = model.role === 'owner' || model.role === 'organizer';
  const mutationBusy =
    model.busyAction !== null || model.busyExternalFieldId !== null;
  const primary = primaryAction(model, manager);
  const actions = (
    <View style={styles.actions}>
      {primary ? (
        <Button
          accessibilityHint={primary.hint}
          disabled={mutationBusy}
          icon={<AssetIcon name="arrowRight" />}
          label={primary.label}
          loading={model.busyAction === primary.action}
          onPress={handlerFor(primary.action, {
            generate: onGenerate,
            publish: onPublish,
            refresh: onRefresh,
            remove: onRemove,
            revoke: onRevoke,
            share: onShare,
            shareExact: onShareExact,
          })}
          testID="recap-primary-action"
          variant="action"
        />
      ) : null}
      {manager && model.online && model.phase === 'draft' ? (
        <Button
          disabled={mutationBusy}
          label="Entwurf entfernen"
          loading={model.busyAction === 'remove'}
          onPress={onRemove}
          testID="recap-remove-action"
          variant="surface"
        />
      ) : null}
      {manager && model.online && model.phase === 'published' ? (
        <Button
          disabled={mutationBusy}
          label={
            model.activeShareExpiresAt
              ? 'Freigabe widerrufen'
              : 'Rückblick entfernen'
          }
          loading={
            model.busyAction ===
            (model.activeShareExpiresAt ? 'revoke' : 'remove')
          }
          onPress={model.activeShareExpiresAt ? onRevoke : onRemove}
          testID={
            model.activeShareExpiresAt
              ? 'recap-revoke-action'
              : 'recap-remove-action'
          }
          variant="surface"
        />
      ) : null}
    </View>
  );
  const hasRecap = model.phase === 'draft' || model.phase === 'published';

  return (
    <ImageBackground
      resizeMode="cover"
      source={boardBackground}
      style={styles.screen}
      testID="recap-view"
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
        showsVerticalScrollIndicator={false}
        style={[styles.scroll, { marginTop: insets.top }]}
      >
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

        <Text style={styles.eyebrow}>RÜCKBLICK</Text>
        <Text accessibilityRole="header" style={styles.title}>
          Eure Momente
        </Text>
        <Text style={styles.eventTitle}>{model.eventTitle}</Text>

        <View style={styles.metaRow}>
          <StatusChip label={phaseLabel(model.phase)} tone={phaseTone(model)} />
          {model.role ? (
            <StatusChip label={roleLabel(model.role)} tone="surface" />
          ) : null}
        </View>
        <SyncStatus
          icon={<AssetIcon name={syncIcon(model)} size={17} />}
          label={syncLabel(model)}
          state={syncState(model)}
        />

        {model.message ? (
          <Card
            accessibilityLiveRegion="polite"
            style={styles.messageCard}
            tone="brand"
          >
            <Text style={styles.message}>{model.message}</Text>
          </Card>
        ) : null}

        {hasRecap ? actions : null}
        <RecapContent
          manager={manager}
          model={model}
          mutationBusy={mutationBusy}
          onExternalDecision={onExternalDecision}
          onExternalSelectionToggle={onExternalSelectionToggle}
          onShareExact={onShareExact}
        />
        {!hasRecap ? actions : null}
      </ScrollView>
    </ImageBackground>
  );
}

function RecapContent({
  manager,
  model,
  mutationBusy,
  onExternalDecision,
  onExternalSelectionToggle,
  onShareExact,
}: {
  manager: boolean;
  model: RecapViewModel;
  mutationBusy: boolean;
  onExternalDecision: RecapViewProps['onExternalDecision'];
  onExternalSelectionToggle: RecapViewProps['onExternalSelectionToggle'];
  onShareExact: RecapViewProps['onShareExact'];
}) {
  if (model.phase === 'loading') {
    return (
      <Card
        accessibilityLiveRegion="polite"
        style={styles.stateCard}
        tone="lavender"
      >
        <ActivityIndicator
          accessibilityLabel="Rückblick wird geladen"
          color={colors.textSecondary}
          size="large"
        />
        <Text style={styles.stateTitle}>Rückblick wird geprüft</Text>
        <Text style={styles.stateCopy}>
          Gespeicherte Inhalte werden zuerst lokal und danach online geprüft.
        </Text>
      </Card>
    );
  }

  if (model.phase === 'concealed') {
    return (
      <Card
        accessibilityLiveRegion="assertive"
        style={styles.stateCard}
        tone="brand"
      >
        <AssetIcon name="cloudOffline" size={32} />
        <Text accessibilityRole="alert" style={styles.stateTitle}>
          Rückblick nicht verfügbar
        </Text>
        <Text style={styles.stateCopy}>
          Geschützte Inhalte bleiben verborgen. Prüfe den Zugang erneut.
        </Text>
      </Card>
    );
  }

  if (model.phase === 'empty') {
    return (
      <Card style={styles.stateCard} tone={manager ? 'brand' : 'lavender'}>
        <AssetIcon name="crew" size={32} />
        <Text style={styles.stateTitle}>
          {manager ? 'Noch kein Rückblick' : 'Noch nicht veröffentlicht'}
        </Text>
        <Text style={styles.stateCopy}>
          {manager
            ? 'Erstelle online einen Entwurf aus veröffentlichten Eventinhalten.'
            : 'Sobald die Organisation den Rückblick freigibt, erscheint er hier.'}
        </Text>
      </Card>
    );
  }

  return (
    <View accessibilityRole="list" style={styles.recapList}>
      {model.phase === 'draft' ? (
        <Card style={styles.reviewCard} tone="brand">
          <Text style={styles.reviewTitle}>Vor Veröffentlichung prüfen</Text>
          <Text style={styles.reviewCopy}>
            Titel und Inhalte stammen aus veröffentlichten Quellen. Entferne den
            Entwurf, falls etwas nicht geteilt werden soll.
          </Text>
        </Card>
      ) : null}
      {model.items.map((item, index) => (
        <Card
          accessible={!item.externalBody}
          accessibilityLabel={
            item.externalBody
              ? undefined
              : [`Moment ${index + 1}`, item.title ?? 'Ohne Titel', item.body]
                  .filter(Boolean)
                  .join(', ')
          }
          key={item.id}
          role="listitem"
          style={styles.momentCard}
          tone={index % 2 === 0 ? 'surface' : 'lavender'}
        >
          <View style={styles.momentHeader}>
            <View style={styles.momentIcon}>
              <AssetIcon name={index === 0 ? 'calendar' : 'check'} size={20} />
            </View>
            <Text style={styles.momentNumber}>MOMENT {index + 1}</Text>
          </View>
          <Text style={styles.momentTitle}>
            {item.title ?? 'Gemeinsamer Moment'}
          </Text>
          {item.body && !(model.phase === 'published' && item.externalBody) ? (
            <Text style={styles.momentBody}>{item.body}</Text>
          ) : null}
          {model.phase === 'published' && item.externalBody ? (
            <ExternalBodyControls
              activeExactShare={model.activeShareKind === 'exact-body'}
              busyAuthority={model.busyExternalAuthority}
              busyDecision={model.busyExternalDecision}
              busyFieldId={model.busyExternalFieldId}
              item={item}
              manager={manager}
              mutationBusy={mutationBusy}
              online={model.online}
              onDecision={onExternalDecision}
              onSelectionToggle={onExternalSelectionToggle}
            />
          ) : null}
        </Card>
      ))}
      {model.phase === 'published' && manager ? (
        <>
          <Card style={styles.privacyCard} tone="lavender">
            <StatusChip label="EXTERN: NUR TITEL" tone="surface" />
            <Text style={styles.privacyCopy}>
              Ein Titel-Link zeigt nur den Rückblicktitel und die Titel der
              Momente – keine Texte, Medien oder internen Kennungen.
            </Text>
            {model.activeShareKind === 'title-only' &&
            model.activeShareExpiresAt ? (
              <Text style={styles.shareExpiry}>
                In dieser Sitzung erstellt · Ablauf{' '}
                {formatDate(model.activeShareExpiresAt)}
              </Text>
            ) : null}
          </Card>
          <ExactShareCard
            model={model}
            mutationBusy={mutationBusy}
            onShareExact={onShareExact}
          />
        </>
      ) : null}
    </View>
  );
}

function ExternalBodyControls({
  activeExactShare,
  busyAuthority,
  busyDecision,
  busyFieldId,
  item,
  manager,
  mutationBusy,
  online,
  onDecision,
  onSelectionToggle,
}: {
  activeExactShare: boolean;
  busyAuthority: RecapViewModel['busyExternalAuthority'];
  busyDecision: RecapViewModel['busyExternalDecision'];
  busyFieldId: string | null;
  item: RecapViewItem;
  manager: boolean;
  mutationBusy: boolean;
  online: boolean;
  onDecision: RecapViewProps['onExternalDecision'];
  onSelectionToggle: RecapViewProps['onExternalSelectionToggle'];
}) {
  const external = item.externalBody;
  if (!external || !item.body) return null;
  const busy = busyFieldId === item.id;

  return (
    <View style={styles.externalField} testID={`recap-external-${item.id}`}>
      <Text style={styles.externalEyebrow}>EXAKTE TEXTVORSCHAU</Text>
      <Text style={styles.externalCopy}>
        Für genau diesen Text gelten die folgenden externen Freigaben:
      </Text>
      <Text style={styles.externalPreview}>{item.body}</Text>
      {manager ? (
        <StatusChip
          label={external.selected ? 'AUSGEWÄHLT' : 'NICHT AUSGEWÄHLT'}
          tone={external.selected ? 'brand' : 'surface'}
        />
      ) : null}
      {external.requiredAuthorities.map(authority => (
        <Text key={authority} style={styles.externalStatus}>
          {externalDecisionLabel(
            authority,
            authority === 'author'
              ? external.authorDecision
              : external.managerDecision,
          )}
        </Text>
      ))}
      {manager && online ? (
        <Button
          disabled={activeExactShare || mutationBusy}
          label={external.selected ? 'Aus Auswahl entfernen' : 'Text auswählen'}
          onPress={() => onSelectionToggle(item.id)}
          testID={`recap-external-select-${item.id}`}
          variant="surface"
        />
      ) : null}
      {online && external.actorCanDecide.length > 0 ? (
        <View style={styles.externalActions}>
          {external.actorCanDecide.map(authority => (
            <View key={authority} style={styles.externalActions}>
              <Button
                disabled={mutationBusy}
                label={`${externalAuthorityLabel(authority)} erteilen`}
                loading={
                  busy &&
                  busyAuthority === authority &&
                  busyDecision === 'grant'
                }
                onPress={() => onDecision(item.id, authority, 'grant')}
                testID={`recap-external-${authority}-grant-${item.id}`}
                variant="action"
              />
              <Button
                disabled={mutationBusy}
                label={`${externalAuthorityLabel(authority)} widerrufen`}
                loading={
                  busy &&
                  busyAuthority === authority &&
                  busyDecision === 'withdraw'
                }
                onPress={() => onDecision(item.id, authority, 'withdraw')}
                testID={`recap-external-${authority}-withdraw-${item.id}`}
                variant="surface"
              />
            </View>
          ))}
        </View>
      ) : null}
      {manager && activeExactShare ? (
        <Text style={styles.externalStatus}>
          Widerrufe zuerst den in dieser Sitzung erstellten Text-Link, um die
          Auswahl zu ändern.
        </Text>
      ) : null}
    </View>
  );
}

function ExactShareCard({
  model,
  mutationBusy,
  onShareExact,
}: {
  model: RecapViewModel;
  mutationBusy: boolean;
  onShareExact: RecapViewProps['onShareExact'];
}) {
  const fieldCount = model.items.filter(item => item.externalBody).length;
  if (fieldCount === 0) return null;
  const selectedCount = model.items.filter(
    item => item.externalBody?.selected,
  ).length;
  const activeExactShare = model.activeShareKind === 'exact-body';
  const titleLinkInSession = model.activeShareKind === 'title-only';
  const canCreate = model.online && selectedCount > 0 && !titleLinkInSession;

  return (
    <Card style={styles.privacyCard} tone="brand">
      <StatusChip label="EXTERN: TEXTAUSWAHL" tone="surface" />
      <Text style={styles.privacyCopy}>
        Der Server erstellt den Link nur, wenn alle aktuellen Freigaben für die
        exakte Auswahl vorliegen. Unbekannte Zustände gelten nicht als
        bestätigt.
      </Text>
      {activeExactShare && model.activeShareExpiresAt ? (
        <Text style={styles.shareExpiry}>
          In dieser Sitzung erstellt · Ablauf{' '}
          {formatDate(model.activeShareExpiresAt)}
        </Text>
      ) : (
        <Text style={styles.externalStatus}>
          {selectedCount === 0
            ? 'Noch kein Text ausgewählt.'
            : `${selectedCount} von ${fieldCount} Texten ausgewählt.`}
        </Text>
      )}
      {titleLinkInSession ? (
        <Text style={styles.externalStatus}>
          Widerrufe zuerst den in dieser Sitzung erstellten Titel-Link.
        </Text>
      ) : null}
      {model.online || activeExactShare ? (
        <Button
          disabled={mutationBusy || (!activeExactShare && !canCreate)}
          label={
            activeExactShare
              ? 'Text-Link erneut teilen'
              : 'Auswahl prüfen und teilen'
          }
          loading={model.busyAction === 'shareExact'}
          onPress={onShareExact}
          testID="recap-external-share-action"
          variant="action"
        />
      ) : null}
    </Card>
  );
}

function externalAuthorityLabel(authority: 'author' | 'manager') {
  return authority === 'author' ? 'Autorfreigabe' : 'Managerfreigabe';
}

function externalDecisionLabel(
  authority: 'author' | 'manager',
  decision: RecapViewExternalDecision,
) {
  const label = externalAuthorityLabel(authority);
  if (decision === 'grant') {
    return `${label}: aktuell bestätigt.`;
  }
  if (decision === 'withdraw') {
    return `${label}: widerrufen.`;
  }
  return `${label}: nicht bestätigt.`;
}

function primaryAction(model: RecapViewModel, manager: boolean) {
  if (model.phase === 'loading') return null;
  if (model.phase === 'concealed') {
    return {
      action: 'refresh' as const,
      hint: 'Prüft Zugang und Rückblick erneut.',
      label: 'Erneut versuchen',
    };
  }
  if (!manager) {
    return {
      action: 'refresh' as const,
      hint: 'Prüft, ob ein Rückblick veröffentlicht wurde.',
      label: model.online ? 'Neu laden' : 'Online prüfen',
    };
  }
  if (model.phase === 'published' && model.activeShareKind === 'exact-body') {
    return null;
  }
  if (!model.online && !model.activeShareExpiresAt) {
    return {
      action: 'refresh' as const,
      hint: 'Prüft die Verbindung. Es wird keine Änderung vorgemerkt.',
      label: 'Online prüfen',
    };
  }
  if (model.phase === 'empty') {
    return {
      action: 'generate' as const,
      hint: 'Erstellt online einen neuen Rückblickentwurf.',
      label: 'Entwurf erstellen',
    };
  }
  if (model.phase === 'draft') {
    return {
      action: 'publish' as const,
      hint: 'Veröffentlicht diese geprüfte Version für die Crew.',
      label: 'Für die Crew veröffentlichen',
    };
  }
  return {
    action: 'share' as const,
    hint: model.activeShareExpiresAt
      ? 'Öffnet die Teilen-Funktion mit dem aktiven Link.'
      : 'Erstellt online einen siebentägigen Titel-Link und öffnet Teilen.',
    label: model.activeShareExpiresAt
      ? 'Link erneut teilen'
      : 'Titel-Link teilen',
  };
}

function handlerFor(
  action: RecapViewAction,
  handlers: Record<RecapViewAction, () => void>,
) {
  return handlers[action];
}

function phaseLabel(phase: RecapViewPhase) {
  switch (phase) {
    case 'draft':
      return 'ENTWURF';
    case 'published':
      return 'VERÖFFENTLICHT';
    case 'empty':
      return 'AUSSTEHEND';
    case 'concealed':
      return 'NICHT VERFÜGBAR';
    default:
      return 'WIRD GELADEN';
  }
}

function phaseTone(model: RecapViewModel) {
  if (model.phase === 'published') return 'action' as const;
  if (model.phase === 'concealed') return 'brand' as const;
  return 'lavender' as const;
}

function roleLabel(role: RecapViewRole) {
  switch (role) {
    case 'owner':
      return 'OWNER';
    case 'organizer':
      return 'ORGANISATION';
    case 'viewer':
      return 'NUR ANSEHEN';
    default:
      return 'TEILNEHMEND';
  }
}

function syncIcon(model: RecapViewModel): keyof typeof icons {
  return model.online && !model.message ? 'check' : 'cloudOffline';
}

function syncLabel(model: RecapViewModel) {
  if (model.message) return 'Keine Änderung bestätigt';
  if (!model.online) {
    return model.refreshedAt
      ? `Offline-Kopie · ${formatDate(model.refreshedAt)}`
      : 'Offline · kein gespeicherter Rückblick';
  }
  if (model.refreshedAt) {
    return `Aktuell · geprüft ${formatDate(model.refreshedAt)}`;
  }
  return 'Zugang wird geprüft';
}

function syncState(model: RecapViewModel) {
  if (model.message || model.phase === 'concealed') return 'attention' as const;
  if (!model.online) return 'offline' as const;
  if (model.phase === 'loading') return 'syncing' as const;
  return 'ready' as const;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unbekannt';
  return new Intl.DateTimeFormat('de-CH', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
  }).format(date);
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
      style={[{ height: size, width: size }, rotate && styles.iconRotated]}
    />
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  brandLockup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
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
    justifyContent: 'space-between',
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
  },
  eventTitle: {
    ...typography.bodyStrong,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  externalActions: {
    gap: spacing.sm,
  },
  externalCopy: {
    ...typography.body,
    color: colors.text,
  },
  externalEyebrow: {
    ...typography.overline,
    color: colors.textSecondary,
  },
  externalField: {
    borderTopColor: colors.divider,
    borderTopWidth: borders.subtle,
    gap: spacing.md,
    marginTop: spacing.sm,
    paddingTop: spacing.lg,
  },
  externalPreview: {
    ...typography.bodyStrong,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.compact,
    borderWidth: borders.subtle,
    color: colors.text,
    padding: spacing.md,
  },
  externalStatus: {
    ...typography.label,
    color: colors.text,
  },
  eyebrow: {
    ...typography.overline,
    color: colors.textSecondary,
    marginTop: spacing.xl,
  },
  iconRotated: {
    transform: [{ rotate: '180deg' }],
  },
  logo: {
    height: 46,
    width: 46,
  },
  message: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  messageCard: {
    marginTop: spacing.lg,
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  momentBody: {
    ...typography.body,
    color: colors.text,
  },
  momentCard: {
    gap: spacing.sm,
  },
  momentHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  momentIcon: {
    alignItems: 'center',
    backgroundColor: colors.surfaceAction,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: borders.subtle,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  momentNumber: {
    ...typography.overline,
    color: colors.text,
  },
  momentTitle: {
    ...typography.subheading,
    color: colors.text,
  },
  privacyCard: {
    gap: spacing.md,
  },
  privacyCopy: {
    ...typography.body,
    color: colors.text,
  },
  recapList: {
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  reviewCard: {
    gap: spacing.sm,
  },
  reviewCopy: {
    ...typography.body,
    color: colors.text,
  },
  reviewTitle: {
    ...typography.subheading,
    color: colors.text,
  },
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  scroll: {
    flex: 1,
    overflow: 'hidden',
  },
  shareExpiry: {
    ...typography.label,
    color: colors.text,
  },
  stateCard: {
    alignItems: 'flex-start',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  stateCopy: {
    ...typography.body,
    color: colors.text,
  },
  stateTitle: {
    ...typography.subheading,
    color: colors.text,
  },
  title: {
    ...typography.title,
    color: colors.text,
    marginTop: spacing.sm,
  },
});
