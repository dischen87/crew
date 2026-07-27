import type { EventTreeNode } from '@crew/mobile-data';
import type { ImageSourcePropType } from 'react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card, StatusChip, SyncStatus } from '../design/primitives';
import {
  borders,
  colors,
  elevations,
  spacing,
  typography,
} from '../design/theme';
import type { PlanItemSnapshot, PlanSnapshot } from './PlanRuntime';
import { ScreenFrame, ScreenIcon } from './ScreenFrame';

const icons = {
  arrowRight: require('../assets/icons/arrow-right.png'),
  bus: require('../assets/icons/bus.png'),
  calendar: require('../assets/icons/calendar.png'),
  check: require('../assets/icons/check.png'),
  cloudOffline: require('../assets/icons/cloud-offline.png'),
  crew: require('../assets/icons/crew.png'),
  flag: require('../assets/icons/flag.png'),
  golf: require('../assets/icons/golf.png'),
  location: require('../assets/icons/location.png'),
  wine: require('../assets/icons/wine.png'),
} satisfies Record<string, ImageSourcePropType>;

export type PlanViewModel = {
  message: string | null;
  online: boolean;
  phase: 'concealed' | 'loading' | 'ready';
  refreshing: boolean;
  selectedEventId: string | null;
  selectedItemId: string | null;
  snapshot: PlanSnapshot | null;
};

export type PlanViewProps = {
  model: PlanViewModel;
  onAddItem(eventId: string): void;
  onBack(): void;
  onDiscardIssue(mutationId: string): void;
  onEditItem(eventId: string, itemId: string): void;
  onOpenItem(itemId: string): void;
  onRefresh(): void;
  onSelectEvent(eventId: string): void;
  onSelectItem(itemId: string): void;
};

