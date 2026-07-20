import type { ImageSourcePropType } from 'react-native';
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, StatusChip } from '../design/primitives';
import {
  borders,
  colors,
  componentMetrics,
  elevations,
  radii,
  spacing,
  typography,
} from '../design/theme';

const boardBackground = require('../assets/crew-board-background.png');
const crewLogo = require('../assets/crew-logo.png');
const icons = {
  arrowRight: require('../assets/icons/arrow-right.png'),
  calendar: require('../assets/icons/calendar.png'),
  cloudOffline: require('../assets/icons/cloud-offline.png'),
  crew: require('../assets/icons/crew.png'),
  golf: require('../assets/icons/golf.png'),
} satisfies Record<string, ImageSourcePropType>;

export type EventsViewEvent = {
  endsAt: string | null;
  kind:
    | 'activity'
    | 'day'
    | 'golf'
    | 'other'
    | 'session'
    | 'team_event'
    | 'trip';
  membershipStatus: 'active';
  role: 'organizer' | 'owner' | 'participant' | 'viewer';
  rootEventId: string;
  startsAt: string | null;
  status: 'cancelled' | 'draft' | 'published';
  timeZone: string;
  title: string;
};

export type EventsViewState =
  | {
      kind: 'empty';
      phase: 'fresh' | 'offline' | 'refreshing';
      refreshedAt: string;
    }
  | { kind: 'error'; retryable: boolean; retrying?: boolean }
  | { kind: 'loading' }
  | {
      events: readonly EventsViewEvent[];
      kind: 'ready';
      phase: 'fresh' | 'offline' | 'refreshing';
      refreshedAt: string;
    };

export type EventsViewProps = {
  logoutError?: boolean;
  logoutLoading?: boolean;
  onCreate?(): void;
  onLogout?(): void;
  onRetry?(): void;
  onSelect(rootEventId: string): void;
  state: EventsViewState;
};

export function EventsView({
  logoutError = false,
  logoutLoading = false,
  onCreate,
  onLogout,
  onRetry,
  onSelect,
  state,
}: EventsViewProps) {
  const insets = useSafeAreaInsets();
  const description = stateDescription(state);
  const createButton = onCreate ? (
    <Button
      accessibilityHint="Öffnet den privaten Ablauf zum Erstellen eines neuen Event-Entwurfs."
      icon={<AssetIcon name="arrowRight" size={22} />}
      label="Event erstellen"
      onPress={onCreate}
      style={
        state.kind === 'error'
          ? styles.secondaryCreateButton
          : styles.createButton
      }
      testID="events-create"
      variant={state.kind === 'error' ? 'surface' : 'action'}
    />
  ) : null;

  return (
    <ImageBackground
      resizeMode="cover"
      source={boardBackground}
      style={styles.screen}
      testID="events-view"
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

        <Text accessibilityRole="header" style={styles.title}>
          Events
        </Text>
        <Text style={styles.description}>{description}</Text>

        {state.kind === 'error' ? null : createButton}

        {state.kind === 'ready' ? (
          <View style={styles.eventSection}>
            <View style={styles.sectionHeadingRow}>
              <Text style={styles.sectionHeading}>DEINE EVENTS</Text>
              <StatusChip
                label={`${state.events.length} ${
                  state.events.length === 1 ? 'Event' : 'Events'
                }`}
                tone={state.phase === 'refreshing' ? 'brand' : 'surface'}
              />
            </View>
            {state.phase === 'refreshing' ? (
              <Text accessibilityLiveRegion="polite" style={styles.refreshing}>
                Events werden aktualisiert.
              </Text>
            ) : null}
            {state.phase === 'offline' ? (
              <OfflineStatus
                onRetry={onRetry}
                refreshedAt={state.refreshedAt}
              />
            ) : null}
            <EventRootList events={state.events} onSelect={onSelect} />
          </View>
        ) : (
          <EventsStateCard onRetry={onRetry} state={state} />
        )}
        {state.kind === 'error' ? createButton : null}
        {onLogout ? (
          <View style={styles.logoutSection}>
            {logoutError ? (
              <Text
                accessibilityLiveRegion="assertive"
                accessibilityRole="alert"
                style={styles.logoutError}
              >
                Abmelden konnte nicht sicher abgeschlossen werden. Bitte
                versuche es erneut.
              </Text>
            ) : null}
            <Button
              accessibilityHint="Öffnet eine Bestätigung. Erst danach wird die private Sitzung beendet; zurückgehaltene Feedback-Daten werden von diesem Gerät entfernt."
              label={logoutError ? 'Abmelden erneut versuchen' : 'Abmelden'}
              loading={logoutLoading}
              onPress={onLogout}
              testID="events-logout"
              variant="surface"
            />
          </View>
        ) : null}
      </ScrollView>
    </ImageBackground>
  );
}

