import type { ImageSourcePropType } from 'react-native';
import {
  Image,
  ImageBackground,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AvatarStack,
  BottomNavigationItem,
  BottomNavigationShell,
  Button,
  Card,
  IconButton,
  StatusChip,
  SyncStatus,
  type AvatarStackItem,
  type SyncState,
} from '../design/primitives';
import {
  borders,
  colors,
  componentMetrics,
  radii,
  spacing,
  typography,
} from '../design/theme';

const boardBackground = require('../assets/crew-board-background.png');
const crewLogo = require('../assets/crew-logo.png');

const icons = {
  arrowRight: require('../assets/icons/arrow-right.png'),
  bus: require('../assets/icons/bus.png'),
  calendar: require('../assets/icons/calendar.png'),
  caretRight: require('../assets/icons/caret-right.png'),
  chat: require('../assets/icons/chat.png'),
  check: require('../assets/icons/check.png'),
  cloudOffline: require('../assets/icons/cloud-offline.png'),
  crew: require('../assets/icons/crew.png'),
  golf: require('../assets/icons/golf.png'),
  location: require('../assets/icons/location.png'),
  more: require('../assets/icons/more.png'),
  navigation: require('../assets/icons/navigation.png'),
  wine: require('../assets/icons/wine.png'),
} satisfies Record<string, ImageSourcePropType>;

const participantImages = {
  aylin: require('../assets/participants/aylin-avatar.png'),
  david: require('../assets/participants/david-avatar.png'),
  jonas: require('../assets/participants/jonas-avatar.png'),
  lena: require('../assets/participants/lena-avatar.png'),
  marco: require('../assets/participants/marco-avatar.png'),
  nico: require('../assets/participants/nico-avatar.png'),
  sara: require('../assets/participants/sara-avatar.png'),
} satisfies Record<string, ImageSourcePropType>;

export type EventHubRole = 'organizer' | 'owner' | 'participant' | 'viewer';
export type EventHubTab = 'crew' | 'feed' | 'more' | 'plan';
export type EventHubCrewTarget =
  | { eventId: string; route: 'TeamSetup' }
  | { decisionId: string; route: 'Decision' };

type EventHubReadAction = {
  access: 'read';
  accessibilityLabel: string;
  destination?: {
    label: string;
    latitude: number | null;
    longitude: number | null;
  };
  id: string;
  label: string;
};

type EventHubWriteAction = {
  access: 'write';
  accessibilityLabel: string;
  id: string;
  label: string;
};

export type EventHubPrimaryAction = EventHubReadAction | EventHubWriteAction;

export type EventHubDate = {
  accessibilityLabel: string;
  day: string;
  id: string;
  isRangeEnd?: boolean;
  isToday?: boolean;
  selected?: boolean;
  weekday: string;
};

export type EventHubTimelineItem = {
  eventId: string;
  icon: 'bus' | 'calendar' | 'golf';
  id: string;
  location: string;
  time: string;
  title: string;
};

type EventHubBaseModel = {
  crewTarget: EventHubCrewTarget | null;
  dateRange: string;
  dates: readonly EventHubDate[];
  feedUpdate: {
    action: string;
    author: string;
    avatar?: ImageSourcePropType;
    relativeTime: string;
  } | null;
  location: string;
  next: {
    location: string;
    time: string;
    title: string;
  } | null;
  participants: readonly AvatarStackItem[];
  participantsAccessibilityLabel: string;
  status: 'archived' | 'cancelled' | 'draft' | 'published';
  sync: {
    label: string;
    state: SyncState;
  };
  timeline: readonly EventHubTimelineItem[];
  title: string;
};

export type EventHubModel =
  | (EventHubBaseModel & {
      primaryAction: EventHubReadAction | null;
      role: 'viewer';
    })
  | (EventHubBaseModel & {
      primaryAction: EventHubPrimaryAction | null;
      role: Exclude<EventHubRole, 'viewer'>;
    });

