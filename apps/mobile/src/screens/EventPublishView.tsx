import type { ImageSourcePropType } from 'react-native';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card, StatusChip, SyncStatus } from '../design/primitives';
import { colors, spacing, typography } from '../design/theme';
import { ScreenFrame, ScreenIcon } from './ScreenFrame';

const icons = {
  arrowRight: require('../assets/icons/arrow-right.png'),
  check: require('../assets/icons/check.png'),
  cloudOffline: require('../assets/icons/cloud-offline.png'),
  flag: require('../assets/icons/flag.png'),
} satisfies Record<string, ImageSourcePropType>;

export type EventPublishAction =
  | 'acknowledge_conflict'
  | 'publish'
  | 'refresh'
  | 'sync_publish';

export type EventPublishBlockerCode =
  | 'EVENT_CAPABILITY_PLACE_REQUIRED'
  | 'EVENT_CAPABILITY_REQUIRED'
  | 'EVENT_DESCRIPTION_REQUIRED'
  | 'EVENT_END_REQUIRED'
  | 'EVENT_START_REQUIRED'
  | 'EVENT_STATUS_NOT_DRAFT'
  | 'EVENT_TEMPLATE_REQUIRED'
  | 'EVENT_TITLE_REQUIRED';

export type EventPublishBlockerTarget = {
  capabilityType: 'golf' | 'lodging' | 'team' | 'transport' | 'travel';
  eventId: string;
};

export type EventPublishViewModel = {
  blockerCodes: readonly EventPublishBlockerCode[];
  blockerTargets?: readonly (EventPublishBlockerTarget | null)[];
  busyAction: EventPublishAction | null;
  conflict: {
    attempted: {
      blockerCodes: readonly EventPublishBlockerCode[];
      revision: string;
    };
    current: {
      blockerCodes: readonly EventPublishBlockerCode[];
      revision: string;
    };
  } | null;
  eventTitle: string;
  message: string | null;
  online: boolean;
  phase: 'concealed' | 'loading' | 'published' | 'review';
  planItemCount: number;
  planItems: readonly {
    id: string;
    startsAt: string | null;
    title: string;
  }[];
  ready: boolean;
  refreshedAt: string | null;
  role: 'organizer' | 'owner' | null;
  schedule: {
    endsAt: string | null;
    startsAt: string | null;
    timeZone: string;
  } | null;
  syncRequired: boolean;
  template: 'golf-tour' | 'team-event' | 'travel' | null;
};

export type EventPublishViewProps = {
  model: EventPublishViewModel;
  onBack(): void;
  onBlockerAction(
    code: EventPublishBlockerCode,
    target: EventPublishBlockerTarget | null,
  ): void;
  onPrimaryAction(action: EventPublishAction): void;
};

