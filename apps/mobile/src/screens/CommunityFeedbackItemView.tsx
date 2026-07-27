import type {
  CommunityFeedback,
  CommunityFeedbackManagerRole,
  CommunityFeedbackManagerStatus,
  FeedbackDuplicateSuggestion,
} from '@crew/mobile-data';
import type { ImageSourcePropType } from 'react-native';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Button,
  Card,
  StatusChip,
  SyncStatus,
  TextField,
} from '../design/primitives';
import {
  borders,
  colors,
  componentMetrics,
  elevations,
  radii,
  spacing,
  typography,
} from '../design/theme';
import { ScreenFrame, ScreenIcon } from './ScreenFrame';
import { statusLabel } from './CommunityFeedbackListView';

const icons = {
  chat: require('../assets/icons/chat.png'),
  check: require('../assets/icons/check.png'),
  cloudOffline: require('../assets/icons/cloud-offline.png'),
  crew: require('../assets/icons/crew.png'),
} satisfies Record<string, ImageSourcePropType>;

type SafeComment = CommunityFeedback['comments'][number];
type SafeStatusChange = CommunityFeedback['statusHistory'][number];

export type CommunityFeedbackItem = Pick<
  CommunityFeedback,
  | 'body'
  | 'commentCount'
  | 'commentsHasMore'
  | 'duplicateCount'
  | 'followed'
  | 'id'
  | 'status'
  | 'statusHistoryCount'
  | 'statusHistoryHasMore'
  | 'title'
  | 'updatedAt'
  | 'version'
  | 'viewerHasVoted'
  | 'voteCount'
> & {
  comments: readonly Pick<SafeComment, 'body' | 'createdAt' | 'id'>[];
  statusHistory: readonly Pick<
    SafeStatusChange,
    'changedAt' | 'fromStatus' | 'note' | 'toStatus' | 'version'
  >[];
};

export type CommunityFeedbackItemAction =
  | 'comment'
  | 'duplicate'
  | 'follow'
  | 'refresh'
  | 'status'
  | 'vote';

export type CommunityFeedbackManagerViewModel = {
  candidates: readonly FeedbackDuplicateSuggestion[];
  candidatesState: 'error' | 'loading' | 'ready';
  note: string;
  role: CommunityFeedbackManagerRole;
  selectedDuplicateId: string | null;
};

export type CommunityFeedbackItemViewModel = {
  commentBody: string;
  commentError: string | null;
  feedback: CommunityFeedbackItem | null;
  manager: CommunityFeedbackManagerViewModel | null;
  managerWriteState: 'ready' | 'refresh_required';
  message: string | null;
  messageKind: 'error' | 'info' | null;
  online: boolean;
  phase: 'loading' | 'ready' | 'removed' | 'unavailable';
  redirected: boolean;
  working: CommunityFeedbackItemAction | null;
};

export type CommunityFeedbackItemViewProps = {
  model: CommunityFeedbackItemViewModel;
  onBack(): void;
  onCommentBodyChange(value: string): void;
  onFollowChange(value: boolean): void;
  onManagerDuplicateSelect(feedbackId: string): void;
  onManagerDuplicateSubmit(): void;
  onManagerNoteChange(value: string): void;
  onManagerStatusChange(status: CommunityFeedbackManagerStatus): void;
  onRefresh(): void;
  onSubmitComment(): void;
  onVoteChange(value: boolean): void;
};