export function EventRootList({
  events,
  onSelect,
}: {
  events: readonly EventsViewEvent[];
  onSelect(rootEventId: string): void;
}) {
  return (
    <View accessibilityRole="list" style={styles.eventList}>
      {events.map(event => (
        <EventRootCard
          event={event}
          key={event.rootEventId}
          onSelect={onSelect}
        />
      ))}
    </View>
  );
}

function EventRootCard({
  event,
  onSelect,
}: {
  event: EventsViewEvent;
  onSelect(rootEventId: string): void;
}) {
  const date = eventDateLabel(event);
  const role = roleLabel(event.role);
  const lifecycle = lifecycleLabel(event.status);

  return (
    <Pressable
      accessible
      accessibilityHint="Öffnet dieses Event, ohne Eventdaten zu ändern."
      accessibilityLabel={`${event.title}. ${kindLabel(
        event.kind,
      )}. ${date}. Rolle ${accessibleRoleLabel(
        event.role,
      )}. Status ${lifecycle}. Öffnen.`}
      accessibilityRole="button"
      onPress={() => onSelect(event.rootEventId)}
      style={styles.eventPressable}
      testID={`event-${event.rootEventId}`}
    >
      {({ pressed }) => (
        <Card
          elevated
          style={[
            styles.eventCard,
            pressed && styles.eventCardPressed,
            pressed && elevations.pressed,
          ]}
          tone={lifecycleTone(event.status)}
        >
          <View style={styles.eventHeader}>
            <View style={styles.eventIcon}>
              <AssetIcon name={kindIcon(event.kind)} size={26} />
            </View>
            <View style={styles.eventHeadingCopy}>
              <Text style={styles.eventKind}>{kindLabel(event.kind)}</Text>
              <Text style={styles.eventTitle}>{event.title}</Text>
            </View>
            <AssetIcon name="arrowRight" size={22} />
          </View>

          <Text style={styles.eventDate}>{date}</Text>
          <View style={styles.eventMeta}>
            <StatusChip label={role} tone="surface" />
            <StatusChip
              label={lifecycle}
              tone={event.status === 'published' ? 'action' : 'lavender'}
            />
          </View>
        </Card>
      )}
    </Pressable>
  );
}

function EventsStateCard({
  onRetry,
  state,
}: {
  onRetry?: () => void;
  state: Exclude<EventsViewState, { kind: 'ready' }>;
}) {
  if (state.kind === 'loading') {
    return (
      <Card
        accessibilityLabel="Events werden geladen. Deine sichtbaren Events werden sicher über den Crew Gateway geladen."
        accessibilityLiveRegion="polite"
        style={styles.stateCard}
        tone="surface"
      >
        <ActivityIndicator
          accessibilityLabel="Events werden geladen"
          color={colors.textSecondary}
          size="large"
        />
        <Text style={styles.stateTitle}>Events werden geladen</Text>
        <Text style={styles.stateCopy}>
          Deine sichtbaren Events werden sicher geladen.
        </Text>
      </Card>
    );
  }

  if (state.kind === 'empty') {
    const offline = state.phase === 'offline';
    return (
      <Card
        accessibilityLiveRegion="polite"
        style={styles.stateCard}
        tone="surface"
      >
        <View style={[styles.stateIcon, styles.emptyIcon]}>
          <AssetIcon name="calendar" size={27} />
        </View>
        <Text style={styles.stateTitle}>
          {offline ? 'Offline verfügbar' : 'Noch keine Events'}
        </Text>
        <Text style={styles.stateCopy}>
          {offline
            ? 'Im zuletzt gespeicherten Stand sind keine Events sichtbar.'
            : 'Du hast aktuell keine sichtbaren Events. Sobald ein Event für dich verfügbar ist, erscheint es hier.'}
        </Text>
        {state.phase === 'refreshing' ? (
          <Text accessibilityLiveRegion="polite" style={styles.refreshing}>
            Events werden aktualisiert.
          </Text>
        ) : null}
        {offline ? (
          <>
            <Text style={styles.cacheTime}>
              {refreshLabel(state.refreshedAt)}
            </Text>
            {onRetry ? (
              <Button
                accessibilityHint="Prüft über den Crew Gateway auf aktuelle sichtbare Events."
                icon={<AssetIcon name="arrowRight" size={22} />}
                label="Aktualisieren"
                onPress={onRetry}
                style={styles.retryButton}
                testID="events-offline-retry"
                variant="action"
              />
            ) : null}
          </>
        ) : null}
      </Card>
    );
  }

  return (
    <Card
      accessibilityLiveRegion="assertive"
      accessibilityRole="alert"
      style={styles.stateCard}
      tone="brand"
    >
      <View style={[styles.stateIcon, styles.errorIcon]}>
        <AssetIcon name="cloudOffline" size={27} />
      </View>
      <Text style={styles.stateTitle}>Events nicht verfügbar</Text>
      <Text style={styles.stateCopy}>
        Deine Events können gerade nicht sicher geladen werden.
      </Text>
      {state.retryable && onRetry ? (
        <Button
          accessibilityHint="Lädt die sichtbaren Events erneut über den Crew Gateway."
          icon={<AssetIcon name="arrowRight" size={22} />}
          label="Erneut versuchen"
          loading={state.retrying}
          onPress={onRetry}
          style={styles.retryButton}
          testID="events-retry"
          variant="action"
        />
      ) : null}
    </Card>
  );
}