export function EventPublishView({
  model,
  onBack,
  onBlockerAction,
  onPrimaryAction,
}: EventPublishViewProps) {
  if (model.phase === 'loading') {
    return (
      <ScreenFrame
        description="Gespeicherter Entwurf und Veröffentlichungsstatus werden sicher geprüft."
        eyebrow="EVENT PRÜFEN"
        testID="event-publish-view"
        title="Prüfung wird geladen"
      />
    );
  }

  if (model.phase === 'concealed') {
    return (
      <ScreenFrame
        description="Diese Veröffentlichungsprüfung ist für dieses Konto nicht verfügbar."
        eyebrow="EVENT PRÜFEN"
        icon={icons.cloudOffline}
        liveRegion="polite"
        statusLabel="Sicher verborgen"
        testID="event-publish-view"
        title="Prüfung nicht verfügbar"
        tone="brand"
      >
        {model.message ? (
          <Text style={styles.message}>{model.message}</Text>
        ) : null}
        <View style={styles.actions}>
          {model.online ? (
            <Button
              accessibilityHint="Prüft Zugang und Veröffentlichungsstatus erneut online."
              icon={<ScreenIcon source={icons.cloudOffline} />}
              label="Erneut prüfen"
              loading={model.busyAction === 'refresh'}
              onPress={() => onPrimaryAction('refresh')}
              testID="event-publish-primary-action"
              variant="action"
            />
          ) : null}
          <Button
            accessibilityHint="Kehrt ohne Veröffentlichung zum privaten Event zurück."
            label="Zurück zum Event"
            onPress={onBack}
            testID="event-publish-back-action"
            variant="surface"
          />
        </View>
      </ScreenFrame>
    );
  }

  if (model.phase === 'published') {
    return (
      <ScreenFrame
        description={`${model.eventTitle} ist jetzt für berechtigte Crew-Mitglieder veröffentlicht.`}
        eyebrow="EVENT VERÖFFENTLICHT"
        icon={icons.check}
        liveRegion="polite"
        statusLabel="Veröffentlicht"
        testID="event-publish-view"
        title="Bereit für deine Crew"
        tone="action"
      >
        <Text style={styles.stateCopy}>
          {model.message ??
            'Der Server hat die Veröffentlichung bestätigt. Der aktuelle Eventstand ist auch lokal verfügbar.'}
        </Text>
        <Button
          accessibilityHint="Öffnet das veröffentlichte Event."
          icon={<ScreenIcon source={icons.arrowRight} />}
          label="Zum Event"
          onPress={onBack}
          testID="event-publish-primary-action"
          variant="action"
        />
      </ScreenFrame>
    );
  }

  const primary = primaryAction(model);
  const blockerCount = model.blockerCodes.length;
  const optionalImprovements =
    model.planItemCount === 0
      ? [
          {
            body: 'Programmpunkte können auch nach der Veröffentlichung ergänzt werden. Das blockiert die Freigabe nicht.',
            title: 'Programm ergänzen',
          },
        ]
      : [];

  return (
    <ScreenFrame
      description={model.eventTitle}
      eyebrow="EVENT PRÜFEN"
      icon={model.ready ? icons.check : icons.flag}
      liveRegion="polite"
      statusLabel={reviewStatus(model)}
      testID="event-publish-view"
      title="Sieh es wie deine Crew"
      tone={model.ready ? 'action' : 'surface'}
    >
      <View style={styles.metaRow}>
        <StatusChip label={roleLabel(model.role)} tone="lavender" />
        <StatusChip label={templateLabel(model.template)} tone="surface" />
      </View>

      <SyncStatus
        icon={
          <ScreenIcon
            size={17}
            source={model.online ? icons.check : icons.cloudOffline}
          />
        }
        label={syncLabel(model)}
        state={
          model.syncRequired ? 'attention' : model.online ? 'ready' : 'offline'
        }
      />

      {model.conflict ? (
        <Card
          accessibilityLabel={`Veröffentlichungsstand geändert. Geprüfter Stand Revision ${
            model.conflict.attempted.revision
          }: ${blockerSummary(
            model.conflict.attempted.blockerCodes,
          )}. Aktueller Stand Revision ${
            model.conflict.current.revision
          }: ${blockerSummary(model.conflict.current.blockerCodes)}.`}
          accessibilityRole="alert"
          style={styles.conflictCard}
          tone="brand"
        >
          <Text style={styles.cardEyebrow}>STAND GEÄNDERT</Text>
          <Text style={styles.cardTitle}>Prüfung wurde aktualisiert</Text>
          <Text style={styles.cardCopy}>
            Dein geprüfter Stand und der aktuelle Serverstand bleiben getrennt
            sichtbar. Bestätige den aktuellen Stand vor einem neuen Versuch.
          </Text>
          <View style={styles.truthPanel}>
            <Text style={styles.truthLabel}>
              {`GEPRÜFTER STAND · REVISION ${model.conflict.attempted.revision}`}
            </Text>
            <Text style={styles.truthCopy}>
              {blockerSummary(model.conflict.attempted.blockerCodes)}
            </Text>
          </View>
          <View style={styles.truthPanel}>
            <Text style={styles.truthLabel}>
              {`AKTUELLER STAND · REVISION ${model.conflict.current.revision}`}
            </Text>
            <Text style={styles.truthCopy}>
              {blockerSummary(model.conflict.current.blockerCodes)}
            </Text>
          </View>
        </Card>
      ) : null}

      <Card
        accessibilityLabel={`Vorschau für Crew-Mitglieder. ${
          model.eventTitle
        }. ${scheduleLabel(model.schedule)}. ${planLabel(
          model.planItemCount,
        )}.`}
        accessibilityRole="summary"
        style={styles.previewCard}
        tone="lavender"
      >
        <Text style={styles.cardEyebrow}>VORSCHAU FÜR DEINE CREW</Text>
        <Text style={styles.previewTitle}>{model.eventTitle}</Text>
        <Text style={styles.previewMeta}>{scheduleLabel(model.schedule)}</Text>
        <Text style={styles.previewMeta}>{planLabel(model.planItemCount)}</Text>
        {model.planItems.slice(0, 3).map(item => (
          <View key={item.id} style={styles.planRow}>
            <Text style={styles.planTime}>
              {timeLabel(item.startsAt, model.schedule?.timeZone)}
            </Text>
            <Text style={styles.planTitle}>{item.title}</Text>
          </View>
        ))}
        {model.planItemCount > model.planItems.slice(0, 3).length ? (
          <Text style={styles.previewMore}>
            +{model.planItemCount - model.planItems.slice(0, 3).length} weitere
            Programmpunkte
          </Text>
        ) : null}
        <Text style={styles.previewNote}>
          Sichtbar erst nach bestätigter Veröffentlichung.
        </Text>
      </Card>

      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          Vor Veröffentlichung
        </Text>
        <Text style={styles.sectionCopy}>
          {blockerCount === 0
            ? 'Alle verbindlichen Serverprüfungen sind erfüllt.'
            : `${blockerCount} verbindliche ${
                blockerCount === 1 ? 'Angabe fehlt' : 'Angaben fehlen'
              }.`}
        </Text>
        {model.blockerCodes.map((code, index) => {
          const copy = blockerCopy(code);
          const target = model.blockerTargets?.[index] ?? null;
          const setupAction = isActionableSetupBlocker(code, target);
          return (
            <Card
              accessibilityLabel={`${index + 1} von ${blockerCount}. ${
                copy.title
              }. ${copy.body}`}
              key={`${code}-${index}`}
              style={styles.issueCard}
              tone="surface"
            >
              <View style={styles.issueHeading}>
                <ScreenIcon size={22} source={icons.flag} />
                <Text style={styles.issueTitle}>{copy.title}</Text>
              </View>
              <Text style={styles.issueCopy}>{copy.body}</Text>
              {isEventBasicsBlocker(code) || setupAction ? (
                <Button
                  accessibilityHint={
                    setupAction
                      ? 'Öffnet den sicheren Setup-Ablauf für genau diesen Prüfpunkt.'
                      : 'Öffnet die fehlende Angabe im bestehenden privaten Event-Entwurf.'
                  }
                  label={setupAction ? 'Setup bearbeiten' : 'Angabe bearbeiten'}
                  onPress={() => onBlockerAction(code, target)}
                  testID={`event-publish-fix-${code}`}
                  variant="surface"
                />
              ) : null}
            </Card>
          );
        })}
      </View>

      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          Optional verbessern
        </Text>
        {optionalImprovements.length > 0 ? (
          optionalImprovements.map(improvement => (
            <Card
              key={improvement.title}
              style={styles.issueCard}
              tone="action"
            >
              <View style={styles.issueHeading}>
                <ScreenIcon size={22} source={icons.check} />
                <Text style={styles.issueTitle}>{improvement.title}</Text>
              </View>
              <Text style={styles.issueCopy}>{improvement.body}</Text>
            </Card>
          ))
        ) : (
          <Text style={styles.sectionCopy}>
            Keine optionalen Hinweise für diesen Stand.
          </Text>
        )}
      </View>

      {model.message ? (
        <Card accessibilityLiveRegion="polite" tone="brand">
          <Text style={styles.message}>{model.message}</Text>
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
            testID="event-publish-primary-action"
            variant="action"
          />
        ) : null}
        <Button
          accessibilityHint="Kehrt ohne weitere Änderung zum Event zurück."
          label="Zurück zum Event"
          onPress={onBack}
          testID="event-publish-back-action"
          variant="surface"
        />
      </View>
    </ScreenFrame>
  );
}