export function CommunityFeedbackItemView({
  model,
  onBack,
  onCommentBodyChange,
  onFollowChange,
  onManagerDuplicateSelect,
  onManagerDuplicateSubmit,
  onManagerNoteChange,
  onManagerStatusChange,
  onRefresh,
  onSubmitComment,
  onVoteChange,
}: CommunityFeedbackItemViewProps) {
  const feedback = model.feedback;
  const presentation = framePresentation(model);

  return (
    <ScreenFrame
      description={presentation.description}
      eyebrow="EVENT-FEEDBACK"
      icon={presentation.icon}
      liveRegion={presentation.liveRegion}
      statusLabel={presentation.statusLabel}
      testID="community-feedback-item-view"
      title={presentation.title}
      tone={presentation.tone}
    >
      {model.phase === 'loading' ? <LoadingState /> : null}
      {model.phase === 'unavailable' ? (
        <BoundaryState
          body="Geschützte Event- und Feedbackdaten bleiben verborgen."
          onBack={onBack}
          title="Dieser Inhalt ist nicht verfügbar."
        />
      ) : null}
      {model.phase === 'removed' ? (
        <BoundaryState
          body="Die Meldung ist nicht mehr Teil dieses Events. Es werden keine alten Inhalte angezeigt."
          onBack={onBack}
          title="Feedback nicht mehr verfügbar"
        />
      ) : null}
      {model.phase === 'ready' && feedback ? (
        <ReadyState
          feedback={feedback}
          model={model}
          onBack={onBack}
          onCommentBodyChange={onCommentBodyChange}
          onFollowChange={onFollowChange}
          onManagerDuplicateSelect={onManagerDuplicateSelect}
          onManagerDuplicateSubmit={onManagerDuplicateSubmit}
          onManagerNoteChange={onManagerNoteChange}
          onManagerStatusChange={onManagerStatusChange}
          onRefresh={onRefresh}
          onSubmitComment={onSubmitComment}
          onVoteChange={onVoteChange}
        />
      ) : null}
    </ScreenFrame>
  );
}