function OfflineStatus({
  onRetry,
  refreshedAt,
}: {
  onRetry?: () => void;
  refreshedAt: string;
}) {
  return (
    <Card
      accessibilityLiveRegion="polite"
      style={styles.offlineCard}
      testID="events-offline-status"
      tone="brand"
    >
      <View style={styles.offlineHeading}>
        <View style={[styles.stateIcon, styles.errorIcon]}>
          <AssetIcon name="cloudOffline" size={24} />
        </View>
        <View style={styles.offlineCopy}>
          <Text style={styles.offlineTitle}>Offline verfügbar</Text>
          <Text style={styles.stateCopy}>
            Du siehst den zuletzt sicher gespeicherten Stand.
          </Text>
        </View>
      </View>
      <Text style={styles.cacheTime}>{refreshLabel(refreshedAt)}</Text>
      {onRetry ? (
        <Button
          accessibilityHint="Prüft über den Crew Gateway auf aktualisierte sichtbare Events."
          icon={<AssetIcon name="arrowRight" size={22} />}
          label="Aktualisieren"
          onPress={onRetry}
          style={styles.retryButton}
          testID="events-offline-retry"
          variant="action"
        />
      ) : null}
    </Card>
  );
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

function stateDescription(state: EventsViewState) {
  switch (state.kind) {
    case 'loading':
      return 'Deine sichtbaren Events werden geladen.';
    case 'empty':
      return state.phase === 'offline'
        ? 'Dein zuletzt gespeicherter Eventstand ist offline verfügbar.'
        : state.phase === 'refreshing'
        ? 'Deine Eventliste wird aktualisiert.'
        : 'Du hast aktuell keine sichtbaren Events.';
    case 'error':
      return 'Deine Events können gerade nicht sicher geladen werden.';
    case 'ready':
      return state.phase === 'offline'
        ? 'Wähle ein sicher gespeichertes Event. Aktualisiere, sobald du wieder online bist.'
        : state.phase === 'refreshing'
        ? 'Wähle ein gespeichertes Event, während die Liste aktualisiert wird.'
        : 'Wähle das Event, zu dem du wechseln möchtest.';
  }
}

function refreshLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Letzter sicherer Stand gespeichert';
  return `Zuletzt aktualisiert: ${new Intl.DateTimeFormat('de-CH', {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'long',
  }).format(date)}`;
}

export function eventDateLabel(
  event: Pick<EventsViewEvent, 'endsAt' | 'startsAt' | 'timeZone'>,
) {
  const start = formatDate(event.startsAt, event.timeZone);
  const end = formatDate(event.endsAt, event.timeZone);
  if (start && end) {
    if (start === end) return start;
    const startMonth = formatDatePart(event.startsAt, event.timeZone, {
      month: 'long',
      year: 'numeric',
    });
    const endMonth = formatDatePart(event.endsAt, event.timeZone, {
      month: 'long',
      year: 'numeric',
    });
    if (startMonth && startMonth === endMonth) {
      const startDay = formatDatePart(event.startsAt, event.timeZone, {
        day: 'numeric',
      });
      const endDay = formatDatePart(event.endsAt, event.timeZone, {
        day: 'numeric',
      });
      if (startDay && endDay) return `${startDay}.–${endDay}. ${endMonth}`;
    }
    return `${start} – ${end}`;
  }
  if (start) return `Ab ${start}`;
  if (end) return `Bis ${end}`;
  return 'Termin wird noch festgelegt';
}