export function PlanView({
  model,
  onAddItem,
  onBack,
  onDiscardIssue,
  onEditItem,
  onOpenItem,
  onRefresh,
  onSelectEvent,
  onSelectItem,
}: PlanViewProps) {
  if (model.phase === 'loading') {
    return (
      <ScreenFrame
        description="Eventstruktur und Programmpunkte werden aus der sicheren Offline-Kopie geladen."
        eyebrow="PLAN"
        testID="plan-view"
        title="Plan wird geladen"
      />
    );
  }

  if (model.phase === 'concealed' || !model.snapshot) {
    return (
      <ScreenFrame
        description="Dieser private Plan ist für dieses Konto nicht verfügbar."
        eyebrow="PLAN"
        icon={icons.cloudOffline}
        liveRegion="polite"
        statusLabel="Sicher verborgen"
        testID="plan-view"
        title="Plan nicht verfügbar"
        tone="brand"
      >
        {model.message ? (
          <Text style={styles.body}>{model.message}</Text>
        ) : null}
        <View style={styles.actions}>
          {model.online ? (
            <Button
              icon={<ScreenIcon source={icons.cloudOffline} />}
              label="Erneut prüfen"
              loading={model.refreshing}
              onPress={onRefresh}
              testID="plan-refresh"
              variant="action"
            />
          ) : null}
          <Button
            label="Zurück zum Event"
            onPress={onBack}
            testID="plan-back"
            variant="surface"
          />
        </View>
      </ScreenFrame>
    );
  }

  const snapshot = model.snapshot;
  const root = snapshot.events.find(event => event.depth === 0);
  const selectedEvent =
    snapshot.events.find(event => event.id === model.selectedEventId) ??
    root ??
    snapshot.events[0];
  const selectedEventIds = selectedEvent
    ? eventSubtreeIds(snapshot.events, selectedEvent.id)
    : new Set<string>();
  const items =
    !selectedEvent || selectedEvent.depth === 0
      ? snapshot.items
      : snapshot.items.filter(item =>
          selectedEventIds.has(item.values.eventId),
        );
  const manager = snapshot.canEdit;
  const selectedItem = snapshot.items.find(
    item => item.id === model.selectedItemId,
  );

  return (
    <ScreenFrame
      description={root?.title ?? 'Dein Event'}
      eyebrow="PLAN"
      icon={planStatusIcon(snapshot)}
      liveRegion="polite"
      statusLabel={planStatusLabel(snapshot, model.online)}
      testID="plan-view"
      title="Alles in einem Plan"
      tone={snapshot.issues.length > 0 ? 'brand' : 'surface'}
    >
      <View style={styles.metaRow}>
        <StatusChip label={roleLabel(snapshot.role)} tone="lavender" />
        <StatusChip
          label={manager ? 'Plan bearbeiten' : 'Nur ansehen'}
          tone="surface"
        />
      </View>
      <SyncStatus
        icon={
          <ScreenIcon
            size={17}
            source={
              model.online && snapshot.syncStatus.state === 'synced'
                ? icons.check
                : icons.cloudOffline
            }
          />
        }
        label={snapshot.syncStatus.summary}
        state={syncState(snapshot)}
      />

      {model.message ? (
        <Card accessibilityLiveRegion="polite" tone="brand">
          <Text style={styles.body}>{model.message}</Text>
        </Card>
      ) : null}
      {snapshot.issues.length > 0 ? (
        <Card accessibilityRole="alert" tone="brand">
          <Text style={styles.cardTitle}>Änderungen prüfen</Text>
          <Text style={styles.body}>
            {snapshot.issues.length === 1
              ? 'Ein Programmpunkt braucht deine Aufmerksamkeit. Deine lokale Änderung bleibt erhalten.'
              : `${snapshot.issues.length} Programmpunkte brauchen deine Aufmerksamkeit. Deine lokalen Änderungen bleiben erhalten.`}
          </Text>
          {snapshot.issues.map(issue => {
            const title =
              issue.attempted?.title ??
              issue.current?.title ??
              'Unbekannter Programmpunkt';
            const eventId =
              issue.attempted?.eventId ?? issue.current?.eventId ?? null;
            const eventTitle =
              snapshot.events.find(event => event.id === eventId)?.title ?? null;
            const context = eventTitle ? `${title} · ${eventTitle}` : title;
            return (
              <View key={issue.mutationId} style={styles.issue}>
                <Text style={styles.cardTitle}>{context}</Text>
                <Text style={styles.body}>{issueLabel(issue.code)}</Text>
                <Button
                  accessibilityLabel={`Lokale Änderung für ${context} verwerfen`}
                  label="Lokale Änderung verwerfen"
                  onPress={() => onDiscardIssue(issue.mutationId)}
                  testID={`plan-discard-issue-${issue.mutationId}`}
                  variant="surface"
                />
              </View>
            );
          })}
          {model.online ? (
            <Button
              label="Aktuellen Stand laden"
              loading={model.refreshing}
              onPress={onRefresh}
              testID="plan-refresh"
              variant="surface"
            />
          ) : null}
        </Card>
      ) : null}

      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          Eventstruktur
        </Text>
        <Text style={styles.body}>
          Wähle einen Bereich. Ebene, übergeordnetes Event und Position werden
          auch vorgelesen.
        </Text>
        <View accessibilityRole="list" style={styles.tree}>
          {snapshot.events.map(event => (
            <EventTreeRow
              event={event}
              events={snapshot.events}
              key={event.id}
              onPress={() => onSelectEvent(event.id)}
              selected={event.id === selectedEvent?.id}
            />
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeading}>
          <View style={styles.flex}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>
              Zeitplan
            </Text>
            <Text style={styles.body}>
              {selectedEvent?.depth === 0
                ? 'Alle Programmpunkte in chronologischer Reihenfolge'
                : selectedEvent?.title ?? 'Gewählter Bereich'}
            </Text>
          </View>
          <StatusChip
            label={`${items.length} ${
              items.length === 1 ? 'Eintrag' : 'Einträge'
            }`}
            tone="surface"
          />
        </View>
        {items.length > 0 ? (
          <View
            accessibilityRole={manager ? 'list' : 'radiogroup'}
            style={styles.itemList}
          >
            {items.map(item => (
              <PlanItemRow
                editable={
                  manager && item.delivery === 'clean' && item.version !== null
                }
                eventTitle={
                  snapshot.events.find(
                    event => event.id === item.values.eventId,
                  )?.title ?? 'Event'
                }
                item={item}
                key={item.id}
                manager={manager}
                onPress={() =>
                  manager
                    ? item.delivery === 'clean' && item.version !== null
                      ? onEditItem(item.values.eventId, item.id)
                      : onOpenItem(item.id)
                    : onSelectItem(item.id)
                }
                selected={item.id === selectedItem?.id}
              />
            ))}
          </View>
        ) : (
          <Card tone="lavender">
            <Text style={styles.cardTitle}>Noch nichts geplant</Text>
            <Text style={styles.body}>
              {manager
                ? 'Füge den ersten Programmpunkt für diesen Bereich hinzu.'
                : 'Neue Programmpunkte erscheinen nach dem nächsten Abgleich.'}
            </Text>
          </Card>
        )}
      </View>

      <View style={styles.actions}>
        {manager && selectedEvent ? (
          <Button
            accessibilityHint={`Fügt einen Programmpunkt unter ${selectedEvent.title} hinzu.`}
            icon={<ScreenIcon source={icons.arrowRight} />}
            label={addLabel(selectedEvent)}
            onPress={() => onAddItem(selectedEvent.id)}
            testID="plan-primary-action"
            variant="action"
          />
        ) : (
          <Button
            accessibilityHint="Öffnet den ausgewählten Programmpunkt mit Zeit, Ort und Hinweisen."
            disabled={!selectedItem}
            icon={<ScreenIcon source={icons.arrowRight} />}
            label="Ausgewählten Punkt öffnen"
            onPress={() => {
              if (selectedItem) onOpenItem(selectedItem.id);
            }}
            testID="plan-primary-action"
            variant="action"
          />
        )}
        <Button
          label="Zurück zum Event"
          onPress={onBack}
          testID="plan-back"
          variant="surface"
        />
      </View>
    </ScreenFrame>
  );
}

function EventTreeRow({
  event,
  events,
  onPress,
  selected,
}: {
  event: EventTreeNode;
  events: readonly EventTreeNode[];
  onPress(): void;
  selected: boolean;
}) {
  const parent = events.find(candidate => candidate.id === event.parentEventId);
  const siblings = events.filter(
    candidate => candidate.parentEventId === event.parentEventId,
  );
  const position =
    siblings.findIndex(candidate => candidate.id === event.id) + 1;
  const childCount = events.filter(
    candidate => candidate.parentEventId === event.id,
  ).length;
  const level = event.depth + 1;
  const hierarchy = parent ? `unter ${parent.title}` : 'oberste Ebene';
  return (
    <Pressable
      accessibilityHint="Wählt diesen Bereich für den Zeitplan."
      accessibilityLabel={`${event.title}, ${kindLabel(
        event.kind,
      )}, ${eventStatusLabel(
        event.status,
      )}, Ebene ${level}, ${hierarchy}, Position ${position} von ${
        siblings.length
      }, ${childCount > 0 ? 'geöffnet' : 'ohne Unterbereiche'}`}
      accessibilityRole="button"
      accessibilityState={{ expanded: childCount > 0, selected }}
      onPress={onPress}
      style={styles.pressable}
      testID={`plan-event-${event.id}`}
    >
      {({ pressed }) => (
        <Card
          elevated
          style={[
            styles.treeCard,
            { marginLeft: Math.min(event.depth, 3) * spacing.md },
            selected && styles.selectedCard,
            pressed && styles.pressedCard,
            pressed && elevations.pressed,
          ]}
          tone={selected ? 'action' : 'surface'}
        >
          <View style={styles.treeHeading}>
            <View style={styles.roundIcon}>
              <ScreenIcon source={eventIcon(event.kind)} />
            </View>
            <View style={styles.flex}>
              <Text accessibilityRole="header" style={styles.cardTitle}>
                {event.title}
              </Text>
              <Text style={styles.caption}>
                Ebene {level} · {hierarchy} · {position}/{siblings.length}
              </Text>
              <StatusChip
                label={eventStatusLabel(event.status)}
                tone={event.status === 'cancelled' ? 'brand' : 'surface'}
              />
            </View>
          </View>
        </Card>
      )}
    </Pressable>
  );
}

function PlanItemRow({
  editable,
  eventTitle,
  item,
  manager,
  onPress,
  selected,
}: {
  editable: boolean;
  eventTitle: string;
  item: PlanItemSnapshot;
  manager: boolean;
  onPress(): void;
  selected: boolean;
}) {
  const type = item.values.details.type;
  const time = itemTime(item);
  const state = itemStateLabel(item);
  return (
    <Pressable
      accessibilityHint={
        manager
          ? editable
            ? 'Öffnet diesen Programmpunkt zum Bearbeiten.'
            : 'Öffnet den lokal gespeicherten Programmpunkt ohne weitere Änderung.'
          : 'Wählt diesen Programmpunkt. Öffne ihn danach mit der Hauptaktion.'
      }
      accessibilityLabel={`${time}. ${item.values.title}. ${typeLabel(
        type,
      )}. ${eventTitle}. ${state}.`}
      accessibilityRole={manager ? 'button' : 'radio'}
      accessibilityState={manager ? undefined : { checked: selected }}
      onPress={onPress}
      style={styles.pressable}
      testID={`plan-item-${item.id}`}
    >
      {({ pressed }) => (
        <Card
          elevated
          style={[
            styles.itemCard,
            selected && styles.selectedCard,
            pressed && styles.pressedCard,
            pressed && elevations.pressed,
          ]}
          tone={selected ? 'action' : itemTone(item)}
        >
          <View style={styles.itemHeading}>
            <View style={styles.roundIcon}>
              <ScreenIcon source={itemIcon(type)} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.itemTime}>{time}</Text>
              <Text style={styles.cardTitle}>{item.values.title}</Text>
              <Text style={styles.caption}>
                {eventTitle} · {typeLabel(type)} · {item.values.timeZone}
              </Text>
            </View>
          </View>
          <View style={styles.metaRow}>
            <StatusChip label={state} tone={itemTone(item)} />
            {manager ? (
              <StatusChip
                label={editable ? 'Bearbeiten' : 'Details'}
                tone="surface"
              />
            ) : selected ? (
              <StatusChip label="Ausgewählt" tone="brand" />
            ) : null}
          </View>
        </Card>
      )}
    </Pressable>
  );
}

function planStatusLabel(snapshot: PlanSnapshot, online: boolean) {
  if (snapshot.issues.length > 0) return 'Änderungen prüfen';
  if (!online) return 'Offline verfügbar';
  if (snapshot.syncStatus.state !== 'synced') return 'Änderungen gespeichert';
  return 'Plan aktuell';
}

function planStatusIcon(snapshot: PlanSnapshot) {
  return snapshot.issues.length > 0 ? icons.flag : icons.calendar;
}

function issueLabel(code: PlanSnapshot['issues'][number]['code']) {
  if (code === 'conflict') {
    return 'Konflikt: Deine lokale Eingabe und der Serverstand unterscheiden sich.';
  }
  if (code === 'permission') {
    return 'Berechtigung: Diese lokale Änderung wurde nicht übernommen.';
  }
  if (code === 'deleted') {
    return 'Entfernt: Der Programmpunkt existiert im aktuellen Plan nicht mehr.';
  }
  return 'Diese lokale Änderung wurde nicht bestätigt.';
}

function syncState(snapshot: PlanSnapshot) {
  if (snapshot.syncStatus.attentionCount > 0) return 'attention' as const;
  if (
    snapshot.syncStatus.state === 'pending' ||
    snapshot.syncStatus.state === 'syncing' ||
    snapshot.syncStatus.state === 'waiting_retry' ||
    snapshot.syncStatus.state === 'resetting'
  ) {
    return 'syncing' as const;
  }
  if (snapshot.syncStatus.state === 'blocked') return 'offline' as const;
  return 'ready' as const;
}

function itemTime(item: PlanItemSnapshot) {
  if (item.values.allDay) return 'Ganztägig';
  if (!item.values.startsAt) return 'Zeit offen';
  const date = new Date(item.values.startsAt);
  if (Number.isNaN(date.valueOf())) return 'Zeit offen';
  return new Intl.DateTimeFormat('de-CH', {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: '2-digit',
    timeZone: item.values.timeZone,
  }).format(date);
}

function itemStateLabel(item: PlanItemSnapshot) {
  if (item.delivery === 'attention') return 'Aktion erforderlich';
  if (item.delivery === 'queued') return 'Lokal gespeichert';
  if (item.delivery === 'syncing') return 'Wird synchronisiert';
  if (item.values.status === 'cancelled') return 'Abgesagt';
  if (item.values.status === 'archived') return 'Archiviert';
  return 'Aktiv';
}

function itemTone(item: PlanItemSnapshot) {
  return item.delivery === 'attention' || item.values.status === 'cancelled'
    ? ('brand' as const)
    : item.delivery === 'queued' || item.delivery === 'syncing'
    ? ('lavender' as const)
    : ('surface' as const);
}

function addLabel(event: EventTreeNode) {
  if (event.kind === 'golf') return 'Runde hinzufügen';
  if (
    event.kind === 'team_event' ||
    event.kind === 'session' ||
    event.kind === 'activity'
  ) {
    return 'Agenda-Punkt hinzufügen';
  }
  if (event.kind === 'trip' || event.kind === 'day') {
    return 'Reiseeintrag hinzufügen';
  }
  return 'Zum Plan hinzufügen';
}

function roleLabel(role: PlanSnapshot['role']) {
  if (role === 'owner') return 'Owner';
  if (role === 'organizer') return 'Organisator:in';
  if (role === 'participant') return 'Teilnehmer:in';
  return 'Betrachter:in';
}

function eventSubtreeIds(
  events: readonly EventTreeNode[],
  selectedEventId: string,
) {
  const ids = new Set([selectedEventId]);
  let size = 0;
  while (size !== ids.size) {
    size = ids.size;
    for (const event of events) {
      if (event.parentEventId && ids.has(event.parentEventId))
        ids.add(event.id);
    }
  }
  return ids;
}

function kindLabel(kind: EventTreeNode['kind']) {
  if (kind === 'trip') return 'Reise';
  if (kind === 'day') return 'Tag';
  if (kind === 'golf') return 'Golfrunde';
  if (kind === 'team_event') return 'Team-Event';
  if (kind === 'session') return 'Session';
  if (kind === 'activity') return 'Aktivität';
  return 'Bereich';
}

function eventStatusLabel(status: EventTreeNode['status']) {
  if (status === 'published') return 'Veröffentlicht';
  if (status === 'cancelled') return 'Abgesagt';
  if (status === 'archived') return 'Archiviert';
  return 'Entwurf';
}

function eventIcon(kind: EventTreeNode['kind']) {
  if (kind === 'golf') return icons.golf;
  if (kind === 'team_event') return icons.crew;
  if (kind === 'trip') return icons.bus;
  return icons.calendar;
}

function typeLabel(type: PlanItemSnapshot['values']['details']['type']) {
  if (type === 'flight') return 'Flug';
  if (type === 'rail') return 'Bahn';
  if (type === 'road_transfer') return 'Transfer';
  if (type === 'lodging') return 'Unterkunft';
  if (type === 'meal') return 'Essen';
  if (type === 'golf_round') return 'Golfrunde';
  if (type === 'session') return 'Session';
  if (type === 'activity') return 'Aktivität';
  return 'Notiz';
}

function itemIcon(type: PlanItemSnapshot['values']['details']['type']) {
  if (type === 'flight' || type === 'rail' || type === 'road_transfer') {
    return icons.bus;
  }
  if (type === 'lodging') return icons.location;
  if (type === 'meal') return icons.wine;
  if (type === 'golf_round') return icons.golf;
  if (type === 'session' || type === 'activity') return icons.crew;
  return icons.calendar;
}

const styles = StyleSheet.create({
  actions: {
    gap: spacing.md,
  },
  body: {
    ...typography.body,
    color: colors.text,
  },
  caption: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  cardTitle: {
    ...typography.subheading,
    color: colors.text,
    flexShrink: 1,
  },
  flex: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  itemCard: {
    gap: spacing.md,
  },
  itemHeading: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
  },
  itemList: {
    gap: spacing.md,
  },
  issue: {
    gap: spacing.sm,
  },
  itemTime: {
    ...typography.label,
    color: colors.textSecondary,
  },
  metaRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  pressedCard: {
    backgroundColor: colors.backgroundPressed,
  },
  pressable: {
    borderRadius: 20,
  },
  roundIcon: {
    alignItems: 'center',
    backgroundColor: colors.surfaceBrand,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: borders.chip,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  section: {
    gap: spacing.md,
  },
  sectionHeading: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  sectionTitle: {
    ...typography.heading,
    color: colors.text,
  },
  selectedCard: {
    backgroundColor: colors.surfaceAction,
  },
  tree: {
    gap: spacing.md,
  },
  treeCard: {
    gap: spacing.md,
  },
  treeHeading: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
  },
});