export type EventHubViewProps = {
  model: EventHubModel;
  onDateSelect(dateId: string): void;
  onPrimaryAction(action: EventHubPrimaryAction): void;
  onSyncStatusPress(): void;
  onTabSelect(tab: EventHubTab): void;
  onTimelineSelect(itemId: string): void;
  selectedTab: EventHubTab;
};

export function participantCountLabel(count: number) {
  return count === 1 ? '1 teilnehmende Person' : `${count} Teilnehmende`;
}

export const turkeyGolfEventHubModel: EventHubModel = {
  crewTarget: null,
  dateRange: '20.–24. September 2026',
  dates: [
    {
      accessibilityLabel: 'Freitag, 18. September, heute',
      day: '18',
      id: '2026-09-18',
      isToday: true,
      selected: true,
      weekday: 'FR',
    },
    {
      accessibilityLabel: 'Samstag, 19. September',
      day: '19',
      id: '2026-09-19',
      weekday: 'SA',
    },
    {
      accessibilityLabel: 'Sonntag, 20. September',
      day: '20',
      id: '2026-09-20',
      weekday: 'SO',
    },
    {
      accessibilityLabel: 'Montag, 21. September',
      day: '21',
      id: '2026-09-21',
      weekday: 'MO',
    },
    {
      accessibilityLabel: 'Dienstag, 22. September',
      day: '22',
      id: '2026-09-22',
      weekday: 'DI',
    },
    {
      accessibilityLabel: 'Donnerstag, 24. September, Reiseende',
      day: '24',
      id: '2026-09-24',
      isRangeEnd: true,
      weekday: 'DO',
    },
  ],
  feedUpdate: {
    action: 'hat den Transfer aktualisiert',
    author: 'Marco',
    avatar: participantImages.marco,
    relativeTime: 'vor 28 Min.',
  },
  location: 'Belek',
  next: {
    location: 'Hotellobby',
    time: '18:30',
    title: 'Welcome Dinner',
  },
  participants: [
    { id: 'marco', name: 'Marco', source: participantImages.marco },
    { id: 'lena', name: 'Lena', source: participantImages.lena },
    { id: 'nico', name: 'Nico', source: participantImages.nico },
    { id: 'sara', name: 'Sara', source: participantImages.sara },
    { id: 'jonas', name: 'Jonas', source: participantImages.jonas },
    { id: 'aylin', name: 'Aylin', source: participantImages.aylin },
    { id: 'david', name: 'David', source: participantImages.david },
    { id: 'mia', name: 'Mia' },
  ],
  participantsAccessibilityLabel:
    '8 Teilnehmende: Marco, Lena, Nico, Sara und weitere',
  primaryAction: {
    access: 'read',
    accessibilityLabel: 'Route zur Hotellobby öffnen',
    destination: {
      label: 'Hotellobby',
      latitude: null,
      longitude: null,
    },
    id: 'route-welcome-dinner',
    label: 'Route öffnen',
  },
  role: 'participant',
  status: 'published',
  sync: {
    label: 'Offline bereit · vor 2 Min. synchronisiert',
    state: 'ready',
  },
  timeline: [
    {
      eventId: 'evt_carya-round-one',
      icon: 'golf',
      id: 'carya-round-one',
      location: 'Carya Golf Club',
      time: '09:00',
      title: '1. Runde · Carya Golf Club',
    },
    {
      eventId: 'evt_turkey-golf-tour',
      icon: 'bus',
      id: 'transfer-club',
      location: 'Hotellobby',
      time: '13:30',
      title: 'Transfer zum Club',
    },
  ],
  title: 'Turkey Golf Tour',
};