function ReadyState({
  feedback,
  model,
  onBack,
  onCommentBodyChange,
  onFollowChange,
  onManagerDuplicateSelect,
  onManagerDuplicateSubmit,
  onManagerNoteChange,
  onManagerStatusChange,
  onRefresh,
  onSubmitComment,
  onVoteChange,
}: Omit<CommunityFeedbackItemViewProps, 'model'> & {
  feedback: CommunityFeedbackItem;
  model: CommunityFeedbackItemViewModel;
}) {
  const writesBlocked = model.managerWriteState === 'refresh_required';
  const canComment =
    model.online &&
    !writesBlocked &&
    model.commentBody.trim().length > 0 &&
    model.working === null;
  return (
    <>
      <SyncStatus
        icon={
          <ScreenIcon
            size={17}
            source={model.online ? icons.check : icons.cloudOffline}
          />
        }
        label={
          writesBlocked
            ? 'Änderung bestätigt. Aktualisiere den sicheren Stand, bevor du weitere Beiträge sendest.'
            : model.online
            ? 'Aktueller gespeicherter Stand. Beiträge werden direkt online gesendet.'
            : 'Offline. Gespeicherter Stand; Stimmen, Kommentare und Folgen sind nicht vorgemerkt.'
        }
        state={writesBlocked ? 'attention' : model.online ? 'ready' : 'offline'}
      />
      {model.redirected ? (
        <Card
          accessibilityLiveRegion="polite"
          style={styles.noticeCard}
          tone="lavender"
        >
          <Text style={styles.noticeText}>
            Diese Meldung wurde zusammengeführt. Du siehst jetzt die aktuelle
            Fassung.
          </Text>
        </Card>
      ) : null}
      {model.message ? (
        <Card
          accessibilityLiveRegion={
            model.messageKind === 'error' ? 'assertive' : 'polite'
          }
          tone={model.messageKind === 'error' ? 'brand' : 'lavender'}
        >
          <Text
            accessibilityRole={
              model.messageKind === 'error' ? 'alert' : undefined
            }
            style={styles.noticeText}
          >
            {model.message}
          </Text>
        </Card>
      ) : null}
      <View style={styles.metaRow}>
        <StatusChip label={statusLabel(feedback.status)} tone="brand" />
        {feedback.followed ? (
          <StatusChip label="GEFOLGT" tone="lavender" />
        ) : null}
      </View>
      <Text accessibilityRole="header" style={styles.feedbackTitle}>
        {feedback.title}
      </Text>
      <Text style={styles.feedbackBody}>{feedback.body}</Text>
      {feedback.duplicateCount > 0 ? (
        <Text style={styles.supportCopy}>
          {feedback.duplicateCount} ähnliche Meldung
          {feedback.duplicateCount === 1 ? '' : 'en'} wurden zusammengeführt.
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button
          accessibilityHint={
            model.online
              ? 'Sendet deine Auswahl direkt an Crew.'
              : 'Online erforderlich. Es wird nichts vorgemerkt.'
          }
          disabled={!model.online || writesBlocked || model.working !== null}
          label={
            feedback.viewerHasVoted
              ? `Stimme entfernen · ${feedback.voteCount}`
              : `Dafür stimmen · ${feedback.voteCount}`
          }
          loading={model.working === 'vote'}
          onPress={() => onVoteChange(!feedback.viewerHasVoted)}
          testID="community-feedback-vote"
          variant="action"
        />
        <Button
          accessibilityHint={
            model.online
              ? 'Sendet deine Auswahl direkt an Crew.'
              : 'Online erforderlich. Es wird nichts vorgemerkt.'
          }
          disabled={!model.online || writesBlocked || model.working !== null}
          label={feedback.followed ? 'Nicht mehr folgen' : 'Status folgen'}
          loading={model.working === 'follow'}
          onPress={() => onFollowChange(!feedback.followed)}
          testID="community-feedback-follow"
          variant="surface"
        />
      </View>
      {!model.online ? (
        <Text accessibilityRole="alert" style={styles.offlineTruth}>
          Online erforderlich. Es wurde nichts vorgemerkt.
        </Text>
      ) : null}
      <SectionTitle title="STATUSVERLAUF" />
      {feedback.statusHistory.length > 0 ? (
        feedback.statusHistory.map((change, index) => (
          <StatusHistoryRow
            change={change}
            key={`${change.version}:${index}`}
          />
        ))
      ) : (
        <Text style={styles.supportCopy}>Noch keine Statusänderung.</Text>
      )}
      {feedback.statusHistoryHasMore ? (
        <Text style={styles.supportCopy}>
          {feedback.statusHistory.length} von {feedback.statusHistoryCount}{' '}
          Änderungen sind gespeichert.
        </Text>
      ) : null}
      {model.manager && !writesBlocked ? (
        <ManagerPanel
          feedback={feedback}
          manager={model.manager}
          online={model.online}
          onDuplicateSelect={onManagerDuplicateSelect}
          onDuplicateSubmit={onManagerDuplicateSubmit}
          onNoteChange={onManagerNoteChange}
          onStatusChange={onManagerStatusChange}
          working={model.working}
        />
      ) : null}
      <SectionTitle title={`KOMMENTARE · ${feedback.commentCount}`} />
      {feedback.comments.length > 0 ? (
        feedback.comments.map((comment, index) => (
          <CommentRow comment={comment} key={`${comment.id}:${index}`} />
        ))
      ) : (
        <Text style={styles.supportCopy}>
          Noch keine sichtbaren Kommentare.
        </Text>
      )}
      {feedback.commentsHasMore ? (
        <Text style={styles.supportCopy}>
          Weitere Kommentare sind in dieser Ansicht noch nicht geladen.
        </Text>
      ) : null}
      <TextField
        autoCapitalize="sentences"
        autoComplete="off"
        disabled={!model.online || writesBlocked || model.working !== null}
        error={model.commentError ?? undefined}
        helpText={
          writesBlocked
            ? 'Aktualisiere zuerst den sicheren Stand. Es wird nichts erneut gesendet.'
            : model.online
            ? 'Höchstens 5’000 Zeichen. Der Kommentar wird direkt online gesendet.'
            : 'Online erforderlich. Eingaben werden nicht als Auftrag vorgemerkt.'
        }
        inputStyle={styles.commentInput}
        label="Kommentar"
        maxLength={5_000}
        multiline
        onChangeText={onCommentBodyChange}
        placeholder="Dein Kommentar zum Feedback"
        testID="community-feedback-comment-input"
        textAlignVertical="top"
        value={model.commentBody}
      />
      <Button
        disabled={!canComment}
        icon={<ScreenIcon source={icons.chat} />}
        label="Kommentar senden"
        loading={model.working === 'comment'}
        onPress={onSubmitComment}
        testID="community-feedback-comment-submit"
        variant="brand"
      />
      <View style={styles.actions}>
        <Button
          label="Feedback aktualisieren"
          loading={model.working === 'refresh'}
          onPress={onRefresh}
          testID="community-feedback-item-refresh"
          variant={writesBlocked ? 'action' : 'surface'}
        />
        <Button
          label="Zur Feedback-Liste"
          onPress={onBack}
          testID="community-feedback-item-back"
          variant="surface"
        />
      </View>
    </>
  );
}

const managerStatuses: readonly CommunityFeedbackManagerStatus[] = [
  'open',
  'planned',
  'in_progress',
  'completed',
  'declined',
];

function ManagerPanel({
  feedback,
  manager,
  online,
  onDuplicateSelect,
  onDuplicateSubmit,
  onNoteChange,
  onStatusChange,
  working,
}: {
  feedback: CommunityFeedbackItem;
  manager: CommunityFeedbackManagerViewModel;
  online: boolean;
  onDuplicateSelect(feedbackId: string): void;
  onDuplicateSubmit(): void;
  onNoteChange(value: string): void;
  onStatusChange(status: CommunityFeedbackManagerStatus): void;
  working: CommunityFeedbackItemAction | null;
}) {
  const disabled = !online || working !== null;
  const visibleStatuses = managerStatuses.filter(
    status =>
      status === feedback.status ||
      managerStatusTransitionAllowed(feedback.status, status),
  );
  return (
    <>
      <SectionTitle title="TRIAGE" />
      <Card style={styles.managerCard} tone="lavender">
        <View style={styles.metaRow}>
          <StatusChip label="ORGANISATION" tone="surface" />
          <Text style={styles.managerRole}>
            {manager.role === 'owner' ? 'Owner-Zugriff' : 'Organizer-Zugriff'}
          </Text>
        </View>
        <Text style={styles.historyTitle}>Status sicher einordnen</Text>
        <Text style={styles.supportCopy}>
          Änderungen sind sofort für Eventmitglieder sichtbar und werden nicht
          offline vorgemerkt.
        </Text>
        <TextField
          autoCapitalize="sentences"
          autoComplete="off"
          disabled={disabled}
          helpText="Optional, öffentlich im Statusverlauf · höchstens 1’000 Zeichen."
          inputStyle={styles.managerNoteInput}
          label="Öffentliche Notiz"
          maxLength={1_000}
          multiline
          onChangeText={onNoteChange}
          placeholder="Kurze Begründung zur Änderung"
          testID="community-feedback-manager-note"
          textAlignVertical="top"
          value={manager.note}
        />
        <View style={styles.managerStatusList}>
          {visibleStatuses.map(status => (
            <Button
              accessibilityHint={
                online
                  ? 'Ändert den Status direkt und veröffentlicht die optionale Notiz.'
                  : 'Online erforderlich. Es wird nichts vorgemerkt.'
              }
              disabled={disabled || status === feedback.status}
              key={status}
              label={
                status === feedback.status
                  ? `${statusLabel(status)} · aktuell`
                  : statusLabel(status)
              }
              onPress={() => onStatusChange(status)}
              testID={`community-feedback-manager-status-${status}`}
              variant={status === feedback.status ? 'action' : 'surface'}
            />
          ))}
        </View>
        <Text style={styles.historyTitle}>Ähnliche Meldung zusammenführen</Text>
        {manager.candidatesState === 'loading' ? (
          <View accessibilityLiveRegion="polite" style={styles.managerLoading}>
            <ActivityIndicator
              accessibilityLabel="Ähnliche Meldungen werden geprüft"
              color={colors.textSecondary}
            />
            <Text style={styles.supportCopy}>
              Bereinigte Meldungen aus diesem Event werden geprüft.
            </Text>
          </View>
        ) : null}
        {manager.candidatesState === 'error' ? (
          <Text accessibilityRole="alert" style={styles.supportCopy}>
            Ähnliche Meldungen konnten nicht geladen werden. Mit „Feedback
            aktualisieren“ kannst du es erneut versuchen.
          </Text>
        ) : null}
        {manager.candidatesState === 'ready' &&
        manager.candidates.length === 0 ? (
          <Text style={styles.supportCopy}>
            Keine passende Meldung in diesem Event gefunden.
          </Text>
        ) : null}
        {manager.candidates.length > 0 ? (
          <View style={styles.duplicateList}>
            {manager.candidates.map(candidate => {
              const selected = manager.selectedDuplicateId === candidate.id;
              return (
                <Pressable
                  accessibilityHint="Wählt diese bereinigte Meldung als kanonisches Ziel aus."
                  accessibilityLabel={`${candidate.title}. ${statusLabel(
                    candidate.status,
                  )}. ${voteLabel(candidate.voteCount)}.`}
                  accessibilityRole="button"
                  accessibilityState={{ disabled, selected }}
                  disabled={disabled}
                  key={candidate.id}
                  onPress={() => onDuplicateSelect(candidate.id)}
                  style={({ pressed }) => [
                    styles.duplicateChoice,
                    elevations.compact,
                    selected && styles.duplicateChoiceSelected,
                    disabled && styles.disabled,
                    pressed && styles.choicePressed,
                  ]}
                  testID={`community-feedback-manager-duplicate-${candidate.id}`}
                >
                  <Text style={styles.choiceTitle}>{candidate.title}</Text>
                  <Text style={styles.supportCopy}>
                    {statusLabel(candidate.status)} ·{' '}
                    {voteLabel(candidate.voteCount)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        <Button
          accessibilityHint="Führt die aktuelle Meldung direkt mit der ausgewählten Meldung zusammen."
          disabled={disabled || manager.selectedDuplicateId === null}
          label="Mit ausgewählter Meldung zusammenführen"
          loading={working === 'duplicate'}
          onPress={onDuplicateSubmit}
          testID="community-feedback-manager-duplicate-submit"
          variant="brand"
        />
        {!online ? (
          <Text accessibilityRole="alert" style={styles.offlineTruth}>
            Online erforderlich. Manager-Aktionen wurden nicht vorgemerkt.
          </Text>
        ) : null}
      </Card>
    </>
  );
}

function managerStatusTransitionAllowed(
  from: CommunityFeedbackItem['status'],
  to: CommunityFeedbackManagerStatus,
): boolean {
  if (from === 'completed' || from === 'declined') {
    return to === 'open';
  }
  return from !== to;
}

function voteLabel(voteCount: number): string {
  return `${voteCount} ${voteCount === 1 ? 'Stimme' : 'Stimmen'}`;
}

function StatusHistoryRow({
  change,
}: {
  change: CommunityFeedbackItem['statusHistory'][number];
}) {
  return (
    <Card style={styles.historyCard} tone="lavender">
      <View style={styles.metaRow}>
        <StatusChip label={statusLabel(change.toStatus)} tone="surface" />
        <Text style={styles.timestamp}>{formatDate(change.changedAt)}</Text>
      </View>
      <Text style={styles.historyTitle}>
        {change.fromStatus === null
          ? `Gestartet als ${statusLabel(change.toStatus)}`
          : `${statusLabel(change.fromStatus)} → ${statusLabel(
              change.toStatus,
            )}`}
      </Text>
      {change.note ? (
        <Text style={styles.supportCopy}>{change.note}</Text>
      ) : null}
    </Card>
  );
}

function CommentRow({
  comment,
}: {
  comment: CommunityFeedbackItem['comments'][number];
}) {
  return (
    <Card style={styles.commentCard} tone="surface">
      <Text style={styles.commentLabel}>EVENT-KOMMENTAR</Text>
      <Text style={styles.feedbackBody}>{comment.body}</Text>
      <Text style={styles.timestamp}>{formatDate(comment.createdAt)}</Text>
    </Card>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

function LoadingState() {
  return (
    <View accessibilityLiveRegion="polite" style={styles.loading}>
      <ActivityIndicator
        accessibilityLabel="Event-Feedback wird geladen"
        color={colors.textSecondary}
        size="large"
      />
      <Text style={styles.supportCopy}>
        Crew prüft zuerst deinen aktuellen Eventzugriff.
      </Text>
    </View>
  );
}

function BoundaryState({
  body,
  onBack,
  title,
}: {
  body: string;
  onBack(): void;
  title: string;
}) {
  return (
    <>
      <Text accessibilityRole="alert" style={styles.feedbackTitle}>
        {title}
      </Text>
      <Text style={styles.supportCopy}>{body}</Text>
      <Button
        label="Zur Feedback-Liste"
        onPress={onBack}
        testID="community-feedback-item-back"
        variant="action"
      />
    </>
  );
}

function framePresentation(model: CommunityFeedbackItemViewModel) {
  if (model.phase === 'loading') {
    return {
      description: 'Crew prüft den geschützten Eventbereich.',
      icon: icons.crew,
      liveRegion: 'polite' as const,
      statusLabel: 'WIRD GELADEN',
      title: 'Feedback wird geladen',
      tone: 'surface' as const,
    };
  }
  if (model.phase === 'unavailable' || model.phase === 'removed') {
    return {
      description: 'Nicht freigegebene Inhalte bleiben sicher verborgen.',
      icon: icons.cloudOffline,
      liveRegion: 'assertive' as const,
      statusLabel: 'NICHT VERFÜGBAR',
      title: 'Feedback nicht verfügbar',
      tone: 'brand' as const,
    };
  }
  return {
    description:
      'Bereinigtes Feedback, Status und Event-Kommentare für aktive Mitglieder.',
    icon: model.online ? icons.check : icons.cloudOffline,
    liveRegion: 'polite' as const,
    statusLabel: model.online ? 'EVENT-INTERN' : 'OFFLINE-KOPIE',
    title: 'Feedback im Event',
    tone: 'brand' as const,
  };
}

function formatDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Zeitpunkt unbekannt';
  return new Intl.DateTimeFormat('de-CH', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

const styles = StyleSheet.create({
  actions: {
    gap: spacing.md,
  },
  commentCard: {
    gap: spacing.sm,
  },
  commentInput: {
    minHeight: 132,
  },
  commentLabel: {
    ...typography.overline,
    color: colors.textSecondary,
  },
  choicePressed: {
    backgroundColor: colors.backgroundPressed,
    transform: [{ translateX: 1 }, { translateY: 1 }],
  },
  choiceTitle: {
    ...typography.bodyStrong,
    color: colors.text,
    flexShrink: 1,
  },
  disabled: {
    opacity: componentMetrics.control.disabledOpacity,
  },
  duplicateChoice: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.control,
    borderWidth: borders.chip,
    gap: spacing.xs,
    minHeight: componentMetrics.control.minimumTouchSize,
    padding: spacing.md,
  },
  duplicateChoiceSelected: {
    backgroundColor: colors.surfaceAction,
    borderWidth: borders.strong,
  },
  duplicateList: {
    gap: spacing.sm,
  },
  feedbackBody: {
    ...typography.body,
    color: colors.text,
    flexShrink: 1,
  },
  feedbackTitle: {
    ...typography.heading,
    color: colors.text,
    flexShrink: 1,
  },
  historyCard: {
    gap: spacing.sm,
  },
  historyTitle: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  loading: {
    alignItems: 'center',
    gap: spacing.md,
  },
  managerCard: {
    gap: spacing.md,
  },
  managerLoading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  managerNoteInput: {
    minHeight: 108,
  },
  managerRole: {
    ...typography.label,
    color: colors.textSecondary,
    flexShrink: 1,
  },
  managerStatusList: {
    gap: spacing.sm,
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  noticeCard: {
    gap: spacing.sm,
  },
  noticeText: {
    ...typography.bodyStrong,
    color: colors.text,
    flexShrink: 1,
  },
  offlineTruth: {
    ...typography.bodyStrong,
    color: colors.error,
  },
  sectionTitle: {
    ...typography.overline,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  supportCopy: {
    ...typography.body,
    color: colors.text,
    flexShrink: 1,
  },
  timestamp: {
    ...typography.caption,
    color: colors.textSecondary,
    flexShrink: 1,
  },
});
