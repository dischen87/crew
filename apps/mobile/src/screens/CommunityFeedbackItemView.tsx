import type { CommunityFeedback } from '@crew/mobile-data';
import type { ImageSourcePropType } from 'react-native';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import {
  Button,
  Card,
  StatusChip,
  SyncStatus,
  TextField,
} from '../design/primitives';
import { colors, spacing, typography } from '../design/theme';
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
  | 'follow'
  | 'refresh'
  | 'vote';

export type CommunityFeedbackItemViewModel = {
  commentBody: string;
  commentError: string | null;
  feedback: CommunityFeedbackItem | null;
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
  onRefresh(): void;
  onSubmitComment(): void;
  onVoteChange(value: boolean): void;
};

export function CommunityFeedbackItemView({
  model,
  onBack,
  onCommentBodyChange,
  onFollowChange,
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
  onRefresh,
  onSubmitComment,
  onVoteChange,
}: Omit<CommunityFeedbackItemViewProps, 'model'> & {
  feedback: CommunityFeedbackItem;
  model: CommunityFeedbackItemViewModel;
}) {
  const canComment =
    model.online &&
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
          model.online
            ? 'Aktueller gespeicherter Stand. Beiträge werden direkt online gesendet.'
            : 'Offline. Gespeicherter Stand; Stimmen, Kommentare und Folgen sind nicht vorgemerkt.'
        }
        state={model.online ? 'ready' : 'offline'}
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
          disabled={!model.online || model.working !== null}
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
          disabled={!model.online || model.working !== null}
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
        disabled={!model.online || model.working !== null}
        error={model.commentError ?? undefined}
        helpText={
          model.online
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
          variant="surface"
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