function AssetIcon({
  name,
  size = 24,
}: {
  name: keyof typeof icons;
  size?: number;
}) {
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

function EventTimelineRow({
  item,
  onPress,
}: {
  item: EventHubTimelineItem;
  onPress?: () => void;
}) {
  const accessibilityLabel = `${item.time}, ${item.title}, ${item.location}`;
  const content = (
    <>
      <Text numberOfLines={1} style={styles.timelineTime}>
        {item.time}
      </Text>
      <View style={styles.timelineDivider} />
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.timelineIcon,
          item.icon === 'bus' && styles.timelineIconAccent,
        ]}
      >
        <AssetIcon name={item.icon} size={21} />
      </View>
      <View style={styles.timelineCopy}>
        <Text style={styles.timelineTitle}>{item.title}</Text>
        <View style={styles.timelineLocationRow}>
          <AssetIcon name="location" size={13} />
          <Text style={styles.timelineLocation}>{item.location}</Text>
        </View>
      </View>
      {onPress ? <AssetIcon name="caretRight" size={18} /> : null}
    </>
  );

  if (!onPress) {
    return (
      <View
        accessible
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="text"
        style={styles.timelineRow}
      >
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityHint="Öffnet die Aktivitätsdetails."
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.timelineRow,
        pressed && styles.timelinePressed,
      ]}
    >
      {content}
    </Pressable>
  );
}