function primaryAction(model: EventPublishViewModel): {
  action: EventPublishAction;
  hint: string;
  icon: ImageSourcePropType;
  label: string;
} | null {
  if (model.conflict) {
    return {
      action: 'acknowledge_conflict',
      hint: 'Bestätigt den angezeigten aktuellen Serverstand, ohne zu veröffentlichen.',
      icon: icons.arrowRight,
      label: 'Änderungen geprüft',
    };
  }
  if (!model.online) return null;
  if (model.syncRequired) {
    return {
      action: 'sync_publish',
      hint: 'Synchronisiert zuerst alle lokalen Änderungen. Veröffentlicht nur online nach erneuter Serverprüfung.',
      icon: icons.cloudOffline,
      label: 'Synchronisieren und veröffentlichen',
    };
  }
  if (!model.ready) {
    return {
      action: 'refresh',
      hint: 'Lädt die verbindliche Prüfung erneut. Fehlende Angaben werden nicht automatisch geändert.',
      icon: icons.cloudOffline,
      label: 'Erneut prüfen',
    };
  }
  return {
    action: 'publish',
    hint: 'Synchronisiert erneut und veröffentlicht nur den unveränderten, serverseitig geprüften Stand.',
    icon: icons.arrowRight,
    label: 'Event veröffentlichen',
  };
}