function formatDate(value: string | null, timeZone: string) {
  return formatDatePart(value, timeZone, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatDatePart(
  value: string | null,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat('de-CH', {
      ...options,
      timeZone,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat('de-CH', options).format(date);
  }
}

function roleLabel(role: EventsViewEvent['role']) {
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

function accessibleRoleLabel(role: EventsViewEvent['role']) {
  switch (role) {
    case 'owner':
      return 'Eigentümer oder Eigentümerin';
    case 'organizer':
      return 'Organisator oder Organisatorin';
    case 'participant':
      return 'Teilnehmer oder Teilnehmerin';
    case 'viewer':
      return 'Betrachter oder Betrachterin';
  }
}

function lifecycleLabel(status: EventsViewEvent['status']) {
  switch (status) {
    case 'draft':
      return 'Entwurf';
    case 'published':
      return 'Veröffentlicht';
    case 'cancelled':
      return 'Abgesagt';
  }
}

function kindLabel(kind: EventsViewEvent['kind']) {
  switch (kind) {
    case 'trip':
      return 'Reise';
    case 'day':
      return 'Tages-Event';
    case 'golf':
      return 'Golfreise';
    case 'team_event':
      return 'Team-Event';
    case 'session':
      return 'Session';
    case 'activity':
      return 'Aktivität';
    case 'other':
      return 'Event';
  }
}

function kindIcon(kind: EventsViewEvent['kind']): keyof typeof icons {
  if (kind === 'golf') return 'golf';
  if (kind === 'team_event') return 'crew';
  return 'calendar';
}

function lifecycleTone(
  status: EventsViewEvent['status'],
): 'action' | 'brand' | 'lavender' | 'surface' {
  switch (status) {
    case 'draft':
      return 'brand';
    case 'published':
      return 'action';
    case 'cancelled':
      return 'lavender';
  }
}

const styles = StyleSheet.create({
  brandLockup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  brandName: {
    ...typography.heading,
    color: colors.text,
    fontSize: 22,
    lineHeight: 26,
  },
  cacheTime: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
  },
  createButton: {
    alignSelf: 'stretch',
    marginTop: spacing.lg,
  },
  description: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  emptyIcon: {
    backgroundColor: colors.surfaceAccent,
  },
  errorIcon: {
    backgroundColor: colors.surface,
  },
  eventCard: {
    gap: spacing.md,
    minHeight: 156,
    padding: spacing.lg,
  },
  eventCardPressed: {
    transform: [{ translateX: spacing.xxs }, { translateY: spacing.xxs }],
  },
  eventDate: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  eventHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  eventHeadingCopy: {
    flex: 1,
    minWidth: 0,
  },
  eventIcon: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: borders.chip,
    height: componentMetrics.control.minimumTouchSize,
    justifyContent: 'center',
    width: componentMetrics.control.minimumTouchSize,
  },
  eventKind: {
    ...typography.overline,
    color: colors.textSecondary,
    marginBottom: spacing.xxs,
  },
  eventList: {
    gap: spacing.lg,
  },
  eventMeta: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  eventPressable: {
    minHeight: componentMetrics.control.minimumTouchSize,
  },
  eventSection: {
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  eventTitle: {
    ...typography.heading,
    color: colors.text,
    flexShrink: 1,
  },
  logo: {
    height: 52,
    width: 52,
  },
  logoutError: {
    ...typography.body,
    color: colors.text,
  },
  logoutSection: {
    gap: spacing.sm,
    marginTop: spacing.xxl,
  },
  offlineCard: {
    gap: spacing.md,
  },
  offlineCopy: {
    flex: 1,
    gap: spacing.xxs,
    minWidth: 0,
  },
  offlineHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  offlineTitle: {
    ...typography.heading,
    color: colors.text,
  },
  refreshing: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  retryButton: {
    alignSelf: 'stretch',
    marginTop: spacing.sm,
  },
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  secondaryCreateButton: {
    alignSelf: 'stretch',
    marginTop: spacing.lg,
  },
  sectionHeading: {
    ...typography.overline,
    color: colors.textSecondary,
  },
  sectionHeadingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  stateCard: {
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.xxl,
  },
  stateCopy: {
    ...typography.body,
    color: colors.text,
  },
  stateIcon: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: borders.chip,
    height: componentMetrics.control.minimumTouchSize,
    justifyContent: 'center',
    width: componentMetrics.control.minimumTouchSize,
  },
  stateTitle: {
    ...typography.heading,
    color: colors.text,
  },
  title: {
    ...typography.display,
    color: colors.text,
    marginTop: spacing.lg,
  },
});