export function EventHubView({
  model,
  onDateSelect,
  onPrimaryAction,
  onSyncStatusPress,
  onTabSelect,
  onTimelineSelect,
  selectedTab,
}: EventHubViewProps) {
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const usesLargeTextLayout = fontScale >= 2;
  const primaryAction = model.primaryAction;
  const organizerDraft =
    model.status === 'draft' &&
    (model.role === 'owner' || model.role === 'organizer');
  const primaryActionAllowed =
    primaryAction !== null &&
    (model.role !== 'viewer' || primaryAction.access === 'read') &&
    (primaryAction.id !== 'review-event' || organizerDraft);

  return (
    <ImageBackground
      resizeMode="cover"
      source={boardBackground}
      style={styles.screen}
      testID="event-hub"
    >
      <ScrollView
        automaticallyAdjustContentInsets={false}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: Math.max(spacing.md - insets.top, 0),
          },
        ]}
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        style={[styles.scroll, { marginTop: insets.top }]}
      >
        <View style={styles.brandRow}>
          <View style={styles.wordmark}>
            <Image
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              resizeMode="contain"
              source={crewLogo}
              style={styles.logo}
            />
            <Text style={styles.brandName}>CREW</Text>
          </View>
          <IconButton
            accessibilityLabel={`Synchronisierungsstatus öffnen: ${model.sync.label}`}
            icon={<AssetIcon name="cloudOffline" size={25} />}
            onPress={onSyncStatusPress}
            testID="event-hub-sync-button"
            tone="action"
          />
        </View>

        <Text
          accessibilityRole="header"
          lineBreakStrategyIOS="push-out"
          style={styles.eventTitle}
          testID="event-hub-title"
        >
          {model.title}
        </Text>
        <View style={styles.eventMeta}>
          <Text style={styles.dateRange}>{model.dateRange}</Text>
          <StatusChip label={model.location} tone="lavender" />
          {model.role === 'viewer' ? (
            <StatusChip label="Nur ansehen" tone="surface" />
          ) : null}
          {organizerDraft ? (
            <StatusChip label="Privater Entwurf" tone="brand" />
          ) : null}
        </View>
        <AvatarStack
          accessibilityLabel={model.participantsAccessibilityLabel}
          avatars={model.participants}
          maxVisible={7}
        />
        <Text style={styles.participantCount}>
          {participantCountLabel(model.participants.length)}
        </Text>
        <SyncStatus
          icon={<AssetIcon name="check" size={18} />}
          label={model.sync.label}
          state={model.sync.state}
        />

        <ScrollView
          accessibilityHint="Horizontal wischen, um alle Eventtage zu sehen."
          accessibilityLabel="Eventtage"
          accessibilityRole="tablist"
          contentContainerStyle={styles.dateStrip}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.dateScroller}
          testID="event-hub-date-strip"
        >
          {model.dates.map(date => (
            <Pressable
              accessibilityLabel={date.accessibilityLabel}
              accessibilityRole="tab"
              accessibilityState={{ selected: Boolean(date.selected) }}
              key={date.id}
              onPress={() => onDateSelect(date.id)}
              style={({ pressed }) => [
                styles.dateItem,
                date.isToday && styles.todayDate,
                date.isRangeEnd && styles.rangeEndDate,
                date.selected && !date.isToday && styles.selectedDate,
                pressed && styles.datePressed,
              ]}
              testID={`event-hub-date-${date.id}`}
            >
              <Text style={styles.dateWeekday}>{date.weekday}</Text>
              <Text style={styles.dateDay}>{date.day}</Text>
              {date.isToday ? (
                <Text style={styles.todayLabel}>Heute</Text>
              ) : (
                <View style={styles.dateDot} />
              )}
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.nextLabelRow}>
          <Text style={styles.nextLabel}>ALS NÄCHSTES</Text>
          <AssetIcon name="arrowRight" size={19} />
        </View>
        {model.next ? (
          <Card
            elevated
            style={[
              styles.nextCard,
              usesLargeTextLayout && styles.nextCardLargeText,
            ]}
            testID="event-hub-next-card"
            tone="brand"
          >
            <View
              style={[
                styles.nextTimeBlock,
                usesLargeTextLayout && styles.nextTimeBlockLargeText,
              ]}
              testID="event-hub-next-time-block"
            >
              <Text numberOfLines={1} style={styles.nextTime}>
                {model.next.time}
              </Text>
              <AssetIcon name="wine" size={54} />
            </View>
            <View
              style={[
                styles.nextDivider,
                usesLargeTextLayout && styles.nextDividerLargeText,
              ]}
              testID="event-hub-next-divider"
            />
            <View
              style={[
                styles.nextCopy,
                usesLargeTextLayout && styles.nextCopyLargeText,
              ]}
              testID="event-hub-next-copy"
            >
              <Text style={styles.nextTitle}>{model.next.title}</Text>
              <View style={styles.locationRow}>
                <AssetIcon name="location" size={21} />
                <Text style={styles.nextLocation}>{model.next.location}</Text>
              </View>
              {primaryActionAllowed && primaryAction ? (
                <Button
                  accessibilityHint={
                    primaryAction.id === 'review-event'
                      ? 'Öffnet Vorschau, verbindliche Serverprüfung und Veröffentlichung für diesen privaten Entwurf.'
                      : primaryAction.access === 'read'
                      ? 'Öffnet Informationen, ohne Eventdaten zu ändern.'
                      : 'Ändert Eventdaten.'
                  }
                  accessibilityLabel={primaryAction.accessibilityLabel}
                  icon={
                    <AssetIcon
                      name={
                        primaryAction.id === 'review-event'
                          ? 'check'
                          : 'navigation'
                      }
                      size={24}
                    />
                  }
                  label={primaryAction.label}
                  onPress={() => onPrimaryAction(primaryAction)}
                  style={styles.primaryAction}
                  testID="event-hub-primary-action"
                  variant="action"
                />
              ) : null}
            </View>
          </Card>
        ) : (
          <Card elevated style={styles.emptyCard} tone="surface">
            <Text style={styles.emptyTitle}>Noch nichts geplant</Text>
            <Text style={styles.emptyCopy}>
              {organizerDraft
                ? 'Dieser private Entwurf ist noch leer. Ergänze zuerst den Plan.'
                : 'Neue Einträge erscheinen nach dem nächsten Abgleich.'}
            </Text>
            {primaryActionAllowed && primaryAction ? (
              <Button
                accessibilityHint="Öffnet Vorschau, verbindliche Serverprüfung und Veröffentlichung für diesen privaten Entwurf."
                accessibilityLabel={primaryAction.accessibilityLabel}
                icon={<AssetIcon name="check" size={24} />}
                label={primaryAction.label}
                onPress={() => onPrimaryAction(primaryAction)}
                style={styles.primaryAction}
                testID="event-hub-primary-action"
                variant="action"
              />
            ) : null}
          </Card>
        )}

        <View style={styles.timeline}>
          {model.timeline.length > 0 ? (
            model.timeline
              .slice(0, 2)
              .map(item => (
                <EventTimelineRow
                  item={item}
                  key={item.id}
                  onPress={
                    item.icon === 'golf'
                      ? () => onTimelineSelect(item.id)
                      : undefined
                  }
                />
              ))
          ) : (
            <Text accessibilityLiveRegion="polite" style={styles.emptyTimeline}>
              Für diesen Tag ist noch nichts geplant.
            </Text>
          )}
        </View>

        {model.feedUpdate ? (
          <Card
            accessibilityLabel={`${model.feedUpdate.author} ${model.feedUpdate.action}, ${model.feedUpdate.relativeTime}`}
            accessibilityRole="summary"
            style={styles.feedCard}
            tone="lavender"
          >
            {model.feedUpdate.avatar ? (
              <Image
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                source={model.feedUpdate.avatar}
                style={styles.feedAvatar}
              />
            ) : (
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={styles.feedAvatarFallback}
              >
                <Text style={styles.feedAvatarInitial}>
                  {model.feedUpdate.author.charAt(0).toLocaleUpperCase()}
                </Text>
              </View>
            )}
            <View style={styles.feedCopy}>
              <Text style={styles.feedAction}>
                <Text style={styles.feedAuthor}>
                  {model.feedUpdate.author}{' '}
                </Text>
                {model.feedUpdate.action}
              </Text>
              <Text style={styles.feedTime}>
                {model.feedUpdate.relativeTime}
              </Text>
            </View>
            <AssetIcon name="chat" size={28} />
          </Card>
        ) : (
          <Card style={styles.feedCard} tone="lavender">
            <AssetIcon name="chat" size={28} />
            <View style={styles.feedCopy}>
              <Text style={styles.feedAuthor}>Noch keine Updates</Text>
              <Text style={styles.feedTime}>
                Der Feed ist offline verfügbar, sobald ein Eintrag gespeichert
                ist.
              </Text>
            </View>
          </Card>
        )}
      </ScrollView>

      <BottomNavigationShell style={styles.bottomNavigation}>
        {(
          [
            ['plan', 'Plan', 'calendar', true],
            ['feed', 'Feed', 'chat', true],
            ['crew', 'Crew', 'crew', model.crewTarget !== null],
            ['more', 'Mehr', 'more', true],
          ] as const
        ).map(([tab, label, icon, available]) => (
          <BottomNavigationItem
            accessibilityHint={available ? undefined : 'Noch nicht verfügbar.'}
            disabled={!available}
            icon={<AssetIcon name={icon} size={25} />}
            key={tab}
            label={label}
            onPress={available ? () => onTabSelect(tab) : undefined}
            selected={selectedTab === tab}
            testID={`event-hub-tab-${tab}`}
          />
        ))}
      </BottomNavigationShell>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  bottomNavigation: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    flexShrink: 0,
    marginHorizontal: spacing.md,
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
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  dateDay: {
    ...typography.heading,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  dateItem: {
    alignItems: 'center',
    borderColor: 'transparent',
    borderRadius: radii.compact,
    borderWidth: borders.chip,
    flexGrow: 1,
    flexShrink: 0,
    justifyContent: 'center',
    minHeight: 58,
    minWidth: componentMetrics.control.minimumTouchSize,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  dateDot: {
    backgroundColor: colors.textSecondary,
    borderRadius: radii.pill,
    height: spacing.xs,
    marginTop: spacing.xs,
    width: spacing.xs,
  },
  datePressed: {
    backgroundColor: colors.backgroundPressed,
  },
  dateRange: {
    ...typography.bodyStrong,
    color: colors.textSecondary,
    flexShrink: 1,
  },
  dateScroller: {
    marginBottom: spacing.md,
    marginTop: spacing.sm,
  },
  dateStrip: {
    alignItems: 'stretch',
    gap: spacing.xs,
    minWidth: '100%',
  },
  dateWeekday: {
    ...typography.caption,
    color: colors.text,
  },
  eventMeta: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
    marginTop: spacing.xs,
  },
  eventTitle: {
    ...typography.display,
    color: colors.text,
    flexShrink: 1,
    marginTop: spacing.lg,
  },
  emptyCard: {
    gap: spacing.xs,
  },
  emptyCopy: {
    ...typography.body,
    color: colors.textSecondary,
  },
  emptyTimeline: {
    ...typography.body,
    color: colors.textSecondary,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
  },
  emptyTitle: {
    ...typography.title,
    color: colors.text,
  },
  feedAction: {
    ...typography.caption,
    color: colors.text,
    flexShrink: 1,
  },
  feedAuthor: {
    ...typography.label,
    color: colors.text,
  },
  feedAvatar: {
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: borders.chip,
    height: 36,
    width: 36,
  },
  feedAvatarFallback: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: borders.chip,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  feedAvatarInitial: {
    ...typography.label,
    color: colors.text,
  },
  feedCard: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.sm,
  },
  feedCopy: {
    flex: 1,
  },
  feedTime: {
    ...typography.caption,
    color: colors.text,
  },
  locationRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  logo: {
    height: 52,
    width: 52,
  },
  nextCard: {
    alignItems: 'stretch',
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 158,
    padding: 10,
  },
  nextCardLargeText: {
    flexDirection: 'column',
  },
  nextCopy: {
    flex: 1,
    gap: spacing.xs,
    justifyContent: 'center',
    minWidth: 0,
  },
  nextCopyLargeText: {
    flex: 0,
    width: '100%',
  },
  nextDivider: {
    alignSelf: 'stretch',
    backgroundColor: colors.border,
    width: borders.chip,
  },
  nextDividerLargeText: {
    height: borders.chip,
    width: '100%',
  },
  nextLabel: {
    ...typography.label,
    color: colors.textSecondary,
  },
  nextLabelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  nextLocation: {
    ...typography.body,
    color: colors.text,
    flexShrink: 1,
    fontSize: 16,
    lineHeight: 20,
  },
  nextTime: {
    ...typography.numeric,
    color: colors.text,
    flexShrink: 0,
  },
  nextTimeBlock: {
    alignItems: 'center',
    flexShrink: 0,
    gap: spacing.md,
    minWidth: 88,
    paddingTop: spacing.sm,
  },
  nextTimeBlockLargeText: {
    flexDirection: 'row',
    minWidth: 0,
    paddingTop: 0,
  },
  nextTitle: {
    ...typography.title,
    color: colors.text,
    flexShrink: 1,
  },
  participantCount: {
    ...typography.label,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  primaryAction: {
    alignSelf: 'stretch',
    minWidth: 0,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rangeEndDate: {
    borderColor: colors.focus,
    borderRadius: radii.pill,
  },
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  scroll: {
    flex: 1,
    overflow: 'hidden',
  },
  selectedDate: {
    borderColor: colors.focus,
  },
  timeline: {
    marginHorizontal: -spacing.sm,
    marginTop: spacing.md,
  },
  timelineCopy: {
    flex: 1,
    gap: spacing.xxs,
    minWidth: 0,
  },
  timelineDivider: {
    alignSelf: 'stretch',
    backgroundColor: colors.divider,
    width: borders.subtle,
  },
  timelineIcon: {
    alignItems: 'center',
    backgroundColor: colors.surfaceAction,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: borders.chip,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  timelineIconAccent: {
    backgroundColor: colors.surfaceAccent,
  },
  timelineLocation: {
    ...typography.caption,
    color: colors.text,
    flexShrink: 1,
  },
  timelineLocationRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xxs,
  },
  timelinePressed: {
    backgroundColor: colors.backgroundPressed,
  },
  timelineRow: {
    alignItems: 'center',
    borderBottomColor: colors.divider,
    borderBottomWidth: borders.subtle,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: componentMetrics.timeline.minimumRowHeight - 18,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  timelineTime: {
    ...typography.subheading,
    color: colors.text,
    flexShrink: 0,
    fontSize: 18,
    fontVariant: ['tabular-nums'],
    lineHeight: 22,
    minWidth: 60,
  },
  timelineTitle: {
    ...typography.label,
    color: colors.text,
    flexShrink: 1,
  },
  todayDate: {
    backgroundColor: colors.surfaceBrand,
    borderColor: colors.border,
  },
  todayLabel: {
    ...typography.caption,
    color: colors.text,
  },
  wordmark: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
});