function blockerCopy(code: EventPublishBlockerCode) {
  const copy: Record<EventPublishBlockerCode, { body: string; title: string }> =
    {
      EVENT_CAPABILITY_PLACE_REQUIRED: {
        body: 'Mindestens ein aktiviertes Setup benötigt noch einen Hauptort.',
        title: 'Ort im Setup fehlt',
      },
      EVENT_CAPABILITY_REQUIRED: {
        body: 'Das Event benötigt mindestens ein unterstütztes Setup.',
        title: 'Event-Setup fehlt',
      },
      EVENT_DESCRIPTION_REQUIRED: {
        body: 'Ergänze eine Beschreibung, bevor deine Crew das Event sehen kann.',
        title: 'Beschreibung fehlt',
      },
      EVENT_END_REQUIRED: {
        body: 'Lege das Ende des Events verbindlich fest.',
        title: 'Ende fehlt',
      },
      EVENT_START_REQUIRED: {
        body: 'Lege den Beginn des Events verbindlich fest.',
        title: 'Beginn fehlt',
      },
      EVENT_STATUS_NOT_DRAFT: {
        body: 'Nur ein privater Entwurf kann mit diesem Ablauf veröffentlicht werden.',
        title: 'Kein privater Entwurf',
      },
      EVENT_TEMPLATE_REQUIRED: {
        body: 'Wähle ein unterstütztes Setup für dieses Event.',
        title: 'Start-Setup fehlt',
      },
      EVENT_TITLE_REQUIRED: {
        body: 'Gib dem Event einen Titel, den deine Crew wiedererkennt.',
        title: 'Titel fehlt',
      },
    };
  return copy[code];
}

function blockerSummary(codes: readonly EventPublishBlockerCode[]) {
  if (codes.length === 0) return 'Keine verbindlichen Punkte offen';
  return codes.map(code => blockerCopy(code).title).join(' · ');
}

function isEventBasicsBlocker(code: EventPublishBlockerCode) {
  return (
    code === 'EVENT_DESCRIPTION_REQUIRED' ||
    code === 'EVENT_END_REQUIRED' ||
    code === 'EVENT_START_REQUIRED' ||
    code === 'EVENT_TITLE_REQUIRED'
  );
}

function isActionableSetupBlocker(
  code: EventPublishBlockerCode,
  target: EventPublishBlockerTarget | null,
) {
  if (code === 'EVENT_TEMPLATE_REQUIRED') return true;
  return (
    (code === 'EVENT_CAPABILITY_REQUIRED' ||
      code === 'EVENT_CAPABILITY_PLACE_REQUIRED') &&
    target !== null
  );
}

function reviewStatus(model: EventPublishViewModel) {
  if (!model.online) return 'Offline-Kopie';
  if (model.ready) return 'Bereit zur Veröffentlichung';
  const count = model.blockerCodes.length;
  return `${count} ${count === 1 ? 'Punkt offen' : 'Punkte offen'}`;
}

function syncLabel(model: EventPublishViewModel) {
  if (model.syncRequired) {
    return 'Lokale Änderungen müssen zuerst synchronisiert werden';
  }
  if (!model.online) {
    return 'Offline-Kopie · Veröffentlichung wartet auf Verbindung';
  }
  if (!model.refreshedAt) return 'Online-Prüfung ausstehend';
  return `Online geprüft · ${relativeRefresh(model.refreshedAt)}`;
}

function relativeRefresh(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'aktueller Serverstand';
  return `Stand ${date.toLocaleTimeString('de-CH', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

function roleLabel(role: EventPublishViewModel['role']) {
  return role === 'owner' ? 'Eigentümer:in' : 'Organisator:in';
}

function templateLabel(template: EventPublishViewModel['template']) {
  if (template === 'golf-tour') return 'Golfreise';
  if (template === 'team-event') return 'Teamevent';
  if (template === 'travel') return 'Reise';
  return 'Setup offen';
}

function scheduleLabel(schedule: EventPublishViewModel['schedule']) {
  if (!schedule?.startsAt && !schedule?.endsAt) return 'Termin noch offen';
  const start = dateLabel(schedule?.startsAt ?? null, schedule?.timeZone);
  const end = dateLabel(schedule?.endsAt ?? null, schedule?.timeZone);
  if (!start) return end ? `Bis ${end}` : 'Termin noch offen';
  if (!end || start === end) return start;
  return `${start} – ${end}`;
}

function dateLabel(value: string | null, timeZone?: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat('de-CH', {
      day: 'numeric',
      month: 'long',
      timeZone,
      year: 'numeric',
    }).format(date);
  } catch {
    return null;
  }
}

function timeLabel(value: string | null, timeZone?: string) {
  if (!value) return 'OFFEN';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'OFFEN';
  try {
    return new Intl.DateTimeFormat('de-CH', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone,
    }).format(date);
  } catch {
    return 'OFFEN';
  }
}

function planLabel(count: number) {
  if (count === 0) return 'Noch keine Programmpunkte';
  return `${count} ${count === 1 ? 'Programmpunkt' : 'Programmpunkte'}`;
}

const styles = StyleSheet.create({
  actions: {
    gap: spacing.md,
  },
  cardCopy: {
    ...typography.body,
    color: colors.text,
  },
  cardEyebrow: {
    ...typography.overline,
    color: colors.textSecondary,
  },
  cardTitle: {
    ...typography.subheading,
    color: colors.text,
  },
  conflictCard: {
    gap: spacing.sm,
  },
  issueCard: {
    gap: spacing.sm,
  },
  issueCopy: {
    ...typography.body,
    color: colors.textSecondary,
  },
  issueHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  issueTitle: {
    ...typography.bodyStrong,
    color: colors.text,
    flex: 1,
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
  planRow: {
    alignItems: 'flex-start',
    borderTopColor: colors.divider,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    paddingTop: spacing.sm,
  },
  planTime: {
    ...typography.label,
    color: colors.textSecondary,
    minWidth: 48,
  },
  planTitle: {
    ...typography.bodyStrong,
    color: colors.text,
    flex: 1,
  },
  previewCard: {
    gap: spacing.sm,
  },
  previewMeta: {
    ...typography.body,
    color: colors.textSecondary,
  },
  previewMore: {
    ...typography.label,
    color: colors.textSecondary,
  },
  previewNote: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  previewTitle: {
    ...typography.heading,
    color: colors.text,
  },
  section: {
    gap: spacing.md,
  },
  sectionCopy: {
    ...typography.body,
    color: colors.textSecondary,
  },
  sectionTitle: {
    ...typography.subheading,
    color: colors.text,
  },
  stateCopy: {
    ...typography.body,
    color: colors.text,
  },
  truthCopy: {
    ...typography.body,
    color: colors.text,
  },
  truthLabel: {
    ...typography.overline,
    color: colors.textSecondary,
  },
  truthPanel: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    gap: spacing.xs,
    padding: spacing.md,
  },
});
